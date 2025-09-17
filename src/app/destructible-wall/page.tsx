"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  useRapier,
} from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { fracture, FractureOptions } from "@dgreenheck/three-pinata";

const IDENTITY_QUATERNION = { w: 1, x: 0, y: 0, z: 0 } as const;

type ImpactDirection = "posX" | "negX" | "posZ" | "negZ";

type WallSpec = {
  id: string;
  size: [number, number, number];
  center: [number, number, number];
  fragmentCount: number;
  impactDirection: ImpactDirection;
  outerColor?: number | string;
  innerColor?: number | string;
};

type FragmentData = {
  id: string;
  geometry: THREE.BufferGeometry;
  worldPosition: [number, number, number];
  localCenter: [number, number, number];
  halfExtents: [number, number, number];
};

type JointCandidate = {
  id: string;
  aId: string;
  bId: string;
  anchorA: [number, number, number];
  anchorB: [number, number, number];
  toughness: number;
  isRebar: boolean;
};

type RapierContextValue = ReturnType<typeof useRapier>;
type RapierImpulseJoint = RapierContextValue["world"] extends {
  createImpulseJoint: (...args: any[]) => infer JointType;
}
  ? JointType
  : never;

type JointRecord = JointCandidate & {
  joint: RapierImpulseJoint;
  broken: boolean;
};

type StructureConfig = {
  id: string;
  label: string;
  description: string;
  walls: WallSpec[];
};

const STRUCTURES: StructureConfig[] = [
  {
    id: "single-wall",
    label: "Single reinforced wall",
    description: "One thin wall glued together with breakable joints.",
    walls: [
      {
        id: "front-wall",
        size: [6.2, 3.2, 0.32],
        center: [0, 1.6, 0],
        fragmentCount: 48,
        impactDirection: "posZ",
        outerColor: "#b8b8b8",
        innerColor: "#d25555",
      },
    ],
  },
  {
    id: "mini-building",
    label: "Mini concrete hut",
    description: "Four joined walls form a fragile building shell.",
    walls: [
      {
        id: "front",
        size: [6.0, 3.0, 0.32],
        center: [0, 1.5, -2.2],
        fragmentCount: 44,
        impactDirection: "posZ",
        outerColor: "#b8b8b8",
        innerColor: "#d25555",
      },
      {
        id: "back",
        size: [6.0, 3.0, 0.32],
        center: [0, 1.5, 2.2],
        fragmentCount: 42,
        impactDirection: "negZ",
        outerColor: "#b2b2b2",
        innerColor: "#cc5555",
      },
      {
        id: "left",
        size: [0.32, 3.0, 4.4],
        center: [-3.16, 1.5, 0],
        fragmentCount: 36,
        impactDirection: "posX",
        outerColor: "#b0b0b0",
        innerColor: "#d25555",
      },
      {
        id: "right",
        size: [0.32, 3.0, 4.4],
        center: [3.16, 1.5, 0],
        fragmentCount: 36,
        impactDirection: "negX",
        outerColor: "#b0b0b0",
        innerColor: "#d25555",
      },
    ],
  },
];

const AXIS_INDEX: Record<ImpactDirection, 0 | 2> = {
  posX: 0,
  negX: 0,
  posZ: 2,
  negZ: 2,
};

