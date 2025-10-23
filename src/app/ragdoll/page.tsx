"use client";

import { useCallback, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { useControls } from "leva";
import { Ragdoll, createRagdollOrientation, type OrientationPreset, type RagdollOrientation } from "@/components/physics/Ragdoll";
import { RagdollTerrain, type TerrainPreset } from "@/components/physics/RagdollTerrain";

type Spawned = { id: string; pos: [number, number, number]; orientationObj: RagdollOrientation; color: string };

function Scene() {
  const [spawned, setSpawned] = useState<Spawned[]>([]);
  const idRef = useRef(0);
  const lastSpawnRef = useRef(0);
  // r3f event provides accurate intersections; no manual raycaster needed

  const { terrain, orientation, clearAll, spawnCount, spawnMinY, hoverOffset } = useControls("Ragdoll", {
    terrain: { value: "heightfield", options: ["flat", "ramps", "stairs", "boxes", "pillars", "heightfield"] as TerrainPreset[] },
    orientation: { value: "upright", options: ["random", "upright", "headfirst", "side", "faceDown"] as OrientationPreset[] },
    spawnCount: { value: 1, min: 1, max: 10, step: 1 },
    spawnMinY: { value: 3, min: 0.5, max: 12, step: 0.5 },
    hoverOffset: { value: 0.75, min: 0, max: 3, step: 0.05 },
    clearAll: { value: false },
  });

  // Clear when toggled
  useFrame(() => {
    if (clearAll) setSpawned([]);
  });

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    const now = performance.now();
    if (now - lastSpawnRef.current < 20) return; // debounce rapid duplicate events
    lastSpawnRef.current = now;
    // Use r3f event intersection point for accuracy (works on any mesh)
    const hp = e.point;
    const baseY = Math.max(spawnMinY, hp.y + hoverOffset + 2);
    const base = idRef.current++;
    const next: Spawned[] = [];
    for (let i = 0; i < spawnCount; i += 1) {
      const jitter: [number, number, number] = [
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.5,
      ];
      const pos: [number, number, number] = [hp.x + jitter[0], baseY + jitter[1], hp.z + jitter[2]];
      const preset = orientation as OrientationPreset;
      const orientationObj = createRagdollOrientation(preset);
      next.push({ id: `r${base}-${i}`, pos, orientationObj, color: pickColor() });
    }
    setSpawned((s) => [...s, ...next]);
  }, [hoverOffset, spawnMinY, spawnCount, orientation]);

  return (
    <group onPointerDown={handlePointerDown}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[7, 8, 5]} intensity={1.1} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <RagdollTerrain preset={terrain as TerrainPreset} />
      {spawned.map((s) => (
        <Ragdoll key={s.id} position={s.pos} orientation={s.orientationObj} color={s.color} />
      ))}
    </group>
  );
}

function pickColor() {
  const palette = ["#9ca3af", "#60a5fa", "#f59e0b", "#ef4444", "#22c55e", "#a78bfa"];
  return palette[Math.floor(Math.random() * palette.length)];
}

export default function Page() {
  const { debug, gravity, paused } = useControls("Ragdoll", {
    debug: false,
    gravity: { value: -9.81, min: -30, max: 0, step: 0.1 },
    paused: false,
  });

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <Canvas shadows camera={{ position: [8, 6, 10], fov: 45 }}>
        <color attach="background" args={["#0b0b0e"]} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.15} />
        <Physics gravity={[0, gravity, 0]} debug={debug} paused={paused}>
          <Scene />
        </Physics>
        <gridHelper args={[80, 80, "#3a3a3a", "#2a2a2a"]} position={[0, 0.01, 0]} />
        <StatsGl className="absolute top-4 left-4" />
      </Canvas>
    </div>
  );
}


