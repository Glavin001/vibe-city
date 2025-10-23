"use client";

import { RigidBody, CuboidCollider, HeightfieldCollider } from "@react-three/rapier";
import type { HeightfieldArgs } from "@react-three/rapier";
import { useMemo } from "react";
import { PlaneGeometry } from "three";
import type { ThreeEvent } from "@react-three/fiber";

export type TerrainPreset = "flat" | "ramps" | "stairs" | "boxes" | "pillars" | "heightfield";

export function RagdollTerrain({ preset = "flat", onPointerDown }: { preset?: TerrainPreset; onPointerDown?: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group onPointerDown={(e) => onPointerDown?.(e)}>
      {preset === "flat" && <FlatPlane />}
      {preset === "ramps" && <Ramps />}
      {preset === "stairs" && <Stairs />}
      {preset === "boxes" && <Boxes />}
      {preset === "pillars" && <Pillars />}
      {preset === "heightfield" && <HeightfieldSmooth />}
    </group>
  );
}

function FlatPlane() {
  const size = 80;
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size, size, 1, 1]} />
        <meshStandardMaterial color="#2b2b2b" />
      </mesh>
      <CuboidCollider args={[size / 2, 0.05, size / 2]} position={[0, -0.05, 0]} />
    </RigidBody>
  );
}

function Ramps() {
  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[-8, 0.5, -6]} rotation={[0, 0.4, -0.35]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[12, 1, 6]} />
          <meshStandardMaterial color="#3c3c3c" />
        </mesh>
        <CuboidCollider args={[6, 0.5, 3]} />
      </RigidBody>
      <RigidBody type="fixed" colliders={false} position={[8, 0.5, 6]} rotation={[0, -0.4, 0.35]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[12, 1, 6]} />
          <meshStandardMaterial color="#3c3c3c" />
        </mesh>
        <CuboidCollider args={[6, 0.5, 3]} />
      </RigidBody>
      <FlatPlane />
    </group>
  );
}

function Stairs() {
  const steps = Array.from({ length: 8 }).map((_, i) => ({
    z: -8 + i * 1.2,
    y: 0.25 + i * 0.25,
  }));
  return (
    <group>
      <FlatPlane />
      {steps.map((s) => (
        <RigidBody key={`st-${s.z.toFixed(2)}`} type="fixed" colliders={false} position={[0, s.y, s.z]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[6, 0.5, 1.2]} />
            <meshStandardMaterial color="#454545" />
          </mesh>
          <CuboidCollider args={[3, 0.25, 0.6]} />
        </RigidBody>
      ))}
    </group>
  );
}

function Boxes() {
  const positions: { p: [number, number, number]; k: string }[] = [
    { p: [-6, 0.5, -5], k: "bx-1" },
    { p: [-4, 0.5, -2], k: "bx-2" },
    { p: [-2, 0.5, 2], k: "bx-3" },
    { p: [2, 0.5, -3], k: "bx-4" },
    { p: [5, 0.5, 4], k: "bx-5" },
  ];
  return (
    <group>
      <FlatPlane />
      {positions.map((it) => (
        <RigidBody key={it.k} type="fixed" colliders={false} position={it.p}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[2, 1, 2]} />
            <meshStandardMaterial color="#494949" />
          </mesh>
          <CuboidCollider args={[1, 0.5, 1]} />
        </RigidBody>
      ))}
    </group>
  );
}

function Pillars() {
  const xs = [-8, -4, 0, 4, 8];
  return (
    <group>
      <FlatPlane />
      {xs.map((x, i) => (
        <RigidBody key={`pl-${x}`} type="fixed" colliders={false} position={[x, 1.5, -4 + ((i % 2) ? 4 : 0)]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[1.2, 3, 1.2]} />
            <meshStandardMaterial color="#3d3d3d" />
          </mesh>
          <CuboidCollider args={[0.6, 1.5, 0.6]} />
        </RigidBody>
      ))}
    </group>
  );
}

function HeightfieldSmooth() {
  // World size (meters)
  const WIDTH = 80;
  const DEPTH = 80;
  // Vertices grid (WIDTH x DEPTH), quads = (WIDTH-1) x (DEPTH-1)
  const heights = useMemo(() => {
    const cols = WIDTH;
    const rows = DEPTH;
    const arr = new Array(cols * rows);
    for (let z = 0; z < rows; z += 1) {
      for (let x = 0; x < cols; x += 1) {
        const nx = x / (cols - 1);
        const nz = z / (rows - 1);
        // Higher spatial frequency for smaller hills/valleys
        const h = 0.8 * Math.sin(nx * Math.PI * 2 * 6) * Math.cos(nz * Math.PI * 2 * 6)
                + 0.4 * Math.sin((nx + nz) * Math.PI * 8)
                + 0.3 * Math.cos((nx - nz) * Math.PI * 10);
        arr[z * cols + x] = h; // amplitude in meters
      }
    }
    return arr;
  }, []);

  // Visual mesh matching the collider (row-major indexing)
  const geometry = useMemo(() => {
    const geo = new PlaneGeometry(WIDTH, DEPTH, WIDTH - 1, DEPTH - 1);
    const pos = geo.attributes.position as unknown as { count: number; setZ: (i: number, z: number) => void };
    for (let i = 0; i < pos.count; i += 1) {
      pos.setZ(i, heights[i] ?? 0);
    }
    // Align to Rapier heightfield orientation
    geo.scale(1, -1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }, [heights]);

  // Collider args: [widthQuads, depthQuads, heights[], scale]
  const hfArgs: HeightfieldArgs = useMemo(() => ([
    WIDTH - 1,
    DEPTH - 1,
    heights,
    { x: WIDTH, y: 1, z: DEPTH },
  ]), [heights]);

  return (
    <RigidBody type="fixed" colliders={false} position={[0, 1, 0]} name="Heightfield">
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial color="#ccb34a" side={2} />
      </mesh>
      <HeightfieldCollider args={hfArgs} />
    </RigidBody>
  );
}