const DIRECTION_VECTOR: Record<ImpactDirection, THREE.Vector3> = {
  posX: new THREE.Vector3(1, 0, 0),
  negX: new THREE.Vector3(-1, 0, 0),
  posZ: new THREE.Vector3(0, 0, 1),
  negZ: new THREE.Vector3(0, 0, -1),
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function overlapLength(a: FragmentData, b: FragmentData, axisIndex: 0 | 1 | 2) {
  const minA = a.localCenter[axisIndex] - a.halfExtents[axisIndex];
  const maxA = a.localCenter[axisIndex] + a.halfExtents[axisIndex];
  const minB = b.localCenter[axisIndex] - b.halfExtents[axisIndex];
  const maxB = b.localCenter[axisIndex] + b.halfExtents[axisIndex];
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function buildFragments(spec: WallSpec): FragmentData[] {
  const geometry = new THREE.BoxGeometry(
    spec.size[0],
    spec.size[1],
    spec.size[2],
    2,
    3,
    1,
  );
  const fractureOptions = new FractureOptions();
  fractureOptions.fragmentCount = spec.fragmentCount;

  const pieces = fracture(geometry, fractureOptions);
  geometry.dispose();
  const fragments: FragmentData[] = pieces.map((geom, index) => {
    geom.computeBoundingBox();
    const bbox = geom.boundingBox;
    const center = new THREE.Vector3();
    bbox?.getCenter(center);
    geom.translate(-center.x, -center.y, -center.z);
    const sizeVec = new THREE.Vector3();
    bbox?.getSize(sizeVec);

    return {
      id: `${spec.id}-${index}`,
      geometry: geom,
      worldPosition: [spec.center[0] + center.x, spec.center[1] + center.y, spec.center[2] + center.z],
      localCenter: [center.x, center.y, center.z],
      halfExtents: [sizeVec.x / 2, sizeVec.y / 2, sizeVec.z / 2],
    };
  });

  return fragments;
}

function computeJointCandidates(spec: WallSpec, fragments: FragmentData[]): JointCandidate[] {
  const candidates: JointCandidate[] = [];
  if (fragments.length === 0) return candidates;

  const tolerance = Math.max(0.05, Math.min(spec.size[0], spec.size[2]) * 0.12);
  const width = spec.size[0];
  const depth = spec.size[2];
  const rebarColumns = [-width / 3.2, 0, width / 3.2];
  const rebarDepthLimit = Math.max(0.2, depth * 0.45);

  for (let i = 0; i < fragments.length; i += 1) {
    for (let j = i + 1; j < fragments.length; j += 1) {
      const a = fragments[i];
      const b = fragments[j];
      const dx = Math.abs(a.localCenter[0] - b.localCenter[0]);
      const dy = Math.abs(a.localCenter[1] - b.localCenter[1]);
      const dz = Math.abs(a.localCenter[2] - b.localCenter[2]);
      const hx = a.halfExtents[0] + b.halfExtents[0];
      const hy = a.halfExtents[1] + b.halfExtents[1];
      const hz = a.halfExtents[2] + b.halfExtents[2];

      if (dx > hx + tolerance || dy > hy + tolerance || dz > hz + tolerance) continue;

      const gapX = dx - hx;
      const gapY = dy - hy;
      const gapZ = dz - hz;
      const gaps: { axis: "x" | "y" | "z"; value: number }[] = [
        { axis: "x", value: gapX },
        { axis: "y", value: gapY },
        { axis: "z", value: gapZ },
      ];

      let chosenAxis: "x" | "y" | "z" | null = null;
      let minGap = tolerance;
      for (const entry of gaps) {
        if (entry.value <= tolerance && entry.value < minGap) {
          chosenAxis = entry.axis;
          minGap = entry.value;
        }
      }
      if (!chosenAxis) continue;

      const axisIndex = chosenAxis === "x" ? 0 : chosenAxis === "y" ? 1 : 2;
      const otherAxes: (0 | 1 | 2)[] = (
        chosenAxis === "x"
          ? [1, 2]
          : chosenAxis === "y"
            ? [0, 2]
            : [0, 1]
      ) as (0 | 1 | 2)[];

      const dir = a.localCenter[axisIndex] <= b.localCenter[axisIndex] ? 1 : -1;
      const anchorA: [number, number, number] = [0, 0, 0];
      const anchorB: [number, number, number] = [0, 0, 0];
      anchorA[axisIndex] = dir * a.halfExtents[axisIndex];
      anchorB[axisIndex] = -dir * b.halfExtents[axisIndex];

      for (const idx of otherAxes) {
        const mid = (a.localCenter[idx] + b.localCenter[idx]) / 2;
        const offsetA = clamp(mid - a.localCenter[idx], -a.halfExtents[idx], a.halfExtents[idx]);
        const offsetB = clamp(mid - b.localCenter[idx], -b.halfExtents[idx], b.halfExtents[idx]);
        anchorA[idx] = offsetA;
        anchorB[idx] = offsetB;
      }

      const overlap1 = overlapLength(a, b, otherAxes[0]);
      const overlap2 = overlapLength(a, b, otherAxes[1]);
      if (overlap1 * overlap2 <= 0.0005) continue;

      const contactArea = overlap1 * overlap2;
      const centerX = (a.localCenter[0] + b.localCenter[0]) / 2;
      const centerZ = (a.localCenter[2] + b.localCenter[2]) / 2;
      const centerHeight = (a.localCenter[1] + b.localCenter[1]) / 2;

      let toughness = 45 + contactArea * 35;
      if (chosenAxis === "y") toughness += 20;
      const nearEdge =
        Math.abs(centerX) > width * 0.45 ||
        Math.abs(centerZ) > depth * 0.45 ||
        centerHeight > spec.size[1] * 0.75;
      if (nearEdge) toughness *= 0.8;

      const isRebar =
        chosenAxis === "y" &&
        rebarColumns.some((col) => Math.abs(centerX - col) < width * 0.08) &&
        Math.abs(centerZ) < rebarDepthLimit;
      if (isRebar) {
        toughness *= 2.4;
      }

      const id = `${a.id}--${b.id}`;
      candidates.push({
        id,
        aId: a.id,
        bId: b.id,
        anchorA,
        anchorB,
        toughness,
        isRebar,
      });
    }
  }

  return candidates;
}

type FragmentRefs = Map<string, RapierRigidBody | null>;
type JointMap = Map<string, JointRecord>;
type FragmentJointMap = Map<string, Set<string>>;

function useJointGlue(
  fragments: FragmentData[],
  candidates: JointCandidate[],
  fragmentRefs: FragmentRefs,
) {
  const { rapier, world } = useRapier();
  const jointRecordsRef = useRef<JointMap>(new Map());
  const fragmentJointsRef = useRef<FragmentJointMap>(new Map());

  const breakJoint = useCallback(
    (jointId: string) => {
      if (!world) return;
      const record = jointRecordsRef.current.get(jointId);
      if (!record || record.broken) return;
      world.removeImpulseJoint(record.joint, true);
      record.broken = true;
      jointRecordsRef.current.delete(jointId);
      const aSet = fragmentJointsRef.current.get(record.aId);
      if (aSet) {
        aSet.delete(jointId);
        if (aSet.size === 0) fragmentJointsRef.current.delete(record.aId);
      }
      const bSet = fragmentJointsRef.current.get(record.bId);
      if (bSet) {
        bSet.delete(jointId);
        if (bSet.size === 0) fragmentJointsRef.current.delete(record.bId);
      }
      const bodyA = fragmentRefs.get(record.aId);
      const bodyB = fragmentRefs.get(record.bId);
      bodyA?.wakeUp();
      bodyB?.wakeUp();
    },
    [fragmentRefs, world],
  );

  const breakFromForce = useCallback(
    (fragmentId: string, magnitude: number) => {
      if (!world) return;
      const joints = fragmentJointsRef.current.get(fragmentId);
      if (!joints) return;
      const ids = Array.from(joints);
      for (const jointId of ids) {
        const record = jointRecordsRef.current.get(jointId);
        if (!record || record.broken) continue;
        const effectiveThreshold = record.isRebar ? record.toughness : record.toughness * 0.85;
        if (magnitude >= effectiveThreshold) {
          breakJoint(jointId);
        }
      }
    },
    [breakJoint, world],
  );

  const registerForce = useCallback(
    (fragmentId: string, event: any) => {
      const totalVec = event?.totalForce ?? event?.total_force;
      const totalFromVector =
        typeof totalVec === "object" && totalVec !== null
          ? Math.sqrt(
              (totalVec.x ?? 0) * (totalVec.x ?? 0) +
                (totalVec.y ?? 0) * (totalVec.y ?? 0) +
                (totalVec.z ?? 0) * (totalVec.z ?? 0),
            )
          : 0;
      const maxVec = event?.maxForce ?? event?.max_force;
      const maxFromVector =
        typeof maxVec === "object" && maxVec !== null
          ? Math.sqrt(
              (maxVec.x ?? 0) * (maxVec.x ?? 0) +
                (maxVec.y ?? 0) * (maxVec.y ?? 0) +
                (maxVec.z ?? 0) * (maxVec.z ?? 0),
            )
          : 0;
      const total = event?.totalForceMagnitude ?? event?.total_force_magnitude ?? totalFromVector;
      const max = event?.maxForceMagnitude ?? event?.max_force_magnitude ?? maxFromVector;
      const magnitude = Math.max(total ?? 0, max ?? 0);
      if (magnitude > 1) {
        const scaled = magnitude * 0.9;
        breakFromForce(fragmentId, scaled);
      }
    },
    [breakFromForce],
  );

  useEffect(() => {
    if (!world || !rapier) return;
    jointRecordsRef.current.forEach((record) => {
      world.removeImpulseJoint(record.joint, true);
    });
    jointRecordsRef.current.clear();
    fragmentJointsRef.current.clear();
  }, [fragments, world, rapier]);

  useEffect(() => {
    if (!world || !rapier) return;
    if (fragments.length === 0 || candidates.length === 0) return;

    let disposed = false;
    function tryCreateJoints() {
      if (disposed) return;
      const ready = fragments.every((fragment) => fragmentRefs.get(fragment.id));
      if (!ready) {
        requestAnimationFrame(tryCreateJoints);
        return;
      }

      for (const candidate of candidates) {
        const bodyA = fragmentRefs.get(candidate.aId);
        const bodyB = fragmentRefs.get(candidate.bId);
        if (!bodyA || !bodyB) continue;
        const jointData = rapier.JointData.fixed(
          { x: candidate.anchorA[0], y: candidate.anchorA[1], z: candidate.anchorA[2] },
          IDENTITY_QUATERNION,
          { x: candidate.anchorB[0], y: candidate.anchorB[1], z: candidate.anchorB[2] },
          IDENTITY_QUATERNION,
        );
        const created = world.createImpulseJoint(jointData, bodyA, bodyB, true);
        const record: JointRecord = { ...candidate, joint: created, broken: false };
        jointRecordsRef.current.set(candidate.id, record);
        const setA = fragmentJointsRef.current.get(candidate.aId) ?? new Set<string>();
        setA.add(candidate.id);
        fragmentJointsRef.current.set(candidate.aId, setA);
        const setB = fragmentJointsRef.current.get(candidate.bId) ?? new Set<string>();
        setB.add(candidate.id);
        fragmentJointsRef.current.set(candidate.bId, setB);
      }
    }

    tryCreateJoints();

    return () => {
      disposed = true;
    };
  }, [candidates, fragmentRefs, fragments, rapier, world]);

  useEffect(() => {
    return () => {
      if (!world) return;
      jointRecordsRef.current.forEach((record) => {
        world.removeImpulseJoint(record.joint, true);
      });
      jointRecordsRef.current.clear();
      fragmentJointsRef.current.clear();
    };
  }, [world]);

  return { registerForce };
}

type DestructibleWallProps = {
  spec: WallSpec;
  seed: number;
  density?: number;
  friction?: number;
  restitution?: number;
};

function DestructibleWall({ spec, seed, density = 0.28, friction = 0.7, restitution = 0.08 }: DestructibleWallProps) {
  const fragments = useMemo(() => buildFragments(spec), [seed, spec]);
  const candidates = useMemo(() => computeJointCandidates(spec, fragments), [spec, fragments]);

  useEffect(() => {
    return () => {
      for (const fragment of fragments) {
        fragment.geometry.dispose();
      }
    };
  }, [fragments]);

  const fragmentRefs = useRef<FragmentRefs>(new Map());
  const setFragmentRef = useCallback(
    (id: string) => (body: RapierRigidBody | null) => {
      fragmentRefs.current.set(id, body);
    },
    [],
  );

  const { registerForce } = useJointGlue(fragments, candidates, fragmentRefs.current);

  const outerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.outerColor ?? 0xbababa,
        roughness: 0.62,
        metalness: 0.05,
      }),
    [spec.outerColor],
  );
  const innerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.innerColor ?? 0xbf4b4b,
        roughness: 0.3,
        metalness: 0,
      }),
    [spec.innerColor],
  );

  useEffect(() => {
    return () => {
      outerMaterial.dispose();
      innerMaterial.dispose();
    };
  }, [innerMaterial, outerMaterial]);

  return (
    <group>
      {fragments.map((fragment) => (
        <RigidBody
          key={fragment.id}
          ref={setFragmentRef(fragment.id)}
          position={fragment.worldPosition}
          colliders="hull"
          friction={friction}
          restitution={restitution}
          density={density}
          onContactForce={(event) => registerForce(fragment.id, event)}
        >
          <mesh geometry={fragment.geometry} material={[outerMaterial, innerMaterial]} castShadow receiveShadow />
        </RigidBody>
      ))}
    </group>
  );
}

