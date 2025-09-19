"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, StatsGl, Line, Html } from "@react-three/drei";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  useRapier,
} from "@react-three/rapier";
import type { CollisionEnterPayload, ContactForcePayload, RapierRigidBody } from "@react-three/rapier";
import { fracture, FractureOptions } from "@dgreenheck/three-pinata";

const IDENTITY_QUATERNION = { w: 1, x: 0, y: 0, z: 0 } as const;
// Physical densities in kg/m^3 (Rapier uses SI units when gravity is ~9.81)
// const CONCRETE_DENSITY = 2400; // normal-weight concrete
const CONCRETE_DENSITY = 0.240; // normal-weight concrete
// const STEEL_DENSITY = 7850; // structural steel (approx.)
const CONCRETE_FRICTION = 1.7; //0.7;
const CONCRETE_RESTITUTION = 0.08;

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
  midpoint: [number, number, number];
  anchors: [number, number, number][];
  normal: [number, number, number];
  toughness: number;
  isRebar: boolean;
};

type RapierContextValue = ReturnType<typeof useRapier>;
type RapierImpulseJoint = ReturnType<RapierContextValue["world"]["createImpulseJoint"]>;

type JointRecord = {
  id: string;
  aId: string;
  bId: string;
  joint: RapierImpulseJoint;
  broken: boolean;
  toughness: number;
  isRebar: boolean;
  anchorWorld: [number, number, number];
  normal: [number, number, number];
  damage: number;
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
        // fragmentCount: 2,
        fragmentCount: 48,
        // fragmentCount: 100,
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

//

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

function getSupportPointLocal(geometry: THREE.BufferGeometry, direction: THREE.Vector3): THREE.Vector3 {
  const pos = geometry.getAttribute("position");
  const dir = direction;
  let best = -Infinity;
  let bx = 0, by = 0, bz = 0;
  for (let i = 0; i < pos.count; i += 1) {
    const x = (pos as THREE.BufferAttribute).getX(i) as number;
    const y = (pos as THREE.BufferAttribute).getY(i) as number;
    const z = (pos as THREE.BufferAttribute).getZ(i) as number;
    const d = x * dir.x + y * dir.y + z * dir.z;
    if (d > best) {
      best = d;
      bx = x; by = y; bz = z;
    }
  }
  return new THREE.Vector3(bx, by, bz);
}

function projectExtentsOnAxisWorld(geometry: THREE.BufferGeometry, worldPos: THREE.Vector3, axis: THREE.Vector3): { min: number; max: number } {
  const pos = geometry.getAttribute("position");
  const ax = axis;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const x = (pos as THREE.BufferAttribute).getX(i) as number + worldPos.x;
    const y = (pos as THREE.BufferAttribute).getY(i) as number + worldPos.y;
    const z = (pos as THREE.BufferAttribute).getZ(i) as number + worldPos.z;
    const p = x * ax.x + y * ax.y + z * ax.z;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

function overlap1D(a: { min: number; max: number }, b: { min: number; max: number }) {
  return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
}

function computeJointCandidates(spec: WallSpec, fragments: FragmentData[]): JointCandidate[] {
  const candidates: JointCandidate[] = [];
  if (fragments.length === 0) return candidates;

  const tolerance = Math.max(0.05, Math.min(spec.size[0], spec.size[2]) * 0.12);
  const width = spec.size[0];
  const depth = spec.size[2];

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

      const worldA = new THREE.Vector3(a.worldPosition[0], a.worldPosition[1], a.worldPosition[2]);
      const worldB = new THREE.Vector3(b.worldPosition[0], b.worldPosition[1], b.worldPosition[2]);
      const n = worldB.clone().sub(worldA).normalize();
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue;

      const pA_local = getSupportPointLocal(a.geometry, n);
      const pB_local = getSupportPointLocal(b.geometry, n.clone().multiplyScalar(-1));
      const pA_world = pA_local.clone().add(worldA);
      const pB_world = pB_local.clone().add(worldB);

      const sA = pA_world.dot(n);
      const sB = pB_world.dot(n);
      const separation = sB - sA;
      const epsGap = Math.max(0.006, Math.min(spec.size[0], spec.size[1], spec.size[2]) * 0.02);
      if (separation > epsGap) continue;

      const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const t1 = new THREE.Vector3().crossVectors(n, up).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
      const a1 = projectExtentsOnAxisWorld(a.geometry, worldA, t1);
      const b1 = projectExtentsOnAxisWorld(b.geometry, worldB, t1);
      const a2 = projectExtentsOnAxisWorld(a.geometry, worldA, t2);
      const b2 = projectExtentsOnAxisWorld(b.geometry, worldB, t2);
      const o1 = overlap1D(a1, b1);
      const o2 = overlap1D(a2, b2);
      const size1 = Math.min(a1.max - a1.min, b1.max - b1.min);
      const size2 = Math.min(a2.max - a2.min, b2.max - b2.min);
      if (o1 < size1 * 0.22 || o2 < size2 * 0.22) continue;

      const contactArea = o1 * o2;
      const centerX = (a.localCenter[0] + b.localCenter[0]) / 2;
      const centerZ = (a.localCenter[2] + b.localCenter[2]) / 2;
      const centerHeight = (a.localCenter[1] + b.localCenter[1]) / 2;

      let toughness = 36 + contactArea * 28; // slightly lower baseline to allow breaking
      if (Math.abs(n.y) > 0.6) toughness += 20;
      const nearEdge =
        Math.abs(centerX) > width * 0.45 ||
        Math.abs(centerZ) > depth * 0.45 ||
        centerHeight > spec.size[1] * 0.75;
      if (nearEdge) toughness *= 0.75;

      /*
      const isRebar =
        Math.abs(n.y) > 0.6 &&
        rebarColumns.some((col) => Math.abs(centerX - col) < width * 0.08) &&
        Math.abs(centerZ) < rebarDepthLimit;
      */
      const isRebar = false; // TODO: Re-enable rebar logic
      if (isRebar) {
        toughness *= 2.4;
      }

      const mid = pA_world.clone().add(pB_world).multiplyScalar(0.5);
      const midpoint: [number, number, number] = [mid.x, mid.y, mid.z];

      // Approximate a triangular set of anchors across the overlap patch to resist moments
      const half1 = 0.5 * o1;
      const half2 = 0.5 * o2;
      const ex = Math.max(0.05, 0.33 * half1);
      const ey = Math.max(0.05, 0.33 * half2);
      const P = new THREE.Vector3(mid.x, mid.y, mid.z);
      const a1w = P.clone().addScaledVector(t1, +ex).addScaledVector(t2, +ey);
      const a2w = P.clone().addScaledVector(t1, -ex).addScaledVector(t2, +ey);
      const anchors: [number, number, number][] = [
        [P.x, P.y, P.z],
        [a1w.x, a1w.y, a1w.z],
        [a2w.x, a2w.y, a2w.z],
      ];

      const normal: [number, number, number] = [n.x, n.y, n.z];

      const id = `${a.id}--${b.id}`;
      candidates.push({
        id,
        aId: a.id,
        bId: b.id,
        midpoint,
        anchors,
        normal,
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
  jointsEnabled: boolean = true,
  onJointsChanged?: () => void,
) {
  const { rapier, world } = useRapier();
  const jointRecordsRef = useRef<JointMap>(new Map());
  const fragmentJointsRef = useRef<FragmentJointMap>(new Map());
  const lastContactRef = useRef<Map<string, { point: [number, number, number]; normal: [number, number, number] }>>(new Map());

  const breakJoint = useCallback(
    (jointId: string) => {
      if (!world) return;
      const record = jointRecordsRef.current.get(jointId);
      if (!record || record.broken) return;

      console.log("breakJoint", jointId);
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
      onJointsChanged?.();
    },
    [fragmentRefs, world, onJointsChanged],
  );

  const registerForce = useCallback(
    (fragmentId: string, event: ContactForcePayload) => {
      const contact = lastContactRef.current.get(fragmentId);
      if (!contact) return;

      const magnitude = Math.max(event.totalForceMagnitude, event.maxForceMagnitude);
      // if (magnitude <= 1) return;

      const joints = fragmentJointsRef.current.get(fragmentId);
      if (!joints) {
        // console.warn("registerForce no joints", { magnitude, joints });
        return;
      }

      const forceDir = event.maxForceDirection;
      const dirVec = new THREE.Vector3(forceDir.x, forceDir.y, forceDir.z).normalize();
      const contactNormal = new THREE.Vector3(contact.normal[0], contact.normal[1], contact.normal[2]);
      const hitPoint = new THREE.Vector3(contact.point[0], contact.point[1], contact.point[2]);

      let broke = 0;
      for (const jointId of Array.from(joints.values())) {
        if (broke >= MAX_BREAKS_PER_STEP) break;
        const rec = jointRecordsRef.current.get(jointId);
        if (!rec || rec.broken) continue;
        const aw = new THREE.Vector3(rec.anchorWorld[0], rec.anchorWorld[1], rec.anchorWorld[2]);
        const dist = aw.distanceTo(hitPoint);
        // if (dist > BREAK_RADIUS) continue;

        const jointN = new THREE.Vector3(rec.normal[0], rec.normal[1], rec.normal[2]);
        const tensionByNormal = Math.max(0, jointN.dot(contactNormal));
        const tensionByForceDir = Math.max(0, jointN.dot(dirVec));
        const dirFactor = Math.max(tensionByNormal, tensionByForceDir);

        rec.damage = (rec.damage ?? 0) * DAMAGE_DECAY + magnitude * dirFactor;
        const threshold = (rec.isRebar ? 3.0 : 1.0) * rec.toughness * 120;
        if (rec.damage >= threshold) {
          breakJoint(jointId);
          broke += 1;
        }
      }
    },
    [breakJoint],
  );

  /**
   * Maximum distance (in world units) from a joint's anchor to a collision/force point
   * for the joint to be considered affected and eligible for damage or breaking.
   */
  const BREAK_RADIUS = 0.45;

  /**
   * Maximum number of joints that can be broken in a single simulation step
   * in response to a collision or force event, to prevent excessive breakage at once.
   */
  const MAX_BREAKS_PER_STEP = 6;

  /**
   * Fraction of previous accumulated damage retained per simulation step.
   * New damage is added after applying this decay, simulating gradual dissipation.
   * Value should be between 0 (no retention) and 1 (no decay).
   */
  const DAMAGE_DECAY = 0.9;

  const registerCollision = useCallback(
    (fragmentId: string, payload: CollisionEnterPayload) => {
      const manifold = payload.manifold;
      const solverCount = manifold.numSolverContacts();
      // console.log("registerCollision", { solverCount });
      if (solverCount <= 0) return;

      const p = manifold.solverContactPoint(0);
      const n = manifold.normal();

      const hitPoint = new THREE.Vector3(p.x, p.y, p.z);
      const hitNormal = new THREE.Vector3(n.x, n.y, n.z).normalize();

      const impulse = manifold.contactImpulse(0) ?? 0;
      const magnitude = impulse;
      // Cache last contact info for use with continuous force events
      lastContactRef.current.set(fragmentId, {
        point: [hitPoint.x, hitPoint.y, hitPoint.z],
        normal: [hitNormal.x, hitNormal.y, hitNormal.z],
      });

      const joints = fragmentJointsRef.current.get(fragmentId);
      if (!joints) {
        // console.warn("registerCollision no joints", { magnitude, joints });
        return;
      }

      // console.log("registerCollision", { magnitude });

      let broke = 0;
      for (const jointId of Array.from(joints.values())) {
        if (broke >= MAX_BREAKS_PER_STEP) break;
        const rec = jointRecordsRef.current.get(jointId);
        if (!rec || rec.broken) continue;
        const aw = new THREE.Vector3(rec.anchorWorld[0], rec.anchorWorld[1], rec.anchorWorld[2]);
        const dist = aw.distanceTo(hitPoint);
        // if (dist > BREAK_RADIUS) continue;

        const jointN = new THREE.Vector3(rec.normal[0], rec.normal[1], rec.normal[2]);
        const dirFactor = Math.max(0, jointN.dot(hitNormal));
        rec.damage = (rec.damage ?? 0) * DAMAGE_DECAY + magnitude * dirFactor;
        const threshold = (rec.isRebar ? 3.0 : 1.0) * rec.toughness * 120;
        if (rec.damage >= threshold) {
          // console.log("breakJoint registerCollision", jointId, rec.damage, threshold);
          breakJoint(jointId);
          broke += 1;
        }
      }
    },
    [breakJoint],
  );

  useEffect(() => {
    if (!world || !rapier) return;
    // tie to fragments changes so joints reset when geometry changes
    const _fragCount = fragments.length;
    jointRecordsRef.current.forEach((record) => {
      world.removeImpulseJoint(record.joint, true);
    });
    jointRecordsRef.current.clear();
    fragmentJointsRef.current.clear();
  }, [fragments, world, rapier]);

  useEffect(() => {
    if (!world || !rapier) return;
    if (fragments.length === 0 || candidates.length === 0) return;
    if (!jointsEnabled) return; // Skip joint creation if joints are disabled

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
        const wca = bodyA.worldCom();
        const lca = bodyA.localCom();
        const ra = bodyA.rotation();
        const qaInv = new THREE.Quaternion(ra.x, ra.y, ra.z, ra.w).invert();

        const wcb = bodyB.worldCom();
        const lcb = bodyB.localCom();
        const rb = bodyB.rotation();
        const qbInv = new THREE.Quaternion(rb.x, rb.y, rb.z, rb.w).invert();

        for (let k = 0; k < candidate.anchors.length; k += 1) {
          const [wx, wy, wz] = candidate.anchors[k];
          const M = new THREE.Vector3(wx, wy, wz);

          const aDeltaLocal = M.clone().sub(new THREE.Vector3(wca.x, wca.y, wca.z)).applyQuaternion(qaInv);
          const bDeltaLocal = M.clone().sub(new THREE.Vector3(wcb.x, wcb.y, wcb.z)).applyQuaternion(qbInv);

          const anchorA = new THREE.Vector3(lca.x, lca.y, lca.z).add(aDeltaLocal);
          const anchorBVec = new THREE.Vector3(lcb.x, lcb.y, lcb.z).add(bDeltaLocal);

          const jointData = rapier.JointData.fixed(
            { x: anchorA.x, y: anchorA.y, z: anchorA.z },
            IDENTITY_QUATERNION,
            { x: anchorBVec.x, y: anchorBVec.y, z: anchorBVec.z },
            IDENTITY_QUATERNION,
          );
          const created = world.createImpulseJoint(jointData, bodyA, bodyB, false);

          const recordId = `${candidate.id}#${k}`;
          const record: JointRecord = {
            id: recordId,
            aId: candidate.aId,
            bId: candidate.bId,
            joint: created,
            broken: false,
            toughness: candidate.toughness / candidate.anchors.length,
            isRebar: candidate.isRebar,
            anchorWorld: candidate.anchors[k],
            normal: candidate.normal,
            damage: 0,
          };
          jointRecordsRef.current.set(recordId, record);
          const setA = fragmentJointsRef.current.get(candidate.aId) ?? new Set<string>();
          setA.add(recordId);
          fragmentJointsRef.current.set(candidate.aId, setA);
          const setB = fragmentJointsRef.current.get(candidate.bId) ?? new Set<string>();
          setB.add(recordId);
          fragmentJointsRef.current.set(candidate.bId, setB);
        }
      }
      onJointsChanged?.();
    }

    tryCreateJoints();

    return () => {
      disposed = true;
    };
  }, [candidates, fragmentRefs, fragments, rapier, world, jointsEnabled, onJointsChanged]);

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

  return { registerForce, registerCollision, jointRecordsRef };
}

type DestructibleWallProps = {
  spec: WallSpec;
  density?: number;
  friction?: number;
  restitution?: number;
  jointsEnabled?: boolean;
  debugEnabled?: boolean;
  wireframe?: boolean;
  /**
   * Initially sleep the fragments
   */
  sleep?: boolean;
};

function DestructibleWall({
  spec,
  density = CONCRETE_DENSITY,
  friction = CONCRETE_FRICTION,
  restitution = CONCRETE_RESTITUTION,
  jointsEnabled = true,
  debugEnabled = false,
  wireframe = false,
  sleep = true,
}: DestructibleWallProps) {
  const fragments = useMemo(() => buildFragments(spec), [spec]);
  const candidates = useMemo(() => computeJointCandidates(spec, fragments), [spec, fragments]);

  useEffect(() => {
    return () => {
      for (const fragment of fragments) {
        fragment.geometry.dispose();
      }
    };
  }, [fragments]);

  const fragmentRefs = useRef<FragmentRefs>(new Map());
  const [, setRefsVersion] = useState(0);
  const setFragmentRef = useCallback(
    (id: string) => (body: RapierRigidBody | null) => {
      fragmentRefs.current.set(id, body);
      // Sleep
      if (sleep) {
        body?.sleep();
      }
      // Force a render when refs attach so debug visuals can read them immediately
      setRefsVersion((v) => v + 1);
    },
    [sleep],
  );

  const [, setJointVersion] = useState(0);
  const { registerForce, registerCollision, jointRecordsRef } = useJointGlue(
    fragments,
    candidates,
    fragmentRefs.current,
    jointsEnabled,
    useCallback(() => setJointVersion((v) => v + 1), []),
  );

  const outerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.outerColor ?? 0xbababa,
        roughness: 0.62,
        metalness: 0.05,
        wireframe,
      }),
    [spec.outerColor, wireframe],
  );
  const innerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.innerColor ?? 0xbf4b4b,
        roughness: 0.3,
        metalness: 0,
        wireframe,
      }),
    [spec.innerColor, wireframe],
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
          linearDamping={0.02}
          angularDamping={0.02}
          onCollisionEnter={(payload) => registerCollision(fragment.id, payload)}
          onContactForce={(event) => registerForce(fragment.id, event)}
        >
          <mesh
            geometry={fragment.geometry}
            material={[outerMaterial, innerMaterial]}
            // material={[outerMaterial, outerMaterial]}
            castShadow
            receiveShadow
          />
        </RigidBody>
      ))}
      {debugEnabled ? (
        <group>
          {fragments.map((fragment) => {
            const body = fragmentRefs.current.get(fragment.id);
            if (!body) return null;
            const com = body.worldCom();
            return (
              <mesh key={`com-${fragment.id}`} position={[com.x, com.y, com.z]}> 
                <sphereGeometry args={[0.2, 8, 8]} />
                <meshBasicMaterial color="#00ffff" />
              </mesh>
            );
          })}
          {candidates.map((c) => {
            const bodyA = fragmentRefs.current.get(c.aId);
            const bodyB = fragmentRefs.current.get(c.bId);
            if (!bodyA || !bodyB) {
              console.log("bodyA or bodyB is null", bodyA, bodyB);
              return null;
            }
            const wca = bodyA.worldCom();
            const lca = bodyA.localCom();
            const ra = bodyA.rotation();
            const qa = new THREE.Quaternion(ra.x, ra.y, ra.z, ra.w);
            const wcb = bodyB.worldCom();
            const lcb = bodyB.localCom();
            const rb = bodyB.rotation();
            const qb = new THREE.Quaternion(rb.x, rb.y, rb.z, rb.w);

            return (
              <group key={`cand-${c.id}`}>
                {c.anchors.map((anchor, k) => {
                  const rec = jointRecordsRef.current.get(`${c.id}#${k}`);
                  if (!rec || rec.broken) return null;
                  const M = new THREE.Vector3(anchor[0], anchor[1], anchor[2]);
                  const wa = new THREE.Vector3(wca.x, wca.y, wca.z);
                  const wb = new THREE.Vector3(wcb.x, wcb.y, wcb.z);
                  const aLocal = M.clone().sub(wa).applyQuaternion(qa.clone().invert()).add(new THREE.Vector3(lca.x, lca.y, lca.z)).sub(new THREE.Vector3(lca.x, lca.y, lca.z)).applyQuaternion(qa);
                  const bLocal = M.clone().sub(wb).applyQuaternion(qb.clone().invert()).add(new THREE.Vector3(lcb.x, lcb.y, lcb.z)).sub(new THREE.Vector3(lcb.x, lcb.y, lcb.z)).applyQuaternion(qb);
                  const A = wa.clone().add(aLocal);
                  const B = wb.clone().add(bLocal);
                  const points = [A, B];
                  return (
                    <group key={`cand-${c.id}#${k}`}>
                      <mesh position={[A.x, A.y, A.z]}>
                        <sphereGeometry args={[0.2, 8, 8]} />
                        <meshBasicMaterial color="#00ff66" />
                        <Html position={[0.25, 0.25, 0]} distanceFactor={10} style={{ pointerEvents: "none" }}>
                          <div style={{ background: "rgba(0,0,0,0.6)", color: "#c7f7d4", padding: "2px 4px", borderRadius: 4, fontSize: 11 }}>
                            {`${A.x.toFixed(3)}, ${A.y.toFixed(3)}, ${A.z.toFixed(3)}`}
                          </div>
                        </Html>
                      </mesh>
                      <mesh position={[B.x, B.y, B.z]}>
                        <sphereGeometry args={[0.2, 8, 8]} />
                        <meshBasicMaterial color="#ff3366" />
                        <Html position={[0.25, 0.25, 0]} distanceFactor={10} style={{ pointerEvents: "none" }}>
                          <div style={{ background: "rgba(0,0,0,0.6)", color: "#ffd1dc", padding: "2px 4px", borderRadius: 4, fontSize: 11 }}>
                            {`${B.x.toFixed(3)}, ${B.y.toFixed(3)}, ${B.z.toFixed(3)}`}
                          </div>
                        </Html>
                      </mesh>
                      <Line points={points} color="#ffcc00" lineWidth={1.5} />
                    </group>
                  );
                })}
              </group>
            );
          })}
        </group>
      ) : null}
    </group>
  );
}

