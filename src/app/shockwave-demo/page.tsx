"use client";

import { useMemo, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import { Shockwave, SHOCKWAVE_PRESETS } from "@/components/Shockwave";

type SceneKind = "ball-pit" | "box-tower";

function GroundAndBounds({ size = 100, floorThickness = 0.1, wallHeight = 6, ceiling = false }: { size?: number; floorThickness?: number; wallHeight?: number; ceiling?: boolean }) {
  const half = size / 2;
  const t = 0.25; // wall thickness
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]} friction={0.9}>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
      <CuboidCollider args={[half, floorThickness / 2, half]} position={[0, -floorThickness / 2, 0]} />
      {/* Tall container walls */}
      <CuboidCollider args={[t, wallHeight / 2, half]} position={[half + t, wallHeight / 2, 0]} />
      <CuboidCollider args={[t, wallHeight / 2, half]} position={[-half - t, wallHeight / 2, 0]} />
      <CuboidCollider args={[half, wallHeight / 2, t]} position={[0, wallHeight / 2, half + t]} />
      <CuboidCollider args={[half, wallHeight / 2, t]} position={[0, wallHeight / 2, -half - t]} />
      {ceiling ? (
        <CuboidCollider args={[half, t, half]} position={[0, wallHeight + t, 0]} />
      ) : null}
    </RigidBody>
  );
}

