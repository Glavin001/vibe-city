"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, StatsGl } from '@react-three/drei';
import { Physics, RigidBody, CuboidCollider } from '@react-three/rapier';
import { fracture, FractureOptions } from '@dgreenheck/three-pinata';

type FragmentData = {
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
};

type RigidBodyLike = {
  setLinvel: (v: { x: number; y: number; z: number }, wake: boolean) => void;
  setAngvel: (v: { x: number; y: number; z: number }, wake: boolean) => void;
} | null;

type BlockConfig = {
  size: [number, number, number]; // [width, height, depth]
  position: [number, number, number];
  fragmentCount: number;
  fragmentDensity: number;
  fragmentFriction: number;
  fragmentRestitution: number;
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function generateBlockConfig(): BlockConfig {
  // Smaller, near ~1.2 cube by default, with mild/occasional variations
  const modes = [
    { w: [1.0, 1.4], h: [1.0, 1.4], d: [1.0, 1.4] }, // baseline around 1.2
    { w: [0.8, 1.1], h: [1.8, 2.6], d: [0.8, 1.1] }, // tall, slender pillar
    { w: [1.8, 2.6], h: [1.0, 1.8], d: [0.2, 0.35] }, // thin wall
    { w: [1.2, 1.8], h: [0.8, 1.2], d: [1.2, 1.8] }, // short slab
    { w: [1.3, 1.9], h: [1.3, 1.9], d: [1.0, 1.4] }, // slightly larger block
  ];
  const m = modes[Math.floor(Math.random() * modes.length)];
  const size: [number, number, number] = [rand(m.w[0], m.w[1]), rand(m.h[0], m.h[1]), rand(m.d[0], m.d[1])];

  // Place on ground, centered at x/z = 0
  const position: [number, number, number] = [0, size[1] / 2, 0];

  // Keep fragment count in a moderate range for performance & look
  const volume = size[0] * size[1] * size[2];
  const base = 26 + Math.round((volume - 1.4) * 3);
  const fragmentCount = Math.max(20, Math.min(50, base));

  // Light and varied physics feel
  const fragmentDensity = 0.18 + Math.random() * 0.22; // 0.18 - 0.40
  const fragmentFriction = 0.55 + Math.random() * 0.25;
  const fragmentRestitution = 0.12 + Math.random() * 0.2;

  return {
    size,
    position,
    fragmentCount,
    fragmentDensity,
    fragmentFriction,
    fragmentRestitution,
  };
}

function ShatterCube({ config }: { config: BlockConfig }) {
  const [shattered, setShattered] = useState(false);
  const [fragments, setFragments] = useState<FragmentData[] | null>(null);

  const cubePosition = config.position;
  const boxGeometry = useMemo(
    () => new THREE.BoxGeometry(config.size[0], config.size[1], config.size[2], 2, 2, 2),
    [config.size],
  );
  const fractureOptions = useMemo(() => {
    const opts = new FractureOptions();
    opts.fragmentCount = config.fragmentCount;
    return opts;
  }, [config.fragmentCount]);

  const outerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.1,
        roughness: 0.6,
      }),
    [],
  );
  const innerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xff5555,
        metalness: 0.0,
        roughness: 0.3,
      }),
    [],
  );

  const shatterNow = useCallback(() => {
    if (shattered) return;

    const result = fracture(boxGeometry, fractureOptions);
    const fragmentData: FragmentData[] = result.map((geom) => {
      geom.computeBoundingBox();
      const center = new THREE.Vector3();
      geom.boundingBox?.getCenter(center);
      // Center the fragment geometry around its local origin
      geom.translate(-center.x, -center.y, -center.z);
      return {
        geometry: geom,
        position: [
          cubePosition[0] + center.x,
          cubePosition[1] + center.y,
          cubePosition[2] + center.z,
        ],
      };
    });
    setFragments(fragmentData);
    setShattered(true);
  }, [shattered, boxGeometry, fractureOptions, cubePosition]);

  const handleCollisionEnter = useCallback((/* _e: any */) => {
    shatterNow();
  }, [shatterNow]);

  if (shattered && fragments) {
    return (
      <group>
        {fragments.map((frag) => (
          <RigidBody
            key={frag.geometry.uuid}
            colliders="hull"
            position={frag.position}
            restitution={config.fragmentRestitution}
            friction={config.fragmentFriction}
            density={config.fragmentDensity}
          >
            <mesh
              geometry={frag.geometry}
              material={[outerMaterial, innerMaterial]}
              castShadow
              receiveShadow
            />
          </RigidBody>
        ))}
      </group>
    );
  }

  return (
    <RigidBody
      type="fixed"
      colliders="cuboid"
      position={cubePosition}
      onCollisionEnter={handleCollisionEnter}
    >
      <mesh geometry={boxGeometry} castShadow receiveShadow>
        <meshStandardMaterial color="#bbbbbb" metalness={0.1} roughness={0.6} />
      </mesh>
    </RigidBody>
  );
}