type ProjectileProps = {
  target: WallSpec;
};

function Projectile({ target }: ProjectileProps) {
  const bodyRef = useRef<RapierRigidBody | null>(null);
  const direction = DIRECTION_VECTOR[target.impactDirection];
  const axisIndex = AXIS_INDEX[target.impactDirection];

  const params = useMemo(() => {
    // const TEST_BALL = { radius: 0.12, mass: 7, restitution: 0.2 } as const;
    // const WRECKING_BALL = { radius: 0.45, mass: 90000, restitution: 0.05 } as const;
    const WRECKING_BALL = { radius: 0.45, mass: 900_000, restitution: 0.05 } as const;
    const profile = WRECKING_BALL;
    const radius = profile.radius * (1 + (Math.random() - 0.5) * 0.06);
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
    const start = worldTarget.clone().addScaledVector(dir, approachDistance - offset);

    // Ensure the start Y position is not higher than the top of the target
    const targetTopY = target.center[1] + target.size[1] * 0.5;
    if (start.y > targetTopY) {
      start.y = targetTopY;
    }

    const flightTime = 0.20 + Math.random() * 0.15;
    const g = -9.81;
    const vx = (worldTarget.x - start.x) / flightTime;
    const vz = (worldTarget.z - start.z) / flightTime;
    const vy = (worldTarget.y - start.y - 0.1 * g * flightTime * flightTime) / flightTime;

    const spin = {
      x: (Math.random() - 0.5) * 6,
      y: (Math.random() - 0.5) * 6,
      z: (Math.random() - 0.5) * 6,
    };

    // const volume = (4 / 3) * Math.PI * Math.pow(radius, 3);
    const mass = profile.mass;

    return {
      radius,
      start: [start.x, start.y, start.z] as [number, number, number],
      linvel: { x: vx, y: vy, z: vz },
      spin,
      restitution: profile.restitution,
      friction: 0.6,
      mass,
    } as const;
  }, [axisIndex, direction, target.center, target.size]);

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
      // Set mass explicitly to control impact energy independent of density
      mass={params.mass}
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
  jointsEnabled?: boolean;
  projectileEnabled?: boolean;
  debugEnabled?: boolean;
  paused?: boolean;
  wireframe?: boolean;
  sleep?: boolean;
};