function BallPit({ count = 64, ceiling = false }: { count?: number; ceiling?: boolean }) {
  const balls = useMemo(() => {
    const arr: { id: number; r: number; pos: [number, number, number]; color: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const r = 0.18 + Math.random() * 0.12;
      const x = (Math.random() * 2 - 1) * 4.5;
      const z = (Math.random() * 2 - 1) * 4.5;
      const y = 1 + Math.random() * 2.0;
      const hue = Math.floor(Math.random() * 360);
      arr.push({ id: i, r, pos: [x, y, z], color: `hsl(${hue}deg 70% 55%)` });
    }
    return arr;
  }, [count]);
  return (
    <group>
      <GroundAndBounds floorThickness={0.1} wallHeight={6} ceiling={ceiling} />
      {balls.map((b) => (
        <RigidBody key={b.id} colliders="ball" friction={0.8} restitution={0.05} position={b.pos} linearDamping={0.15} angularDamping={0.15} density={1.5}>
          <mesh castShadow receiveShadow>
            <sphereGeometry args={[b.r, 24, 20]} />
            <meshStandardMaterial color={b.color} roughness={0.45} metalness={0.05} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

function BoxTower({ levels = 12, span = 5, size = 0.5, ceiling = false }: { levels?: number; span?: number; size?: number; ceiling?: boolean }) {
  const boxes = useMemo(() => {
    const arr: { id: string; pos: [number, number, number] }[] = [];
    for (let y = 0; y < levels; y += 1) {
      for (let i = 0; i < span; i += 1) {
        for (let j = 0; j < span; j += 1) {
          const x = (i - (span - 1) / 2) * (size * 1.05);
          const z = (j - (span - 1) / 2) * (size * 1.05);
          const ry = y * (size * 1.02) + size * 0.55;
          arr.push({ id: `${y}-${i}-${j}`, pos: [x, ry, z] });
        }
      }
    }
    return arr;
  }, [levels, span, size]);
  return (
    <group>
      <GroundAndBounds floorThickness={0.1} wallHeight={7} ceiling={ceiling} />
      {boxes.map((b) => (
        <RigidBody key={b.id} colliders="cuboid" friction={0.9} restitution={0.03} position={b.pos} linearDamping={0.2} angularDamping={0.2} density={2.0}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[size, size, size]} />
            <meshStandardMaterial color="#c9c9c9" roughness={0.7} metalness={0.02} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

function DebrisLayer({ count = 100 }: { count?: number }) {
  const pieces = useMemo(() => {
    const arr: { id: number; pos: [number, number, number]; size: [number, number, number]; color: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const sx = 0.08 + Math.random() * 0.06;
      const sy = 0.02 + Math.random() * 0.02;
      const sz = 0.08 + Math.random() * 0.06;
      const x = (Math.random() * 2 - 1) * 5.5;
      const z = (Math.random() * 2 - 1) * 5.5;
      const y = 0.15 + Math.random() * 0.8;
      const hue = Math.floor(180 + Math.random() * 60);
      arr.push({ id: i, pos: [x, y, z], size: [sx, sy, sz], color: `hsl(${hue}deg 35% 65%)` });
    }
    return arr;
  }, [count]);
  return (
    <group>
      {pieces.map((p) => (
        <RigidBody key={p.id} colliders="cuboid" friction={0.6} restitution={0.0} position={p.pos} linearDamping={0.8} angularDamping={0.8} density={0.05}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={p.size} />
            <meshStandardMaterial color={p.color} roughness={0.85} metalness={0.0} />
          </mesh>
        </RigidBody>
      ))}
    </group>
  );
}

function CarShell({ position = [2.5, 0.9, 0] as [number, number, number] }) {
  const bodySize: [number, number, number] = [3.6, 1.2, 1.6];
  return (
    <RigidBody colliders="cuboid" position={position} friction={0.9} restitution={0.02} linearDamping={0.12} angularDamping={0.12} density={6.0}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={bodySize} />
        <meshStandardMaterial color="#6b7280" roughness={0.6} metalness={0.15} />
      </mesh>
    </RigidBody>
  );
}

export default function Page() {
  const [scene, setScene] = useState<SceneKind>("ball-pit");
  const presetNames = useMemo(() => Object.keys(SHOCKWAVE_PRESETS) as Array<keyof typeof SHOCKWAVE_PRESETS>, []);
  const [preset, setPreset] = useState<keyof typeof SHOCKWAVE_PRESETS>(presetNames.includes("C4_2kg_Surface") ? "C4_2kg_Surface" : presetNames[0]);
  const [blastAt, setBlastAt] = useState<{ x: number; y: number; z: number } | null>(null);
  const [iteration, setIteration] = useState(0);
  const [ceiling, setCeiling] = useState(false);
  const [debris, setDebris] = useState(false);
  const [car, setCar] = useState(false);

  const triggerExplosion = useCallback(() => {
    // Fixed origin near ground center; tweak by scene
    const origin = scene === "box-tower" ? { x: 1.0, y: 0.9, z: 0 } : { x: 0, y: 0.8, z: 0 };
    setBlastAt(origin);
  }, [scene]);

  const selected = SHOCKWAVE_PRESETS[preset];

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
          maxWidth: 420,
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={scene}
            onChange={(e) => setScene(e.target.value as SceneKind)}
            style={{ background: "#111", color: "#eee", border: "1px solid #333", borderRadius: 6, padding: "8px 10px", flex: 1 }}
          >
            <option value="ball-pit">Ball pit</option>
            <option value="box-tower">Tower of boxes</option>
          </select>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as keyof typeof SHOCKWAVE_PRESETS)}
            style={{ background: "#111", color: "#eee", border: "1px solid #333", borderRadius: 6, padding: "8px 10px", flex: 1 }}
          >
            {presetNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d1d5db", fontSize: 14 }}>
            <input type="checkbox" checked={ceiling} onChange={(e) => setCeiling(e.target.checked)} style={{ accentColor: "#4da2ff", width: 16, height: 16 }} />
            Ceiling
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d1d5db", fontSize: 14 }}>
            <input type="checkbox" checked={debris} onChange={(e) => setDebris(e.target.checked)} style={{ accentColor: "#4da2ff", width: 16, height: 16 }} />
            Debris layer
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#d1d5db", fontSize: 14 }}>
            <input type="checkbox" checked={car} onChange={(e) => setCar(e.target.checked)} style={{ accentColor: "#4da2ff", width: 16, height: 16 }} />
            Car shell
          </label>
        </div>
        <button
          type="button"
          onClick={triggerExplosion}
          style={{ padding: "8px 14px", background: "#0d0d0d", color: "white", borderRadius: 6, border: "1px solid #303030" }}
        >
          Explode
        </button>
        <button
          type="button"
          onClick={() => { setBlastAt(null); setIteration((v) => v + 1); }}
          style={{ padding: "8px 14px", background: "#0d0d0d", color: "white", borderRadius: 6, border: "1px solid #303030" }}
        >
          Reset
        </button>
        <div style={{ background: "rgba(0,0,0,0.7)", border: "1px solid #333", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#d1d5db" }}>
          <div style={{ fontWeight: "bold", marginBottom: 6, color: "#fff" }}>Preset: {preset}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: 12 }}>
            <div><strong>Explosion:</strong></div>
            <div>
              {selected.explosion.type === "tnt" 
                ? `${selected.explosion.tntKg}kg TNT`
                : selected.explosion.type === "he"
                ? `${selected.explosion.massKg}kg HE (${selected.explosion.equivalency || 1.0}x)`
                : `${(selected.explosion.joules / 1e9).toFixed(1)}GJ energy`
              }
            </div>
            <div><strong>Burst:</strong></div>
            <div>{selected.explosion.burst || "surface"}</div>
            <div><strong>Front Speed:</strong></div>
            <div>{selected.frontSpeed}m/s</div>
            <div><strong>Force Scale:</strong></div>
            <div>{selected.forceScale}</div>
            <div><strong>Afterflow Scale:</strong></div>
            <div>{selected.afterflowScale}</div>
            {(selected as any).thickness && (
              <>
                <div><strong>Thickness:</strong></div>
                <div>{(selected as any).thickness}m</div>
              </>
            )}
            {(selected as any).maxDistance && (
              <>
                <div><strong>Max Distance:</strong></div>
                <div>{(selected as any).maxDistance}m</div>
              </>
            )}
          </div>
        </div>
      </div>
      <Canvas key={iteration} shadows camera={{ position: [8, 6, 10], fov: 45 }}>
        <color attach="background" args={["#0e0e12"]} />
        <ambientLight intensity={0.35} />
        <directionalLight castShadow position={[6, 8, 6]} intensity={1.2} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.15} />
        <Physics gravity={[0, -9.81, 0]}>
          {scene === "ball-pit"
            ? <BallPit ceiling={ceiling} />
            : <BoxTower ceiling={ceiling} />
          }
          {debris ? <DebrisLayer /> : null}
          {car ? <CarShell position={scene === "box-tower" ? [2.5, 0.9, 0] : [3.2, 0.9, -2.4]} /> : null}
          {blastAt ? (
            <Shockwave
              origin={blastAt}
              explosion={selected.explosion}
              frontSpeed={selected.frontSpeed}
              forceScale={selected.forceScale}
              afterflowScale={selected.afterflowScale}
              occlusion={false}
              // onDone={() => setBlastAt(null)}
            />
          ) : null}
        </Physics>
        <gridHelper args={[40, 40, "#444", "#2d2d2d"]} position={[0, 0.01, 0]} />
        <StatsGl className="absolute top-100 left-2" />
      </Canvas>
    </div>
  );
}


