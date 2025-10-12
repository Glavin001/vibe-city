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
import type { CollisionEnterPayload, ContactForcePayload, RapierRigidBody } from "@react-three/rapier";
// import { fracture, FractureOptions } from "@dgreenheck/three-pinata";
import { Shockwave, SHOCKWAVE_PRESETS } from "@/components/Shockwave";
import { DestructibleWall as SharedDestructibleWall } from "@/components/destruction/DestructibleWall";

const IDENTITY_QUATERNION = { w: 1, x: 0, y: 0, z: 0 } as const;
// Physical densities in kg/m^3 (Rapier uses SI units when gravity is ~9.81)
// const CONCRETE_DENSITY = 2400; // normal-weight concrete
// const CONCRETE_DENSITY = 0.240; // normal-weight concrete
// const STEEL_DENSITY = 7850; // structural steel (approx.)
// const CONCRETE_FRICTION = 1.7; //0.7;
// const CONCRETE_RESTITUTION = 0.08;

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

// Legacy destructible-wall implementation removed; using shared component instead

// Legacy destructible-wall implementation removed; using shared component instead

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

// Legacy destructible-wall implementation removed; using shared component instead
// Removed legacy; referencing shared component instead
// Removed legacy implementation; shared component handles fracturing
// Removed legacy implementation
// Removed legacy implementation
// Removed legacy implementation
// Removed legacy implementation
// Removed legacy implementation

// Legacy destructible-wall implementation removed; using shared component instead
// Removed legacy; referencing shared component instead
function getSupportPointLocal(geometry: THREE.BufferGeometry, direction: THREE.Vector3) {
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

// Legacy destructible-wall implementation removed; using shared component instead
// Removed legacy; referencing shared component instead
function projectExtentsOnAxisWorld(geometry: THREE.BufferGeometry, worldPos: THREE.Vector3, axis: THREE.Vector3) {
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

// Legacy destructible-wall implementation removed; using shared component instead
// Removed legacy; referencing shared component instead
function overlap1D(a: { min: number; max: number }, b: { min: number; max: number }) {
  return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
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

// NOTE: Local DestructibleWall implementation kept for reference.
// The page now imports and uses the shared component from components/destruction/DestructibleWall.
// If you need to switch back, rename this to avoid shadowing the import.
// /* biome-ignore lint/suspicious/noUnusedVariables: kept for reference only */
// function LegacyDestructibleWall({
//   spec,
//   density = CONCRETE_DENSITY,
//   friction = CONCRETE_FRICTION,
//   restitution = CONCRETE_RESTITUTION,
//   jointsEnabled = true,
//   debugEnabled = false,
//   wireframe = false,
//   sleep = true,
// }: DestructibleWallProps) {
//   const fragments = useMemo(() => buildFragments(spec), [spec]);
//   const candidates = useMemo(() => computeJointCandidates(spec, fragments), [spec, fragments]);
//
//   useEffect(() => {
//     return () => {
//       for (const fragment of fragments) {
//         fragment.geometry.dispose();
//       }
//     };
//   }, [fragments]);
//
//   const fragmentRefs = useRef<FragmentRefs>(new Map());
//   const [, setRefsVersion] = useState(0);
//   const setFragmentRef = useCallback(
//     (id: string) => (body: RapierRigidBody | null) => {
//       fragmentRefs.current.set(id, body);
//       if (sleep) {
//         body?.sleep();
//       }
//       setRefsVersion((v) => v + 1);
//     },
//     [sleep],
//   );
//
//   const [, setJointVersion] = useState(0);
//   const { registerForce, registerCollision, jointRecordsRef } = useJointGlue(
//     fragments,
//     candidates,
//     fragmentRefs.current,
//     jointsEnabled,
//     useCallback(() => setJointVersion((v) => v + 1), []),
//   );
//
//   const outerMaterial = useMemo(
//     () =>
//       new THREE.MeshStandardMaterial({
//         color: spec.outerColor ?? 0xbababa,
//         roughness: 0.62,
//         metalness: 0.05,
//         wireframe,
//       }),
//     [spec.outerColor, wireframe],
//   );
//   const innerMaterial = useMemo(
//     () =>
//       new THREE.MeshStandardMaterial({
//         color: spec.innerColor ?? 0xbf4b4b,
//         roughness: 0.3,
//         metalness: 0,
//         wireframe,
//       }),
//     [spec.innerColor, wireframe],
//   );
//
//   useEffect(() => {
//     return () => {
//       outerMaterial.dispose();
//       innerMaterial.dispose();
//     };
//   }, [innerMaterial, outerMaterial]);
//
//   return (
//     <group>
//       {fragments.map((fragment) => (
//         <RigidBody
//           key={fragment.id}
//           ref={setFragmentRef(fragment.id)}
//           position={fragment.worldPosition}
//           colliders="hull"
//           friction={friction}
//           restitution={restitution}
//           density={density}
//           linearDamping={0.02}
//           angularDamping={0.02}
//           onCollisionEnter={(payload) => registerCollision(fragment.id, payload)}
//           onContactForce={(event) => registerForce(fragment.id, event)}
//         >
//           <mesh
//             geometry={fragment.geometry}
//             material={[outerMaterial, innerMaterial]}
//             castShadow
//             receiveShadow
//           />
//         </RigidBody)
//       ))}
//     </group>
//   );
// }

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

// Configurable ground size variables
const GROUND_SIZE = 200; // visual size (width and depth)
const GROUND_THICKNESS = 0.1; // collider thickness
const GROUND_HALF_SIZE = GROUND_SIZE / 2;

function Ground() {
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]} friction={0.9}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
      <CuboidCollider
        args={[GROUND_HALF_SIZE, GROUND_THICKNESS / 2, GROUND_HALF_SIZE]}
        position={[0, -GROUND_THICKNESS / 2, 0]}
      />
    </RigidBody>
  );
}

