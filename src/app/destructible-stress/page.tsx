"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import { buildDestructibleCore } from "@/lib/stress/core/destructible-core";
import type { DestructibleCore } from "@/lib/stress/core/types";
import { buildWallScenario } from "@/lib/stress/scenarios/wallScenario";
import { buildFracturedWallScenario } from "@/lib/stress/scenarios/fracturedWallScenario";
import { buildBeamBridgeScenario } from "@/lib/stress/scenarios/beamBridgeScenario";
import {
  STRESS_PRESET_METADATA,
  buildBridgeScenario,
  buildCourtyardHouseScenario,
  buildHutScenario,
  buildTownhouseScenario,
  buildTowerScenario,
  buildVaultedLoftScenario,
  type StressPresetId,
} from "@/lib/stress/scenarios/structurePresets";
import { buildChunkMeshes, buildChunkMeshesFromGeometries, buildSolverDebugHelper, updateChunkMeshes, updateProjectileMeshes, computeWorldDebugLines } from "@/lib/stress/three/destructible-adapter";
import RapierDebugRenderer from "@/lib/rapier/rapier-debug-renderer";
import { debugPrintSolver } from "@/lib/stress/core/printSolver";

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
  solverGravityEnabled: boolean;
  limitSinglesCollisions: boolean;
  applyExcessForces: boolean;
  iteration: number;
  structureId: StressPresetId;
  mode: 'projectile' | 'cutter' | 'push';
  pushForce: number;
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

type ScenarioBuilderParams = {
  wallSpan: number;
  wallHeight: number;
  wallThickness: number;
  wallSpanSeg: number;
  wallHeightSeg: number;
  wallLayers: number;
  bondsXEnabled: boolean;
  bondsYEnabled: boolean;
  bondsZEnabled: boolean;
};

