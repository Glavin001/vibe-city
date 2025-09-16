"use client";

import { Environment, OrbitControls, StatsGl } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import GrassField, { type RingConfig } from "./GrassField";

export default function GrassV2Demo() {
  const rings: RingConfig[] = useMemo(() => {
    return [
      { maxDistanceTiles: 1, joints: 5, densityPerUnit2: 10.0, bladeHeight: 1.1, useInteract: true, maxPerTile: 120000 },
      // { maxDistanceTiles: 3, joints: 3, densityPerUnit2: 0.2, bladeHeight: 1.0, useInteract: false, maxPerTile: 15000 },
      // { maxDistanceTiles: 6, joints: 2, densityPerUnit2: 0.01, bladeHeight: 1.0, useInteract: false, maxPerTile: 4000 },
    ];
  }, []);
  return (
    <Canvas shadows camera={{ position: [10, 6, 10], fov: 45, far: 20000 }}>
      <Suspense fallback={null}>
        <color attach="background" args={["#9fd6ff"]} />
        <hemisphereLight intensity={0.65} groundColor="#7aa07a" />
        <directionalLight position={[10, 15, 10]} intensity={1.15} castShadow />

        <GrassField
          tileSize={64}
          rings={rings}
          absMaxPerTile={150000}
          maxGlobalInstances={600000}
          interactionSize={512}
          interactionFadeFps={30}
          groundSegmentsPerTile={6}
          showBalls={false}
        />

        <Environment preset="sunset" />
        <OrbitControls makeDefault />
      </Suspense>
      <StatsGl className="stats absolute" />
    </Canvas>
  );
}


