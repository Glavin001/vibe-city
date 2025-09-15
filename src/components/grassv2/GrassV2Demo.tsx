"use client";

import { Environment, OrbitControls, StatsGl } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Grass } from "./Grass";
import { Suspense } from "react";

export default function GrassV2Demo() {
  const scale = 4;
  return (
    <Canvas shadows camera={{ position: [10, 6, 10], fov: 45 }}>
      <Suspense fallback={null}>
        <color attach="background" args={["#9fd6ff"]} />
        <hemisphereLight intensity={0.65} groundColor="#7aa07a" />
        <directionalLight position={[10, 15, 10]} intensity={1.15} castShadow />

         <Grass width={80*scale} instances={80000*scale*scale} />

        <Environment preset="sunset" />
        <OrbitControls makeDefault />
      </Suspense>
      <StatsGl />
    </Canvas>
  );
}


