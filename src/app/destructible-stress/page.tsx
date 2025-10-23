"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { buildDestructibleCore } from "@/lib/stress/core/destructible-core";
import type { DestructibleCore } from "@/lib/stress/core/types";
import { buildWallScenario } from "@/lib/stress/scenarios/wallScenario";
import { buildChunkMeshes, buildSolverDebugHelper, updateChunkMeshes, updateProjectileMeshes } from "@/lib/stress/three/destructible-adapter";
import RapierDebugRenderer from "@/lib/rapier/rapier-debug-renderer";

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#3d3d3d" />
      </mesh>
    </group>
  );
}

type SceneProps = {
  debug: boolean;
  physicsWireframe: boolean;
  gravity: number;
  iteration: number;
  projType: 'ball' | 'box';
  projectileSpeed: number;
  projectileMass: number;
  materialScale: number;
  wallSpan: number;
  wallHeight: number;
  wallThickness: number;
  wallSpanSeg: number;
  wallHeightSeg: number;
  wallLayers: number;
  showAllDebugLines: boolean;
  bondsXEnabled: boolean;
  bondsYEnabled: boolean;
  bondsZEnabled: boolean;
  onReset: () => void;
};

function Scene({ debug, physicsWireframe, gravity, iteration, projType, projectileSpeed, projectileMass, materialScale, wallSpan, wallHeight, wallThickness, wallSpanSeg, wallHeightSeg, wallLayers, showAllDebugLines, bondsXEnabled, bondsYEnabled, bondsZEnabled, onReset: _onReset }: SceneProps) {
  const coreRef = useRef<DestructibleCore | null>(null);
  const debugHelperRef = useRef<ReturnType<typeof buildSolverDebugHelper> | null>(null);
  const chunkMeshesRef = useRef<THREE.Mesh[] | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera as THREE.Camera);
  const scene = useThree((s) => s.scene as THREE.Scene);
  const rapierDebugRef = useRef<RapierDebugRenderer | null>(null);
  const isDev = true; //process.env.NODE_ENV !== 'production';

  const placeClickMarker = useCallback((pos: THREE.Vector3) => {
    if (!groupRef.current) return;
    const g = new THREE.SphereGeometry(0.08, 16, 16);
    const m = new THREE.MeshBasicMaterial({ color: 0xff3333 });
    const marker = new THREE.Mesh(g, m);
    marker.position.copy(pos);
    marker.renderOrder = 9999;
    groupRef.current.add(marker);
    setTimeout(() => {
      try {
        groupRef.current?.remove(marker);
        g.dispose();
        m.dispose();
      } catch {}
    }, 1500);
  }, []);