type ProjectileProps = {
  target: WallSpec;
  seed: number;
};

function Projectile({ target, seed }: ProjectileProps) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const direction = DIRECTION_VECTOR[target.impactDirection];
  const axisIndex = AXIS_INDEX[target.impactDirection];

  const params = useMemo(() => {
    const radius = 0.38 + (Math.random() - 0.5) * 0.08;
    const localTarget = new THREE.Vector3(
      (Math.random() - 0.5) * target.size[0] * 0.7,
      Math.max(0.35, Math.random() * target.size[1] * 0.85),
      (Math.random() - 0.5) * target.size[2] * 0.7,
    );

    const axis = axisIndex;
    const dir = direction.clone().normalize();
    const offset = target.size[axis] * 0.5 * dir.length();
    localTarget.setComponent(axis, localTarget.getComponent(axis) * 0.2);
    const worldTarget = new THREE.Vector3(...target.center).add(localTarget);
    const approachDistance = 4.5 + Math.random() * 1.5 + target.size[axis] * 0.6;
    const start = worldTarget.clone().addScaledVector(dir, -approachDistance - offset);

    const flightTime = 0.65 + Math.random() * 0.2;
    const g = -9.81;
    const vx = (worldTarget.x - start.x) / flightTime;
    const vz = (worldTarget.z - start.z) / flightTime;
    const vy = (worldTarget.y - start.y - 0.5 * g * flightTime * flightTime) / flightTime;

    const spin = {
      x: (Math.random() - 0.5) * 6,
      y: (Math.random() - 0.5) * 6,
      z: (Math.random() - 0.5) * 6,
    };

    return {
      radius,
      start: [start.x, start.y, start.z] as [number, number, number],
      linvel: { x: vx, y: vy, z: vz },
      spin,
      restitution: 0.38,
      friction: 0.6,
    } as const;
  }, [axisIndex, direction, seed, target.center, target.size]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.setLinvel(params.linvel, true);
    body.setAngvel(params.spin, true);
  }, [params]);

  return (
    <RigidBody
      ref={bodyRef}
      position={params.start}
      colliders="ball"
      restitution={params.restitution}
      friction={params.friction}
    >
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[params.radius, 32, 32]} />
        <meshStandardMaterial color="#4da2ff" roughness={0.25} metalness={0.1} />
      </mesh>
    </RigidBody>
  );
}

