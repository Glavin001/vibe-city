"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import {
  WoodNodeMaterial,
  type WoodGenus,
  type WoodFinish,
} from "three/examples/jsm/materials/WoodNodeMaterial.js";
import { useSearchParams } from "next/navigation";

function WoodScene() {
  const params = useSearchParams();
  const genus = params.get("genus") as WoodGenus | undefined;
  const finish = params.get("finish") as WoodFinish | undefined;

  const material = useMemo(
    () => WoodNodeMaterial.fromPreset(genus, finish),
    [genus, finish],
  );

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <h1 className="text-4xl font-bold text-white mb-4">
        Wood Material Preview
      </h1>
      <div className="w-full h-[400px] bg-black rounded-lg overflow-hidden">
        <Canvas camera={{ position: [3, 2, 3] }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} />
          <mesh castShadow receiveShadow material={material}>
            <boxGeometry args={[1.5, 1.5, 1.5]} />
          </mesh>
        </Canvas>
      </div>
      <div className="mt-6">
        <a
          href="/three"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          ← Back to Three.js Demos
        </a>
      </div>
    </div>
  );
}

export default function WoodPage() {
  return (
    <Suspense fallback={null}>
      <WoodScene />
    </Suspense>
  );
}