//   const camera = useThree((s) => s.camera as THREE.Camera);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const scenario = buildWallScenario({ span: wallSpan, height: wallHeight, thickness: wallThickness, spanSegments: wallSpanSeg, heightSegments: wallHeightSeg, layers: wallLayers, bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled });
      const core = await buildDestructibleCore({
        scenario,
        nodeSize: (_index, scen) => {
          const sp = scen.spacing ?? { x: 0.5, y: 0.5, z: 0.32 };
          return { x: sp.x, y: sp.y, z: sp.z };
        },
        gravity,
      });
      if (!mounted) { core.dispose(); return; }
      coreRef.current = core;

      const { objects } = buildChunkMeshes(core);
      chunkMeshesRef.current = objects;
      for (const o of objects) groupRef.current?.add(o);

      const helper = buildSolverDebugHelper();
      debugHelperRef.current = helper;
      groupRef.current?.add(helper.object);

      // Setup Rapier wireframe renderer (dispose previous if any)
      try {
        if (rapierDebugRef.current) {
          rapierDebugRef.current.dispose({});
          rapierDebugRef.current = null;
        }
        // Always create; enable state is controlled separately
        rapierDebugRef.current = new RapierDebugRenderer(scene, core.world, { enabled: physicsWireframe });
      } catch {}

      // Listen for a one-time test projectile spawn request
      const onSpawn = () => {
        const target = new THREE.Vector3(0, 1.5, 0);
        const start = new THREE.Vector3(0, 4.5, 6);
        const dir = target.clone().sub(start).normalize();
        const vel = dir.multiplyScalar(projectileSpeed);
        if (isDev) console.debug('[Page] onSpawn', { start, target, vel, iteration });
        core.enqueueProjectile({ start: { x: start.x, y: start.y, z: start.z }, linvel: { x: vel.x, y: vel.y, z: vel.z }, x: target.x, z: target.z, type: 'ball', radius: 0.5, mass: projectileMass, friction: 0.6, restitution: 0.2 });
      };
      window.addEventListener('spawnTestProjectile', onSpawn, { once: true });
    })();
    return () => {
      mounted = false;
      // Remove meshes and helper from the scene group to avoid leftovers
      try {
        if (rapierDebugRef.current) {
          rapierDebugRef.current.dispose({});
          rapierDebugRef.current = null;
        }
        if (groupRef.current) {
          const children = [...groupRef.current.children];
          for (const child of children) {
            groupRef.current.remove(child);
            // Best-effort dispose geometry/materials
            (child as unknown as { traverse?: (cb: (node: THREE.Object3D) => void) => void }).traverse?.((n: THREE.Object3D) => {
              const mesh = n as THREE.Mesh;
              const geom = mesh.geometry as unknown;
              if (geom && typeof (geom as { dispose: () => void }).dispose === 'function') {
                try { (geom as { dispose: () => void }).dispose(); } catch {}
              }
              const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
              if (Array.isArray(mat)) { for (const m of mat) { try { m.dispose(); } catch {} } }
              else if (mat) { try { mat.dispose(); } catch {} }
            });
          }
        }
        chunkMeshesRef.current = null;
      } catch {}
      if (coreRef.current) coreRef.current.dispose();
      coreRef.current = null;
    };
  }, [iteration, gravity, wallSpan, wallHeight, wallThickness, wallSpanSeg, wallHeightSeg, wallLayers, projectileSpeed, projectileMass, bondsXEnabled, bondsYEnabled, bondsZEnabled, physicsWireframe, scene]);

  // Toggle Rapier wireframe on/off when checkbox changes
  useEffect(() => {
    const dbg = rapierDebugRef.current;
    if (!dbg) return;
    try { dbg.setEnabled(physicsWireframe); } catch {}
  }, [physicsWireframe]);

  // Apply material scale to solver anytime it changes
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try {
      const defaults = core.runtime.defaultExtSettings();
      const scaled: Record<string, number> = { ...defaults } as unknown as Record<string, number>;
      // Apply baseline overrides (concrete-ish) and scale by materialScale
      const baseCompressionElastic = 0.009;
      const baseCompressionFatal = 0.027;
      const baseTensionElastic = 0.0009;
      const baseTensionFatal = 0.0027;
      const baseShearElastic = 0.0012;
      const baseShearFatal = 0.0036;

      scaled.compressionElasticLimit = baseCompressionElastic * materialScale;
      scaled.compressionFatalLimit = baseCompressionFatal * materialScale;
      scaled.tensionElasticLimit = baseTensionElastic * materialScale;
      scaled.tensionFatalLimit = baseTensionFatal * materialScale;
      scaled.shearElasticLimit = baseShearElastic * materialScale;
      scaled.shearFatalLimit = baseShearFatal * materialScale;

      // Ensure iteration and reduction defaults align with desired config
      scaled.maxSolverIterationsPerFrame = 64;
      scaled.graphReductionLevel = 0;
      core.solver.setSettings(scaled);
      if (isDev) console.debug('[Page] Applied material scale', materialScale, scaled);
    } catch (e) {
      if (isDev) console.error('[Page] setSettings failed', e);
    }
  }, [materialScale]);

  useEffect(() => {
    const core = coreRef.current;
    if (core) core.setGravity(gravity);
  }, [gravity]);

  // Click to spawn projectile (shoot from offset toward hit point)
  useEffect(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const handle = (ev: MouseEvent) => {
      const core = coreRef.current; if (!core) return;
      const rect = (ev.target as HTMLElement).getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      const cam = camera;
      if (!cam) {
        console.error('[Page] Missing camera in click handler');
        if (isDev) throw new Error('Missing camera');
        return;
      }
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, cam);
      if (!groupRef.current) {
        console.error('[Page] groupRef is null');
        if (isDev) throw new Error('Missing scene group');
        return;
      }
      const intersects: THREE.Intersection[] = raycaster.intersectObjects([groupRef.current], true);
      const target = new THREE.Vector3();
      if (intersects.length > 0) {
        target.copy(intersects[0].point);
      } else {
        const p = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
        if (!hit) {
          console.error('[Page] No raycast hit with ground plane');
          if (isDev) throw new Error('No ray hit');
          return;
        }
        target.copy(p);
      }
      placeClickMarker(target);

      // Spawn above and behind camera toward target
      const camPos = new THREE.Vector3();
      cam.getWorldPosition(camPos);
      const dir = new THREE.Vector3().subVectors(target, camPos).normalize();
      const start = camPos.clone().addScaledVector(dir, 6).add(new THREE.Vector3(0, 2.5, 0));
      const linvel = new THREE.Vector3().subVectors(target, start).normalize().multiplyScalar(projectileSpeed);
      if (isDev) console.debug('[Page] Click fire', { target, start, linvel, projType });
      core.enqueueProjectile({ start: { x: start.x, y: start.y, z: start.z }, linvel: { x: linvel.x, y: linvel.y, z: linvel.z }, x: target.x, z: target.z, type: projType, radius: 0.5, mass: projectileMass, friction: 0.6, restitution: 0.2 });
    };
    canvas.addEventListener('pointerdown', handle);
    return () => canvas.removeEventListener('pointerdown', handle);
  }, [projType, camera, projectileSpeed, projectileMass, placeClickMarker]);

  useFrame(() => {
    const core = coreRef.current; if (!core) return;
    core.step();
    // Update Rapier wireframe
    if (rapierDebugRef.current) rapierDebugRef.current.update();
    if (chunkMeshesRef.current) updateChunkMeshes(core, chunkMeshesRef.current);
    if (groupRef.current) updateProjectileMeshes(core, groupRef.current);
    if (debug && debugHelperRef.current) {
      const lines = core.getSolverDebugLines();
      // Transform lines from root-local to world for display
      const body = core.world.getRigidBody(core.rootBodyHandle);
      const tr = body.translation(); const rot = body.rotation();
      const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
      const t = new THREE.Vector3(tr.x, tr.y, tr.z);
      const worldLines = lines.map((line) => {
        const p0 = new THREE.Vector3(line.p0.x, line.p0.y, line.p0.z).applyQuaternion(q).add(t);
        const p1 = new THREE.Vector3(line.p1.x, line.p1.y, line.p1.z).applyQuaternion(q).add(t);
        return { p0: { x: p0.x, y: p0.y, z: p0.z }, p1: { x: p1.x, y: p1.y, z: p1.z }, color0: line.color0, color1: line.color1 };
      });
      debugHelperRef.current.update(worldLines, showAllDebugLines);
    } else if (debugHelperRef.current) {
      debugHelperRef.current.update([], false);
    }
  });

  return (
    <>
      <group ref={groupRef} />
      <ambientLight intensity={0.35} />
      <directionalLight castShadow position={[6, 8, 6]} intensity={1.2} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
      <Ground />
      <OrbitControls makeDefault enableDamping dampingFactor={0.15} />
    </>
  );
}