type SceneProps = {
  structure: StructureConfig;
  seed: number;
  jointsEnabled?: boolean;
  projectileEnabled?: boolean;
  shockwaveEnabled?: boolean;
  debugEnabled?: boolean;
  paused?: boolean;
  wireframe?: boolean;
  sleep?: boolean;
};

function Scene({ structure, seed, jointsEnabled = true, projectileEnabled = true, shockwaveEnabled = false, debugEnabled = false, paused = false, wireframe = false, sleep = true }: SceneProps) {
  const projectileTarget = useMemo(() => {
    if (structure.walls.length === 0) return null;
    const index = Math.floor(Math.random() * structure.walls.length);
    return structure.walls[index];
  }, [structure]);

  // Compute structure bounds and expand them for shockwave placement
  const expandedBounds = useMemo(() => {
    if (!structure || structure.walls.length === 0) {
      return {
        center: new THREE.Vector3(0, 1, 0),
        half: new THREE.Vector3(4, 2, 4),
      };
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const w of structure.walls) {
      const cx = w.center[0], cy = w.center[1], cz = w.center[2];
      const hx = w.size[0] * 0.5, hy = w.size[1] * 0.5, hz = w.size[2] * 0.5;
      minX = Math.min(minX, cx - hx);
      maxX = Math.max(maxX, cx + hx);
      minY = Math.min(minY, Math.max(0, cy - hy));
      maxY = Math.max(maxY, cy + hy);
      minZ = Math.min(minZ, cz - hz);
      maxZ = Math.max(maxZ, cz + hz);
    }
    const center = new THREE.Vector3(
      (minX + maxX) * 0.5,
      (minY + maxY) * 0.5,
      (minZ + maxZ) * 0.5,
    );
    const half = new THREE.Vector3(
      (maxX - minX) * 0.5,
      (maxY - minY) * 0.5,
      (maxZ - minZ) * 0.5,
    );
    // Expand to about twice the size
    half.multiplyScalar(2);
    // Ensure some minimum range
    half.x = Math.max(half.x, 2);
    half.y = Math.max(half.y, 1.2);
    half.z = Math.max(half.z, 2);
    return { center, half };
  }, [structure]);

  const [blastAt, setBlastAt] = useState<{ x: number; y: number; z: number } | null>(null);
  const nextTimerRef = useRef<number | null>(null);

  const pickRandomBlast = useCallback(() => {
    const c = expandedBounds.center;
    const h = expandedBounds.half;
    const rx = c.x + (Math.random() * 2 - 1) * h.x;
    const ry = Math.max(0.12, c.y + (Math.random() * 2 - 1) * h.y);
    const rz = c.z + (Math.random() * 2 - 1) * h.z;
    return { x: rx, y: ry, z: rz } as const;
  }, [expandedBounds]);

  useEffect(() => {
    // Clear any pending timer on deps change
    if (nextTimerRef.current) {
      clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
    if (!shockwaveEnabled) {
      setBlastAt(null);
      return;
    }
    // Schedule first blast shortly after enabling
    const delay = 600 + Math.random() * 1400;
    // const delay = 0;
    nextTimerRef.current = window.setTimeout(() => {
      setBlastAt(pickRandomBlast());
    }, delay) as unknown as number;
    return () => {
      if (nextTimerRef.current) {
        clearTimeout(nextTimerRef.current);
        nextTimerRef.current = null;
      }
    };
  }, [shockwaveEnabled, pickRandomBlast]);

  /*
  useEffect(() => {
    if (!shockwaveEnabled) return;
    if (blastAt !== null) return;
    // When a blast finishes (blastAt cleared), queue the next one
    const delay = 900 + Math.random() * 1800;
    nextTimerRef.current = window.setTimeout(() => {
      setBlastAt(pickRandomBlast());
    }, delay) as unknown as number;
    return () => {
      if (nextTimerRef.current) {
        clearTimeout(nextTimerRef.current);
        nextTimerRef.current = null;
      }
    };
  }, [blastAt, shockwaveEnabled, pickRandomBlast]);
  */

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
          <SharedDestructibleWall key={`${wall.id}-${seed}`} spec={wall} jointsEnabled={jointsEnabled} debugEnabled={debugEnabled} wireframe={wireframe} sleep={sleep} />
        ))}
        {projectileEnabled && projectileTarget ? <Projectile key={`${projectileTarget.id}-${seed}`} target={projectileTarget} /> : null}
        {shockwaveEnabled && blastAt ? (
          <Shockwave
            origin={blastAt}
            explosion={SHOCKWAVE_PRESETS.Grenade_M67.explosion}
            frontSpeed={SHOCKWAVE_PRESETS.Grenade_M67.frontSpeed}
            afterflowScale={SHOCKWAVE_PRESETS.Grenade_M67.afterflowScale}
            occlusion={false}
            onDone={() => setBlastAt(null)}
          />
        ) : null}
      </Physics>
      <gridHelper args={[40, 40, "#444", "#2d2d2d"]} position={[0, 0.01, 0]} />
      <StatsGl className="absolute top-80 left-2" />
    </Canvas>
  );
}

export default function Page() {
  const [structureId, setStructureId] = useState<StructureConfig["id"]>(STRUCTURES[0]?.id ?? "single-wall");
  const [iteration, setIteration] = useState(0);
  const [jointsEnabled, setJointsEnabled] = useState(false); // FIXME: Still not working well
  const [projectileEnabled, setProjectileEnabled] = useState(true);
  const [shockwaveEnabled, setShockwaveEnabled] = useState(false);
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
            checked={shockwaveEnabled}
            onChange={(event) => setShockwaveEnabled(event.target.checked)}
            style={{
              accentColor: "#4da2ff",
              width: 16,
              height: 16,
            }}
          />
          Enable shockwaves
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
      {structure ? <Scene key={`${structure.id}-${iteration}-${jointsEnabled}`} structure={structure} seed={iteration} jointsEnabled={jointsEnabled} projectileEnabled={projectileEnabled} shockwaveEnabled={shockwaveEnabled} debugEnabled={debugEnabled} paused={paused} wireframe={wireframe} sleep={sleep} /> : null}
    </div>
  );
}