const SCENARIO_BUILDERS: Record<StressPresetId, (params: ScenarioBuilderParams) => ReturnType<typeof buildWallScenario>> = {
  wall: ({
    wallSpan,
    wallHeight,
    wallThickness,
    wallSpanSeg,
    wallHeightSeg,
    wallLayers,
    bondsXEnabled,
    bondsYEnabled,
    bondsZEnabled,
  }) =>
    buildWallScenario({
      span: wallSpan,
      height: wallHeight,
      thickness: wallThickness,
      spanSegments: wallSpanSeg,
      heightSegments: wallHeightSeg,
      layers: wallLayers,
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  hut: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildHutScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  bridge: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildBridgeScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  beamBridge: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildBeamBridgeScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  tower: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildTowerScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  townhouse: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildTownhouseScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  courtyardHouse: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildCourtyardHouseScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  vaultedLoft: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildVaultedLoftScenario({ bondsX: bondsXEnabled, bondsY: bondsYEnabled, bondsZ: bondsZEnabled }),
  fracturedWall: ({ wallSpan, wallHeight, wallThickness }) =>
    buildFracturedWallScenario({ span: wallSpan, height: wallHeight, thickness: wallThickness, fragmentCount: 120 }),
};

function Scene({
  debug,
  physicsWireframe,
  gravity,
  solverGravityEnabled,
  limitSinglesCollisions,
  applyExcessForces,
  iteration,
  structureId,
  mode,
  pushForce,
  projType,
  projectileSpeed,
  projectileMass,
  materialScale,
  wallSpan,
  wallHeight, wallThickness, wallSpanSeg, wallHeightSeg, wallLayers, showAllDebugLines, bondsXEnabled, bondsYEnabled, bondsZEnabled, onReset: _onReset,
}: SceneProps) {
  const coreRef = useRef<DestructibleCore | null>(null);
  const debugHelperRef = useRef<ReturnType<typeof buildSolverDebugHelper> | null>(null);
  const chunkMeshesRef = useRef<THREE.Mesh[] | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera as THREE.Camera);
  const scene = useThree((s) => s.scene as THREE.Scene);
  const rapierDebugRef = useRef<RapierDebugRenderer | null>(null);
  const physicsWireframeStateRef = useRef<boolean>(physicsWireframe);
  const buildGravityRef = useRef<number>(gravity);
  useEffect(() => { buildGravityRef.current = gravity; }, [gravity]);
  const solverGravityRef = useRef<boolean>(solverGravityEnabled);
  useEffect(() => { solverGravityRef.current = solverGravityEnabled; }, [solverGravityEnabled]);
  const limitSinglesRef = useRef<boolean>(limitSinglesCollisions);
  useEffect(() => { limitSinglesRef.current = limitSinglesCollisions; }, [limitSinglesCollisions]);
  const applyExcessForcesRef = useRef<boolean>(applyExcessForces);
  useEffect(() => { applyExcessForcesRef.current = applyExcessForces; }, [applyExcessForces]);
  const isDev = true; //process.env.NODE_ENV !== 'production';
  useEffect(() => {
    physicsWireframeStateRef.current = physicsWireframe;
  }, [physicsWireframe]);

  useEffect(() => {
    // Expose debug helpers globally
    (window as unknown as { debugStressSolver?: { printSolver: () => unknown; coreRef: typeof coreRef } }).debugStressSolver = {
      // printHierarchy: () => printWorldHierarchy(),
      // captureSnapshot: () => captureWorldSnapshot(),
      printSolver: () => {
        const core = coreRef?.current;
        if (!core || !core.solver) return null;
        // Build a compact bondTable mapping bond index -> node pair using core API
        const nodeCount = typeof core.solver.graphNodeCount === 'function' ? core.solver.graphNodeCount() : 0;
        const seen = new Set<number>();
        const bondTable: Array<{ index:number; node0:number; node1:number; area?: number }> = [];
        for (let n = 0; n < nodeCount; n++) {
          const bonds = core.getNodeBonds(n) || [];
          for (const b of bonds) {
            if (seen.has(b.index)) continue;
            seen.add(b.index);
            bondTable.push({ index: b.index, node0: b.node0, node1: b.node1, area: b.area });
          }
        }
        return debugPrintSolver(core.solver, { runtime: core.runtime, bondTable, limit: 16 });
      },
      coreRef,
    };
  }, [])

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
      const builder = SCENARIO_BUILDERS[structureId] ?? SCENARIO_BUILDERS.wall;
      const scenario = builder({
        wallSpan,
        wallHeight,
        wallThickness,
        wallSpanSeg,
        wallHeightSeg,
        wallLayers,
        bondsXEnabled,
        bondsYEnabled,
        bondsZEnabled,
      });
      const core = await buildDestructibleCore({
        scenario,
        nodeSize: (index, scen) => {
          const sizes = (scen.parameters as unknown as { fragmentSizes?: Array<{ x:number; y:number; z:number }> } | undefined)?.fragmentSizes;
          const sz = sizes?.[index];
          if (sz) return sz;
          const sp = scen.spacing ?? { x: 0.5, y: 0.5, z: 0.32 };
          return { x: sp.x, y: sp.y, z: sp.z };
        },
        gravity: buildGravityRef.current,
        materialScale: materialScale,
        applyExcessForces: applyExcessForcesRef.current,
      });
      if (!mounted) { core.dispose(); return; }
      coreRef.current = core;

      try { core.setSolverGravityEnabled(solverGravityRef.current); } catch {}
      try { core.setLimitSinglesCollisions(limitSinglesRef.current); } catch {}
      try { core.setApplyExcessForces(applyExcessForcesRef.current); } catch {}

      const params = scenario.parameters as unknown as { fragmentGeometries?: THREE.BufferGeometry[] } | undefined;
      const { objects } = params?.fragmentGeometries?.length
        ? buildChunkMeshesFromGeometries(core, params.fragmentGeometries)
        : buildChunkMeshes(core);
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
        // Initialize with current wireframe state stored in ref; further changes handled by separate effect
        rapierDebugRef.current = new RapierDebugRenderer(scene, core.world, { enabled: physicsWireframeStateRef.current });
      } catch {}
      if (isDev) console.debug('[Page] Initialized destructible core', { iteration, structureId });
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
  }, [iteration, structureId, wallSpan, wallHeight, wallThickness, wallSpanSeg, wallHeightSeg, wallLayers, bondsXEnabled, bondsYEnabled, bondsZEnabled, scene, materialScale]);

  // Listen for a one-time test projectile spawn request; depends on speed/mass only
  useEffect(() => {
    const onSpawn = () => {
      const core = coreRef.current;
      if (!core) return;
      const target = new THREE.Vector3(0, 1.5, 0);
      const start = new THREE.Vector3(0, 4.5, 6);
      const dir = target.clone().sub(start).normalize();
      const vel = dir.multiplyScalar(projectileSpeed);
      if (isDev) console.debug('[Page] onSpawn', { start, target, vel });
      core.enqueueProjectile({ start: { x: start.x, y: start.y, z: start.z }, linvel: { x: vel.x, y: vel.y, z: vel.z }, x: target.x, z: target.z, type: 'ball', radius: 0.5, mass: projectileMass, friction: 0.6, restitution: 0.2 });
    };
    window.addEventListener('spawnTestProjectile', onSpawn, { once: true });
    return () => {
      window.removeEventListener('spawnTestProjectile', onSpawn as EventListener);
    };
  }, [projectileSpeed, projectileMass]);

  // Toggle Rapier wireframe on/off when checkbox changes
  useEffect(() => {
    const dbg = rapierDebugRef.current;
    if (!dbg) return;
    try { dbg.setEnabled(physicsWireframe); } catch {}
  }, [physicsWireframe]);

  // Apply limitSinglesToGround when toggled
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try { core.setLimitSinglesCollisions(limitSinglesCollisions); } catch {}
  }, [limitSinglesCollisions]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try { core.setApplyExcessForces(applyExcessForces); } catch {}
  }, [applyExcessForces]);

  // Apply material scale to solver anytime it changes
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try {
      const defaults = core.runtime.defaultExtSettings();
      const scaled: Record<string, number> = { ...defaults } as unknown as Record<string, number>;
      /*
      // Apply baseline overrides (concrete-ish) and scale by materialScale
      const baseCompressionElastic = 0.009;
      // const baseCompressionFatal = 0.027;
      const baseCompressionFatal = 0.27;
      const baseTensionElastic = 0.0009;
      // const baseTensionFatal = 0.0027;
      const baseTensionFatal = 0.27;
      const baseShearElastic = 0.0012;
      // const baseShearFatal = 0.0036;
      const baseShearFatal = 0.36;
      */

      // tension elastic/fatal:   0.0009 / 0.0027
      // shear   elastic/fatal:   0.0012 / 0.0036
      // compress elastic/fatal:  0.0090 / 0.027
      const baseCompressionElastic = 0.0009;
      const baseCompressionFatal = 0.0027;
      const baseShearElastic = 0.0012;
      const baseShearFatal = 0.0036;
      const baseTensionElastic = 0.0009;
      const baseTensionFatal = 0.0027;

      scaled.compressionElasticLimit = baseCompressionElastic * materialScale;
      scaled.compressionFatalLimit = baseCompressionFatal * materialScale;
      scaled.tensionElasticLimit = baseTensionElastic * materialScale;
      scaled.tensionFatalLimit = baseTensionFatal * materialScale;
      scaled.shearElasticLimit = baseShearElastic * materialScale;
      scaled.shearFatalLimit = baseShearFatal * materialScale;

      // Ensure iteration and reduction defaults align with desired config
      // scaled.maxSolverIterationsPerFrame = 64;
      scaled.maxSolverIterationsPerFrame = 24;
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

  // Toggle whether gravity is applied to the solver without recreating the scene
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try { (core as unknown as { setSolverGravityEnabled?: (v:boolean) => void }).setSolverGravityEnabled?.(solverGravityEnabled); } catch {}
  }, [solverGravityEnabled]);

  // Click: spawn projectile, cut bonds, or push chunk depending on mode
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

      if (mode === 'projectile') {
        // Spawn above and behind camera toward target
        const camPos = new THREE.Vector3();
        cam.getWorldPosition(camPos);
        const dir = new THREE.Vector3().subVectors(target, camPos).normalize();
        const start = camPos.clone().addScaledVector(dir, 6).add(new THREE.Vector3(0, 2.5, 0));
        const linvel = new THREE.Vector3().subVectors(target, start).normalize().multiplyScalar(projectileSpeed);
        if (isDev) console.debug('[Page] Click fire', { target, start, linvel, projType });
        core.enqueueProjectile({ start: { x: start.x, y: start.y, z: start.z }, linvel: { x: linvel.x, y: linvel.y, z: linvel.z }, x: target.x, z: target.z, type: projType, radius: 0.5, mass: projectileMass, friction: 0.6, restitution: 0.2 });
      } else if (mode === 'cutter') {
        // Cutter: choose first intersected mesh with nodeIndex
        let hitNodeIndex: number | null = null;
        for (const intr of intersects) {
          const obj = intr.object as THREE.Object3D & { userData?: Record<string, unknown> };
          const idx = obj?.userData?.nodeIndex as number | undefined;
          if (typeof idx === 'number') { hitNodeIndex = idx; break; }
        }
        if (hitNodeIndex == null) {
          if (isDev) console.warn('[Page] Cutter: no nodeIndex on hit object');
          return;
        }
        const bonds = core.getNodeBonds(hitNodeIndex);
        if (isDev) console.debug('[Page] Cutter: cutting bonds', { node: hitNodeIndex, count: bonds.length });
        for (const b of bonds) core.cutBond(b.index);
      } else if (mode === 'push') {
        // Push: pick intersected chunk and apply external force along ray direction
        let hit: THREE.Intersection | undefined;
        for (const intr of intersects) {
          const obj = intr.object as THREE.Object3D & { userData?: Record<string, unknown> };
          const idx = obj?.userData?.nodeIndex as number | undefined;
          if (typeof idx === 'number') { hit = intr; break; }
        }
        if (!hit) {
          if (isDev) console.warn('[Page] Push: no nodeIndex on hit object');
          return;
        }
        const nodeIndex = (hit.object as THREE.Object3D & { userData?: Record<string, unknown> }).userData.nodeIndex as number;
        const dirWorld = raycaster.ray.direction.clone().normalize();
        const force = dirWorld.multiplyScalar(pushForce);
        // Apply to Rapier as a one-shot impulse at the hit point
        const seg = core.chunks[nodeIndex];
        const handle = seg?.bodyHandle;
        if (handle != null) {
          const body = core.world.getRigidBody(handle);
          if (body) {
            const dt = core.world.timestep ?? core.world.integrationParameters?.dt ?? (1 / 60);
            const impulse = new THREE.Vector3(force.x * dt, force.y * dt, force.z * dt);
            body.applyImpulseAtPoint({ x: impulse.x, y: impulse.y, z: impulse.z }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
          }
        }
        // Mirror to solver only (solver consumes and clears per-frame)
        core.applyExternalForce(nodeIndex, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, { x: force.x, y: force.y, z: force.z });
        if (isDev) console.debug('[Page] Push: applied', { nodeIndex, point: hit.point, force });
      }
    };
    canvas.addEventListener('pointerdown', handle);
    return () => canvas.removeEventListener('pointerdown', handle);
  }, [mode, pushForce, projType, camera, projectileSpeed, projectileMass, placeClickMarker]);

  const hasCrashed = useRef(false);
  useFrame(() => {
    if (hasCrashed.current) return;

    const core = coreRef.current; if (!core) return;
    try {
      core.step();
      // Update scene meshes first, then debug renderers to avoid Rapier aliasing issues
      if (chunkMeshesRef.current) updateChunkMeshes(core, chunkMeshesRef.current);
      if (groupRef.current) updateProjectileMeshes(core, groupRef.current);
    } catch (e) {
      console.error(e);
      hasCrashed.current = true;
    }

    // Update Rapier wireframe last
    if (rapierDebugRef.current) rapierDebugRef.current.update();
    if (debug && debugHelperRef.current) {
      const lines = core.getSolverDebugLines();
      const worldLines = computeWorldDebugLines(core, lines);
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

function HtmlOverlay({ debug, setDebug, physicsWireframe, setPhysicsWireframe, gravity, setGravity, solverGravityEnabled, setSolverGravityEnabled, limitSinglesCollisions, setLimitSinglesCollisions, applyExcessForces, setApplyExcessForces, mode, setMode, projType, setProjType, reset, projectileSpeed, setProjectileSpeed, projectileMass, setProjectileMass, materialScale, setMaterialScale, wallSpan, setWallSpan, wallHeight, setWallHeight, wallThickness, setWallThickness, wallSpanSeg, setWallSpanSeg, wallHeightSeg, setWallHeightSeg, wallLayers, setWallLayers, showAllDebugLines, setShowAllDebugLines, bondsXEnabled, setBondsXEnabled, bondsYEnabled, setBondsYEnabled, bondsZEnabled, setBondsZEnabled, structureId, setStructureId, structures, structureDescription, pushForce, setPushForce, }: { debug: boolean; setDebug: (v: boolean) => void; physicsWireframe: boolean; setPhysicsWireframe: (v: boolean) => void; gravity: number; setGravity: (v: number) => void; solverGravityEnabled: boolean; setSolverGravityEnabled: (v: boolean) => void; limitSinglesCollisions: boolean; setLimitSinglesCollisions: (v: boolean) => void; applyExcessForces: boolean; setApplyExcessForces: (v: boolean) => void; mode: 'projectile' | 'cutter' | 'push'; setMode: (v: 'projectile' | 'cutter' | 'push') => void; projType: 'ball' | 'box'; setProjType: (v: 'ball' | 'box') => void; reset: () => void; projectileSpeed: number; setProjectileSpeed: (v: number) => void; projectileMass: number; setProjectileMass: (v: number) => void; materialScale: number; setMaterialScale: (v: number) => void; wallSpan: number; setWallSpan: (v: number) => void; wallHeight: number; setWallHeight: (v: number) => void; wallThickness: number; setWallThickness: (v: number) => void; wallSpanSeg: number; setWallSpanSeg: (v: number) => void; wallHeightSeg: number; setWallHeightSeg: (v: number) => void; wallLayers: number; setWallLayers: (v: number) => void; showAllDebugLines: boolean; setShowAllDebugLines: (v: boolean) => void; bondsXEnabled: boolean; setBondsXEnabled: (v: boolean) => void; bondsYEnabled: boolean; setBondsYEnabled: (v: boolean) => void; bondsZEnabled: boolean; setBondsZEnabled: (v: boolean) => void; structureId: StressPresetId; setStructureId: (v: StressPresetId) => void; structures: typeof STRESS_PRESET_METADATA; structureDescription?: string; pushForce: number; setPushForce: (v: number) => void }) {
  const isWallStructure = structureId === "wall" || structureId === "fracturedWall";
  return (
    <div style={{ position: 'absolute', top: 110, left: 16, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={reset} style={{ padding: '8px 14px', background: '#0d0d0d', color: 'white', borderRadius: 6, border: '1px solid #303030' }}>Reset</button>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'projectile' | 'cutter' | 'push')} style={{ background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '8px 10px', flex: 1 }}>
          <option value="projectile">Projectile</option>
          <option value="cutter">Cutter</option>
          <option value="push">Push</option>
        </select>
      </div>
      <select value={structureId} onChange={(e) => setStructureId(e.target.value as StressPresetId)} style={{ background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '8px 10px' }}>
        {structures.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {structureDescription ? (
        <p style={{ margin: 0, color: '#9ca3af', fontSize: 13, lineHeight: 1.4 }}>{structureDescription}</p>
      ) : null}
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
        <input type="range" min={-30} max={0.0} step={0.5} value={gravity} onChange={(e) => setGravity(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{gravity.toFixed(2)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <input type="checkbox" checked={solverGravityEnabled} onChange={(e) => setSolverGravityEnabled(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} />
        Apply gravity to solver
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <input type="checkbox" checked={limitSinglesCollisions} onChange={(e) => setLimitSinglesCollisions(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} />
        Limit singles collisions (no SINGLE↔SINGLE)
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        <input type="checkbox" checked={applyExcessForces} onChange={(e) => setApplyExcessForces(e.target.checked)} style={{ accentColor: '#4da2ff', width: 16, height: 16 }} />
        Apply excess fracture forces
      </label>
      <div style={{ height: 8 }} />
      <div style={{ color: '#9ca3af', fontSize: 13 }}>Push</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Force (N)
        <input type="range" min={100} max={100_000_000} step={100} value={pushForce} onChange={(e) => setPushForce(parseFloat(e.target.value))} style={{ flex: 1 }} />
        <span style={{ color: '#9ca3af', width: 80, textAlign: 'right' }}>{Math.round(pushForce).toLocaleString()}</span>
      </label>
      <div style={{ color: '#9ca3af', fontSize: 13 }}>Projectile</div>
      <select value={projType} onChange={(e) => setProjType(e.target.value as 'ball' | 'box')} style={{ background: '#111', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '8px 10px' }}>
        <option value="ball">Ball</option>
        <option value="box">Box</option>
      </select>
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
        {/* <input type="range" min={0.5} max={5_000_000} step={0.5} value={materialScale} onChange={(e) => setMaterialScale(parseFloat(e.target.value))} style={{ flex: 1 }} /> */}
        <input type="range" min={1} max={5_000_000} step={10} value={materialScale} onChange={(e) => setMaterialScale(parseFloat(e.target.value))} style={{ flex: 1 }} />
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
      <div style={{ color: '#9ca3af', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>Wall</span>
        {!isWallStructure ? (
          <span style={{ color: '#6b7280', fontSize: 12 }}>
            Dimension sliders only apply to the tunable wall preset.
          </span>
        ) : null}
      </div>
      <div style={{ opacity: isWallStructure ? 1 : 0.5, pointerEvents: isWallStructure ? 'auto' : 'none' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Span (m)
        <input type="range" min={2} max={20} step={0.5} value={wallSpan} onChange={(e) => setWallSpan(parseFloat(e.target.value))} style={{ flex: 1 }} disabled={!isWallStructure} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallSpan.toFixed(1)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Height (m)
        <input type="range" min={1} max={10} step={0.5} value={wallHeight} onChange={(e) => setWallHeight(parseFloat(e.target.value))} style={{ flex: 1 }} disabled={!isWallStructure} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallHeight.toFixed(1)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Thickness (m)
        <input type="range" min={0.1} max={1.0} step={0.02} value={wallThickness} onChange={(e) => setWallThickness(parseFloat(e.target.value))} style={{ flex: 1 }} disabled={!isWallStructure} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallThickness.toFixed(2)}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Span Segments
        <input type="range" min={3} max={30} step={1} value={wallSpanSeg} onChange={(e) => setWallSpanSeg(parseInt(e.target.value))} style={{ flex: 1 }} disabled={!isWallStructure} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallSpanSeg}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Height Segments
        <input type="range" min={1} max={12} step={1} value={wallHeightSeg} onChange={(e) => setWallHeightSeg(parseInt(e.target.value))} style={{ flex: 1 }} disabled={!isWallStructure} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallHeightSeg}</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d1d5db', fontSize: 14 }}>
        Layers
        <input type="range" min={1} max={3} step={1} value={wallLayers} onChange={(e) => setWallLayers(parseInt(e.target.value))} style={{ flex: 1 }} disabled={!isWallStructure} />
        <span style={{ color: '#9ca3af', width: 60, textAlign: 'right' }}>{wallLayers}</span>
      </label>
      </div>
      <p style={{ margin: 0, color: '#d1d5db', fontSize: 14 }}>Click ground to drop a projectile. Bottom row is support (infinite mass). Splits occur when bonds overstress.</p>
    </div>
  );
}

export default function Page() {
  const [debug, setDebug] = useState(false);
  const [physicsWireframe, setPhysicsWireframe] = useState(false);
  const [gravity, setGravity] = useState(-9.81);
  const [solverGravityEnabled, setSolverGravityEnabled] = useState(true);
  const [limitSinglesCollisions, setLimitSinglesCollisions] = useState(false);
  const [applyExcessForces, setApplyExcessForces] = useState(true);
  const [iteration, setIteration] = useState(0);
  const [mode, setMode] = useState<'projectile' | 'cutter' | 'push'>('projectile');
  const [structureId, setStructureId] = useState<StressPresetId>('hut');
  const [projType, setProjType] = useState<'ball' | 'box'>("ball");
  const [projectileSpeed, setProjectileSpeed] = useState(36);
  const [projectileMass, setProjectileMass] = useState(15000);
  const [materialScale, setMaterialScale] = useState(1_000_000.0);
  const [pushForce, setPushForce] = useState(8000);
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
  const structures = STRESS_PRESET_METADATA;
  const currentStructure = structures.find((item) => item.id === structureId) ?? structures[0];
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
        solverGravityEnabled={solverGravityEnabled}
        setSolverGravityEnabled={setSolverGravityEnabled}
        limitSinglesCollisions={limitSinglesCollisions}
        setLimitSinglesCollisions={setLimitSinglesCollisions}
        applyExcessForces={applyExcessForces}
        setApplyExcessForces={setApplyExcessForces}
        mode={mode}
        setMode={setMode}
        pushForce={pushForce}
        setPushForce={setPushForce}
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
        structureId={structureId}
        setStructureId={setStructureId}
        structures={structures}
        structureDescription={currentStructure?.description}
      />
      <Canvas shadows camera={{ position: [7, 5, 9], fov: 45 }}>
        <color attach="background" args={["#0e0e12"]} />
        <Scene
          debug={debug}
          physicsWireframe={physicsWireframe}
          gravity={gravity}
          solverGravityEnabled={solverGravityEnabled}
          limitSinglesCollisions={limitSinglesCollisions}
          applyExcessForces={applyExcessForces}
          iteration={iteration}
          structureId={structureId}
          mode={mode}
          pushForce={pushForce}
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