function HtmlOverlay({ debug, setDebug, physicsWireframe, setPhysicsWireframe, gravity, setGravity, projType, setProjType, reset, projectileSpeed, setProjectileSpeed, projectileMass, setProjectileMass, materialScale, setMaterialScale, wallSpan, setWallSpan, wallHeight, setWallHeight, wallThickness, setWallThickness, wallSpanSeg, setWallSpanSeg, wallHeightSeg, setWallHeightSeg, wallLayers, setWallLayers, showAllDebugLines, setShowAllDebugLines, bondsXEnabled, setBondsXEnabled, bondsYEnabled, setBondsYEnabled, bondsZEnabled, setBondsZEnabled }: { debug: boolean; setDebug: (v: boolean) => void; physicsWireframe: boolean; setPhysicsWireframe: (v: boolean) => void; gravity: number; setGravity: (v: number) => void; projType: 'ball' | 'box'; setProjType: (v: 'ball' | 'box') => void; reset: () => void; projectileSpeed: number; setProjectileSpeed: (v: number) => void; projectileMass: number; setProjectileMass: (v: number) => void; materialScale: number; setMaterialScale: (v: number) => void; wallSpan: number; setWallSpan: (v: number) => void; wallHeight: number; setWallHeight: (v: number) => void; wallThickness: number; setWallThickness: (v: number) => void; wallSpanSeg: number; setWallSpanSeg: (v: number) => void; wallHeightSeg: number; setWallHeightSeg: (v: number) => void; wallLayers: number; setWallLayers: (v: number) => void; showAllDebugLines: boolean; setShowAllDebugLines: (v: boolean) => void; bondsXEnabled: boolean; setBondsXEnabled: (v: boolean) => void; bondsYEnabled: boolean; setBondsYEnabled: (v: boolean) => void; bondsZEnabled: boolean; setBondsZEnabled: (v: boolean) => void }) {
  return (
    <div style={{ position: 'absolute', top: 110, left: 16, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={reset} style={{ padding: '8px 14px', background: '#0d0d0d', color: 'white', borderRadius: 6, border: '1px solid #303030' }}>Reset</button>
        <select value={projType} onChange={(e) => setProjType(e.target.value as 'ball' | 'box')} style={{ background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '8px 10px', flex: 1 }}>
          <option value="ball">Ball</option>
          <option value="box">Box</option>
        </select>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} />
        Stress debug lines
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <input type="checkbox" checked={physicsWireframe} onChange={(e) => setPhysicsWireframe(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} />
        Physics wireframe
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <input type="checkbox" checked={showAllDebugLines} onChange={(e) => setShowAllDebugLines(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} />
        Show all solver lines
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Gravity
        <input type="range" min={-30} max={-0.5} step={0.5} value={gravity} onChange={(e) => setGravity(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{gravity.toFixed(2)}</span>
      </label>
      <div style={{ height: 8 }} />
      <div style={{ color: '#9ca3af', fontSize: 13 }}>Projectile</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Speed
        <input type="range" min={1} max={100} step={1} value={projectileSpeed} onChange={(e) => setProjectileSpeed(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{projectileSpeed.toFixed(0)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Mass
        <input type="range" min={1} max={200000} step={1000} value={projectileMass} onChange={(e) => setProjectileMass(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 80, textAlign: 'right' }}>{projectileMass.toLocaleString()}</span>
      </label>
      <div style={{ height: 8 }} />
      <div style={{ color: '#9ca3af', fontSize: 13 }}>Material</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Strength Scale
        {/* <input type="range" min={0.05} max={5} step={0.05} value={materialScale} onChange={(e) => setMaterialScale(parseFloat(e.target.value))} style={{ flex: 1 }} /> */}
        <input type="range" min={0.5} max={5_000_000} step={0.5} value={materialScale} onChange={(e) => setMaterialScale(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{materialScale.toFixed(2)}×</span>
      </label>
      <div style={{ display: 'flex', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={bondsXEnabled} onChange={(e) => setBondsXEnabled(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} /> X
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={bondsYEnabled} onChange={(e) => setBondsYEnabled(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} /> Y
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={bondsZEnabled} onChange={(e) => setBondsZEnabled(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} /> Z
        </label>
      </div>
      <div style={{ height: 8 }} />
      <div style={{ color: '#9ca3af', fontSize: 13 }}>Wall</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Span (m)
        <input type="range" min={2} max={20} step={0.5} value={wallSpan} onChange={(e) => setWallSpan(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallSpan.toFixed(1)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Height (m)
        <input type="range" min={1} max={10} step={0.5} value={wallHeight} onChange={(e) => setWallHeight(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallHeight.toFixed(1)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Thickness (m)
        <input type="range" min={0.1} max={1.0} step={0.02} value={wallThickness} onChange={(e) => setWallThickness(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallThickness.toFixed(2)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Span Segments
        <input type="range" min={3} max={30} step={1} value={wallSpanSeg} onChange={(e) => setWallSpanSeg(parseInt(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallSpanSeg}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Height Segments
        <input type="range" min={1} max={12} step={1} value={wallHeightSeg} onChange={(e) => setWallHeightSeg(parseInt(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallHeightSeg}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Layers
        <input type="range" min={1} max={3} step={1} value={wallLayers} onChange={(e) => setWallLayers(parseInt(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallLayers}</span>
      </label>
      <p style={{ margin: 0, color: '#d1d5db', fontSize: 14 }}>Click ground to drop a projectile. Bottom row is support (infinite mass). Splits occur when bonds overstress.</p>
    </div>
  );
}

export default function Page() {
  const [debug, setDebug] = useState(false);
  const [physicsWireframe, setPhysicsWireframe] = useState(false);
  const [gravity, setGravity] = useState(-9.81);
  const [iteration, setIteration] = useState(0);
  const [projType, setProjType] = useState<'ball' | 'box'>("ball");
  const [projectileSpeed, setProjectileSpeed] = useState(36);
  const [projectileMass, setProjectileMass] = useState(15000);
  const [materialScale, setMaterialScale] = useState(1.0);
  const [wallSpan, setWallSpan] = useState(6.0);
  const [wallHeight, setWallHeight] = useState(3.0);
  const [wallThickness, setWallThickness] = useState(0.32);
  const [wallSpanSeg, setWallSpanSeg] = useState(12);
  const [wallHeightSeg, setWallHeightSeg] = useState(6);
  const [wallLayers, setWallLayers] = useState(1);
  const [showAllDebugLines, setShowAllDebugLines] = useState(true);
  const [bondsXEnabled, setBondsXEnabled] = useState(true);
  const [bondsYEnabled, setBondsYEnabled] = useState(true);
  const [bondsZEnabled, setBondsZEnabled] = useState(true);
  // Auto-spawn on first render disabled; click-to-spawn only.
  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <HtmlOverlay
        debug={debug}
        setDebug={setDebug}
        physicsWireframe={physicsWireframe}
        setPhysicsWireframe={setPhysicsWireframe}
        gravity={gravity}
        setGravity={setGravity}
        projType={projType}
        setProjType={setProjType}
        reset={() => setIteration((v) => v + 1)}
        projectileSpeed={projectileSpeed}
        setProjectileSpeed={setProjectileSpeed}
        projectileMass={projectileMass}
        setProjectileMass={setProjectileMass}
        materialScale={materialScale}
        setMaterialScale={setMaterialScale}
        wallSpan={wallSpan}
        setWallSpan={setWallSpan}
        wallHeight={wallHeight}
        setWallHeight={setWallHeight}
        wallThickness={wallThickness}
        setWallThickness={setWallThickness}
        wallSpanSeg={wallSpanSeg}
        setWallSpanSeg={setWallSpanSeg}
        wallHeightSeg={wallHeightSeg}
        setWallHeightSeg={setWallHeightSeg}
        wallLayers={wallLayers}
        setWallLayers={setWallLayers}
        showAllDebugLines={showAllDebugLines}
        setShowAllDebugLines={setShowAllDebugLines}
        bondsXEnabled={bondsXEnabled}
        setBondsXEnabled={setBondsXEnabled}
        bondsYEnabled={bondsYEnabled}
        setBondsYEnabled={setBondsYEnabled}
        bondsZEnabled={bondsZEnabled}
        setBondsZEnabled={setBondsZEnabled}
      />
      <Canvas shadows camera={{ position: [7, 5, 9], fov: 45 }}>
        <color attach="background" args={["#0e0e12"]} />
        <Scene
          debug={debug}
          physicsWireframe={physicsWireframe}
          gravity={gravity}
          iteration={iteration}
          projType={projType}
          projectileSpeed={projectileSpeed}
          projectileMass={projectileMass}
          materialScale={materialScale}
          wallSpan={wallSpan}
          wallHeight={wallHeight}
          wallThickness={wallThickness}
          wallSpanSeg={wallSpanSeg}
          wallHeightSeg={wallHeightSeg}
          wallLayers={wallLayers}
          showAllDebugLines={showAllDebugLines}
          bondsXEnabled={bondsXEnabled}
          bondsYEnabled={bondsYEnabled}
          bondsZEnabled={bondsZEnabled}
          onReset={() => setIteration((v) => v + 1)}
        />
        <StatsGl className="absolute top-2 left-2" />
      </Canvas>
    </div>
  );
}