function Ground() {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
      <CuboidCollider args={[25, 0.05, 25]} position={[0, -0.05, 0]} />
    </RigidBody>
  );
}

type SceneProps = {
  structure: StructureConfig;
  seed: number;
};

function Scene({ structure, seed }: SceneProps) {
  const projectileTarget = useMemo(() => {
    if (structure.walls.length === 0) return null;
    const index = Math.floor(Math.random() * structure.walls.length);
    return structure.walls[index];
  }, [structure, seed]);

  return (
    <Canvas shadows camera={{ position: [7, 5, 9], fov: 45 }}>
      <color attach="background" args={["#0e0e12"]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow
        position={[6, 8, 6]}
        intensity={1.2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.15} />

      <Physics gravity={[0, -9.81, 0]}>
        <Ground />
        {structure.walls.map((wall) => (
          <DestructibleWall key={`${wall.id}-${seed}`} spec={wall} seed={seed} />
        ))}
        {projectileTarget ? <Projectile key={`${projectileTarget.id}-${seed}`} target={projectileTarget} seed={seed} /> : null}
      </Physics>
      <gridHelper args={[40, 40, "#444", "#2d2d2d"]} position={[0, 0.01, 0]} />
      <StatsGl className="absolute top-20 left-2" />
    </Canvas>
  );
}

export default function Page() {
  const [structureId, setStructureId] = useState<StructureConfig["id"]>(STRUCTURES[0]?.id ?? "single-wall");
  const [iteration, setIteration] = useState(0);
  const structure = useMemo(
    () => STRUCTURES.find((item) => item.id === structureId) ?? STRUCTURES[0],
    [structureId],
  );

  const reset = useCallback(() => {
    setIteration((value) => value + 1);
  }, []);

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 360,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 14px",
              background: "#0d0d0d",
              color: "white",
              borderRadius: 6,
              border: "1px solid #303030",
            }}
          >
            Reset
          </button>
          <select
            value={structureId}
            onChange={(event) => setStructureId(event.target.value as StructureConfig["id"])}
            style={{
              background: "#111",
              color: "#eee",
              border: "1px solid #333",
              borderRadius: 6,
              padding: "8px 10px",
              flex: 1,
            }}
          >
            {STRUCTURES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <p style={{ margin: 0, color: "#d1d5db", fontSize: 14 }}>
          {structure?.description ?? "Fragments are glued by Rapier fixed joints until impacts rip them apart."}
        </p>
      </div>
      {structure ? <Scene key={`${structure.id}-${iteration}`} structure={structure} seed={iteration} /> : null}
    </div>
  );
}
