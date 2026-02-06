"use client";

import { useEffect, useRef, useState } from "react";
import { RigidBody, CuboidCollider, BallCollider, CylinderCollider, CapsuleCollider } from "@react-three/rapier";
import * as THREE from "three";

export type NavMeshDebrisSpawnerProps = {
  count?: number;
  spawnArea?: { x: number; z: number; y?: number };
  spawnHeight?: number;
  respawnInterval?: number;
  minSize?: number;
  maxSize?: number;
};

type DebrisShape = "box" | "sphere" | "cylinder" | "capsule" | "longBox" | "wideBox";

function randomRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomColor(): string {
  const colors = [
    "#ff6b6b", "#4ecdc4", "#ffe66d", "#95e1d3", "#f38181",
    "#aa96da", "#fcbad3", "#fad3cf", "#a8d8ea", "#c7ceea",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function DebrisItem({
  position,
  shape,
  size,
  color,
}: {
  position: [number, number, number];
  shape: DebrisShape;
  size: number;
  color: string;
}) {
  const rigidBodyRef = useRef<any>(null);

  useEffect(() => {
    // Add some initial rotation velocity
    if (rigidBodyRef.current?.rigidBody) {
      rigidBodyRef.current.rigidBody.setAngvel(
        {
          x: (Math.random() - 0.5) * 2,
          y: (Math.random() - 0.5) * 2,
          z: (Math.random() - 0.5) * 2,
        },
        true,
      );
    }
  }, []);

  let geometry: THREE.BufferGeometry;
  let collider: React.ReactNode;

  switch (shape) {
    case "box": {
      const halfSize = size / 2;
      geometry = new THREE.BoxGeometry(size, size, size);
      collider = <CuboidCollider args={[halfSize, halfSize, halfSize]} />;
      break;
    }
    case "longBox": {
      // Elongated box (longer in one dimension)
      const width = size * 0.6;
      const height = size * 1.4;
      const depth = size * 0.6;
      geometry = new THREE.BoxGeometry(width, height, depth);
      collider = <CuboidCollider args={[width / 2, height / 2, depth / 2]} />;
      break;
    }
    case "wideBox": {
      // Wide flat box
      const width = size * 1.2;
      const height = size * 0.4;
      const depth = size * 1.2;
      geometry = new THREE.BoxGeometry(width, height, depth);
      collider = <CuboidCollider args={[width / 2, height / 2, depth / 2]} />;
      break;
    }
    case "sphere": {
      geometry = new THREE.SphereGeometry(size, 16, 16);
      collider = <BallCollider args={[size]} />;
      break;
    }
    case "cylinder": {
      const radius = size * 0.6;
      const halfHeight = size * 0.5;
      geometry = new THREE.CylinderGeometry(radius, radius, size, 16);
      collider = <CylinderCollider args={[halfHeight, radius]} />;
      break;
    }
    case "capsule": {
      const radius = size * 0.4;
      const halfHeight = size * 0.3;
      // Capsule visual: cylinder with rounded ends
      // Use cylinder geometry for simplicity (matches capsule shape well)
      geometry = new THREE.CylinderGeometry(radius, radius, size * 0.6, 16);
      collider = <CapsuleCollider args={[halfHeight, radius]} />;
      break;
    }
  }

  return (
    <RigidBody
      ref={rigidBodyRef}
      position={position}
      type="dynamic"
      colliders={false}
      restitution={randomRange(0.1, 0.3)}
      friction={0.6}
      density={1.0}
      linearDamping={0.75}
      angularDamping={0.6}
    >
      {collider}
      <mesh castShadow receiveShadow>
        <primitive object={geometry} />
        <meshStandardMaterial color={color} />
      </mesh>
    </RigidBody>
  );
}

export function NavMeshDebrisSpawner({
  count = 20,
  spawnArea = { x: 30, z: 30 },
  spawnHeight = 15,
  respawnInterval = 10000,
  minSize = 0.4,
  maxSize = 1.2,
}: NavMeshDebrisSpawnerProps) {
  const spawnAreaX = spawnArea.x;
  const spawnAreaZ = spawnArea.z;
  const spawnAreaY = spawnArea.y ?? spawnHeight;

  const [debrisConfigs, setDebrisConfigs] = useState<Array<{
    id: number;
    position: [number, number, number];
    shape: DebrisShape;
    size: number;
    color: string;
  }>>([]);

  const spawnDebris = () => {
    const configs: Array<{
      id: number;
      position: [number, number, number];
      shape: DebrisShape;
      size: number;
      color: string;
    }> = [];

    for (let i = 0; i < count; i++) {
      const shapes: DebrisShape[] = ["box", "sphere", "cylinder", "capsule", "longBox", "wideBox"];
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      const size = randomRange(minSize, maxSize);
      const x = (Math.random() - 0.5) * spawnAreaX;
      const z = (Math.random() - 0.5) * spawnAreaZ;
      const y = spawnAreaY + Math.random() * 5;

      configs.push({
        id: i,
        position: [x, y, z],
        shape,
        size,
        color: randomColor(),
      });
    }

    setDebrisConfigs(configs);
  };

  useEffect(() => {
    spawnDebris();
    const interval = setInterval(() => {
      // Respawn all debris periodically
      spawnDebris();
    }, respawnInterval);

    return () => clearInterval(interval);
  }, [count, spawnAreaX, spawnAreaZ, spawnAreaY, minSize, maxSize, respawnInterval]);

  return (
    <>
      {debrisConfigs.map((config) => (
        <DebrisItem
          key={config.id}
          position={config.position}
          shape={config.shape}
          size={config.size}
          color={config.color}
        />
      ))}
    </>
  );
}
