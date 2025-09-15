"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  Finishes,
  type WoodFinish,
  WoodGenuses,
  type WoodGenus,
  WoodNodeMaterial,
} from "three/examples/jsm/materials/WoodNodeMaterial.js";

function WoodBlock({
  genus,
  finish,
  position,
}: {
  genus: WoodGenus;
  finish: WoodFinish;
  position: [number, number, number];
}) {
  const material = useMemo(
    () => WoodNodeMaterial.fromPreset(genus, finish),
    [genus, finish],
  );
  const geometry = useMemo(
    () => new RoundedBoxGeometry(0.125, 0.9, 0.9, 10, 0.02),
    [],
  );
  return <mesh geometry={geometry} material={material} position={position} />;
}

function WoodScene() {
  return WoodGenuses.flatMap((genus, x) =>
    Finishes.map((finish, y) => {
      const position: [number, number, number] = [
        (x - WoodGenuses.length / 2) * 1,
        (Finishes.length / 2 - y) * 1,
        0,
      ];
      return (
        <WoodBlock
          key={`${genus}-${finish}`}
          genus={genus}
          finish={finish}
          position={position}
        />
      );
    }),
  );
}

export default function WoodPage() {
  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-8">
        <h1 className="text-4xl font-bold text-white mb-4">
          Procedural Wood Materials
        </h1>
        <p className="text-gray-300 mb-8">
          Demonstrates <code>WoodNodeMaterial</code> from three.js using React
          Three Fiber.
        </p>
        <div className="w-full h-[600px] bg-black rounded-lg overflow-hidden">
          <Canvas camera={{ position: [0, 5, 7], fov: 45 }}>
            <Suspense fallback={null}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[5, 10, 5]} intensity={1} />
              <WoodScene />
              <Environment
                files="https://threejs.org/examples/textures/equirectangular/san_giuseppe_bridge_2k.hdr"
                background
              />
              <OrbitControls />
            </Suspense>
          </Canvas>
        </div>
        <div className="mt-6">
          <a
            href="/"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