function Scene({ structure, seed, jointsEnabled = true, projectileEnabled = true, debugEnabled = false, paused = false, wireframe = false, sleep = true }: SceneProps) {
  const projectileTarget = useMemo(() => {
    if (structure.walls.length === 0) return null;
    const index = Math.floor(Math.random() * structure.walls.length);
    return structure.walls[index];
  }, [structure]);

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

      <Physics gravity={[0, -9.81, 0]} debug={debugEnabled} paused={paused}>
        <Ground />
        {structure.walls.map((wall) => (
          <DestructibleWall key={`${wall.id}-${seed}`} spec={wall} jointsEnabled={jointsEnabled} debugEnabled={debugEnabled} wireframe={wireframe} sleep={sleep} />
        ))}
        {projectileEnabled && projectileTarget ? <Projectile key={`${projectileTarget.id}-${seed}`} target={projectileTarget} /> : null}
      </Physics>
      <gridHelper args={[40, 40, "#444", "#2d2d2d"]} position={[0, 0.01, 0]} />
      <StatsGl className="absolute top-60 left-2" />
    </Canvas>
  );
}

export default function Page() {
  const [structureId, setStructureId] = useState<StructureConfig["id"]>(STRUCTURES[0]?.id ?? "single-wall");
  const [iteration, setIteration] = useState(0);
  const [jointsEnabled, setJointsEnabled] = useState(false); // FIXME: Still not working well
  const [projectileEnabled, setProjectileEnabled] = useState(true);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [sleep, setSleep] = useState(true);
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
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#d1d5db", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={jointsEnabled}
            onChange={(event) => setJointsEnabled(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Enable joints (constraints between fragments)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#d1d5db", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={projectileEnabled}
            onChange={(event) => setProjectileEnabled(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Enable projectile
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#d1d5db", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={debugEnabled}
            onChange={(event) => setDebugEnabled(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Debug: Physics, anchors, COM
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#d1d5db", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(event) => setWireframe(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Wireframe walls
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#d1d5db", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Pause physics
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#d1d5db", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={sleep}
            onChange={(event) => setSleep(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Sleep fragments initially
        </label>
        <p style={{ margin: 0, color: "#d1d5db", fontSize: 14 }}>
          {jointsEnabled
            ? (structure?.description ?? "Fragments are glued by Rapier fixed joints until impacts rip them apart.")
            : "Fragments exist as separate pieces without constraints - they will scatter immediately when hit."}
        </p>
      </div>
      {structure ? <Scene key={`${structure.id}-${iteration}-${jointsEnabled}`} structure={structure} seed={iteration} jointsEnabled={jointsEnabled} projectileEnabled={projectileEnabled} debugEnabled={debugEnabled} paused={paused} wireframe={wireframe} sleep={sleep} /> : null}
    </div>
  );
}