function Projectile({ block }: { block: BlockConfig }) {
  const body = useRef<RigidBodyLike>(null);
  const setBodyRef = useCallback((node: unknown) => {
    body.current = (node as RigidBodyLike) ?? null;
  }, []);

  const params = useMemo(() => {
    // Randomize size slightly
    const radius = 0.4 * (1 + Math.random() * 0.5); // 0.4 - 0.6

    // Randomize start a bit, but keep it generally to the left of the cube
    const start: [number, number, number] = [
      -6,
      1 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.2,
    ];

    // Choose a hit point somewhere on/near the cube's face to vary impact
    const halfW = block.size[0] / 2;
    const halfD = block.size[2] / 2;
    const hit: [number, number, number] = [
      block.position[0] + (Math.random() - 0.5) * (halfW * 0.2), // a little left/right variance
      block.position[1] + (Math.random() * 0.8 - 0.4) * block.size[1], // vary vertically within ~80% of height
      block.position[2] + (Math.random() * 2 - 1) * halfD, // vary across the face width
    ];

    // Solve for exact ballistic velocity to reach the hit point in time t
    // Increase time slightly with wider x distance to maintain realistic speeds
    const baseT = 0.5 + Math.random() * 0.25; // 0.50 - 0.75s
    const dx = hit[0] - start[0];
    const t = baseT + Math.min(0.4, Math.max(0, (Math.abs(dx) - 5) * 0.02));
    const g = -9.81;
    const vx = (hit[0] - start[0]) / t;
    const vy = (hit[1] - start[1] - 0.5 * g * t * t) / t;
    const vz = (hit[2] - start[2]) / t;

    // Add some spin for visual interest
    const spin = {
      x: (Math.random() - 0.5) * 8,
      y: (Math.random() - 0.5) * 8,
      z: (Math.random() - 0.5) * 8,
    };

    const restitution = 0.4 + Math.random() * 0.2;
    const friction = 0.6 + Math.random() * 0.2;

    return {
      radius,
      start,
      linvel: { x: vx, y: vy, z: vz },
      spin,
      restitution,
      friction,
    } as const;
  }, [block]);

  useEffect(() => {
    const api = body.current;
    if (api) {
      api.setLinvel(params.linvel, true);
      api.setAngvel(params.spin, true);
    }
  }, [params]);

  return (
    <RigidBody
      ref={setBodyRef}
      position={params.start}
      colliders="ball"
      restitution={params.restitution}
      friction={params.friction}
    >
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[params.radius, 24, 24]} />
        <meshStandardMaterial color="#55aaff" metalness={0.1} roughness={0.3} />
      </mesh>
    </RigidBody>
  );
}

function Ground() {
  return (
    <RigidBody type="fixed" restitution={0} friction={1}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40, 1, 1]} />
        <meshStandardMaterial color="#444444" />
      </mesh>
      <CuboidCollider args={[20, 0.05, 20]} position={[0, 0, 0]} />
    </RigidBody>
  );
}

export default function Page() {
  const [key, setKey] = useState(0);
  const [block, setBlock] = useState<BlockConfig>(() => generateBlockConfig());
  const reset = useCallback(() => {
    setKey((k) => k + 1);
    setBlock(generateBlockConfig());
  }, []);
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <div
        style={{
          position: 'absolute',
          zIndex: 10,
          top: 12,
          left: 12,
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '8px 12px',
            background: '#111',
            color: 'white',
            borderRadius: 6,
            border: '1px solid #333',
          }}
        >
          Reset
        </button>
        <span style={{ color: '#ddd', alignSelf: 'center' }}>
          Sphere will hit and shatter a randomized block
        </span>
      </div>

      <Canvas key={key} shadows camera={{ position: [6, 4, 8], fov: 45 }}>
        <color attach="background" args={["#0f0f12"]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          castShadow
          position={[5, 6, 5]}
          intensity={1.3}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />

        <Physics gravity={[0, -9.81, 0]}>
          <Ground />
          <ShatterCube config={block} />
          <Projectile block={block} />
        </Physics>
        <StatsGl className="absolute top-20 left-2" />
      </Canvas>
    </div>
  );
}


