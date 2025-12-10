"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Perf as R3FPerf } from "r3f-perf";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import RapierDebugRenderer from "@/lib/rapier/rapier-debug-renderer";
import { applyAutoBondingToScenario } from "@/lib/stress/core/autoBonding";
import { buildDestructibleCore } from "@/lib/stress/core/destructible-core";
import { debugPrintSolver } from "@/lib/stress/core/printSolver";
import type {
  CoreProfilerSample,
  DestructibleCore,
  SingleCollisionMode,
  OptimizationMode,
} from "@/lib/stress/core/types";
import { buildBeamBridgeScenario } from "@/lib/stress/scenarios/beamBridgeScenario";
import { buildBrickWallScenario } from "@/lib/stress/scenarios/brickWallScenario";
import { buildFracturedGlbScenario } from "@/lib/stress/scenarios/fracturedGlbScenario";
import { buildFracturedWallScenario } from "@/lib/stress/scenarios/fracturedWallScenario";
import {
  buildBridgeScenario,
  buildCourtyardHouseScenario,
  buildHutScenario,
  buildTowerScenario,
  buildTownhouseScenario,
  buildVaultedLoftScenario,
  STRESS_PRESET_METADATA,
  type StressPresetId,
} from "@/lib/stress/scenarios/structurePresets";
import { buildWallScenario } from "@/lib/stress/scenarios/wallScenario";
import {
  buildChunkMeshes,
  buildChunkMeshesFromGeometries,
  buildBatchedChunkMesh,
  buildBatchedChunkMeshFromGeometries,
  SolverDebugLinesHelper,
  updateChunkMeshes,
  updateBatchedChunkMesh,
  updateProjectileMeshes,
  type BatchedChunkMeshResult,
} from "@/lib/stress/three/destructible-adapter";
import {
  ControlPanel,
  EMPTY_PROFILER_STATS,
  type ProfilerStatsState,
} from "./ControlPanel";

const shadowsEnabled = true;

type StressDebugWindow = Window & {
  __stressFrameStats?: {
    frames: number;
    lastUseFrameMs: number;
    maxUseFrameMs: number;
    avgUseFrameMs: number;
    updatedAt: number;
  };
  __stressOverlayStats?: {
    renders: number;
    lastDuration: number;
    maxDuration: number;
    updatedAt: number;
  };
};

const perfNow = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

function Ground() {
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow={shadowsEnabled}
      >
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
  singleCollisionMode: SingleCollisionMode;
  skipSingleBodies: boolean;
  damageEnabled: boolean;
  damageClickRatio: number;
  contactDamageScale: number;
  minImpulseThreshold: number;
  contactCooldownMs: number;
  internalContactScale: number;
  speedMinExternal: number;
  speedMinInternal: number;
  speedMax: number;
  speedExponent: number;
  slowSpeedFactor: number;
  fastSpeedFactor: number;
  iteration: number;
  structureId: StressPresetId;
  mode: "projectile" | "cutter" | "push" | "damage";
  pushForce: number;
  projType: "ball" | "box";
  projectileSpeed: number;
  projectileMass: number;
  projectileRadius: number;
  materialScale: number;
  resimulateOnFracture: boolean;
  maxResimulationPasses: number;
  snapshotMode: "perBody" | "world";
  resimulateOnDamageDestroy: boolean;
  wallSpan: number;
  wallHeight: number;
  wallThickness: number;
  wallSpanSeg: number;
  wallHeightSeg: number;
  wallLayers: number;
  bondsXEnabled: boolean;
  bondsYEnabled: boolean;
  bondsZEnabled: boolean;
  autoBondingEnabled: boolean;
  adaptiveDt: boolean;
  sleepLinearThreshold: number;
  sleepAngularThreshold: number;
  sleepMode: OptimizationMode;
  smallBodyColliderThreshold: number;
  smallBodyMinLinearDamping: number;
  smallBodyMinAngularDamping: number;
  smallBodyDampingMode: OptimizationMode;
  onReset: () => void;
  bodyCountRef?: MutableRefObject<HTMLSpanElement | null>;
  activeBodyCountRef?: MutableRefObject<HTMLSpanElement | null>;
  colliderCountRef?: MutableRefObject<HTMLSpanElement | null>;
  bondsCountRef?: MutableRefObject<HTMLSpanElement | null>;
  profiling?: {
    enabled: boolean;
    onSample?: (sample: CoreProfilerSample) => void;
  };
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

type ScenarioBuilder = (
  params: ScenarioBuilderParams,
) =>
  | ReturnType<typeof buildWallScenario>
  | Promise<ReturnType<typeof buildWallScenario>>;
const SCENARIO_BUILDERS: Record<StressPresetId, ScenarioBuilder> = {
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
  brickWall: ({
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
    buildBrickWallScenario({
      span: wallSpan,
      height: wallHeight,
      thickness: wallThickness,
      spanBricks: wallSpanSeg,
      courses: wallHeightSeg,
      layers: wallLayers,
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
      includeHalfBricks: true,
      clumpCount: 7,
    }),
  hut: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildHutScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  bridge: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildBridgeScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  beamBridge: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildBeamBridgeScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  tower: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildTowerScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  townhouse: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildTownhouseScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  courtyardHouse: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildCourtyardHouseScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  vaultedLoft: ({ bondsXEnabled, bondsYEnabled, bondsZEnabled }) =>
    buildVaultedLoftScenario({
      bondsX: bondsXEnabled,
      bondsY: bondsYEnabled,
      bondsZ: bondsZEnabled,
    }),
  fracturedWall: ({ wallSpan, wallHeight, wallThickness }) =>
    buildFracturedWallScenario({
      span: wallSpan,
      height: wallHeight,
      thickness: wallThickness,
      fragmentCount: 200,
    }),
  fracturedGlb: async () =>
    buildFracturedGlbScenario({
      // fragmentCount: 120, objectMass: 10_000,
    }),
};

function Scene({
  debug,
  physicsWireframe,
  gravity,
  solverGravityEnabled,
  singleCollisionMode,
  skipSingleBodies,
  damageEnabled,
  damageClickRatio,
  contactDamageScale,
  minImpulseThreshold,
  contactCooldownMs,
  internalContactScale,
  speedMinExternal,
  speedMinInternal,
  speedMax,
  speedExponent,
  slowSpeedFactor,
  fastSpeedFactor,
  iteration,
  structureId,
  mode,
  pushForce,
  projType,
  projectileSpeed,
  projectileMass,
  projectileRadius,
  materialScale,
  resimulateOnFracture,
  maxResimulationPasses,
  snapshotMode,
  resimulateOnDamageDestroy,
  wallSpan,
  wallHeight,
  wallThickness,
  wallSpanSeg,
  wallHeightSeg,
  wallLayers,
  bondsXEnabled,
  bondsYEnabled,
  bondsZEnabled,
  autoBondingEnabled,
  adaptiveDt,
  sleepLinearThreshold,
  sleepAngularThreshold,
  sleepMode,
  smallBodyColliderThreshold,
  smallBodyMinLinearDamping,
  smallBodyMinAngularDamping,
  smallBodyDampingMode,
  onReset: _onReset,
  bodyCountRef,
  activeBodyCountRef,
  colliderCountRef,
  bondsCountRef,
  profiling,
}: SceneProps) {
  console.log("Scene render");

  const coreRef = useRef<DestructibleCore | null>(null);
  const debugHelperRef = useRef<SolverDebugLinesHelper | null>(null);
  const debugLinesActiveRef = useRef(false);
  const frameStatsRef = useRef({ samples: 0, total: 0, max: 0 });
  const frameLogRef = useRef(0);
  const chunkMeshesRef = useRef<THREE.Mesh[] | null>(null);
  // BatchedMesh for optimized rendering (replaces chunkMeshesRef when useBatchedMesh=true)
  const batchedMeshResultRef = useRef<BatchedChunkMeshResult | null>(null);
  const useBatchedMesh = true; // Toggle to use BatchedMesh optimization
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera as THREE.Camera);
  const scene = useThree((s) => s.scene as THREE.Scene);
  const rapierDebugRef = useRef<RapierDebugRenderer | null>(null);
  const physicsWireframeStateRef = useRef<boolean>(physicsWireframe);
  const buildGravityRef = useRef<number>(gravity);
  useEffect(() => {
    buildGravityRef.current = gravity;
  }, [gravity]);
  const profilingRef = useRef(profiling);
  useEffect(() => {
    profilingRef.current = profiling;
  }, [profiling]);
  const solverGravityRef = useRef<boolean>(solverGravityEnabled);
  useEffect(() => {
    solverGravityRef.current = solverGravityEnabled;
  }, [solverGravityEnabled]);
  const singleCollisionModeRef =
    useRef<SingleCollisionMode>(singleCollisionMode);
  useEffect(() => {
    singleCollisionModeRef.current = singleCollisionMode;
  }, [singleCollisionMode]);
  const sleepLinearThresholdRef = useRef(sleepLinearThreshold);
  useEffect(() => {
    sleepLinearThresholdRef.current = sleepLinearThreshold;
  }, [sleepLinearThreshold]);
  const sleepAngularThresholdRef = useRef(sleepAngularThreshold);
  useEffect(() => {
    sleepAngularThresholdRef.current = sleepAngularThreshold;
  }, [sleepAngularThreshold]);
  const smallBodyColliderThresholdRef = useRef(smallBodyColliderThreshold);
  useEffect(() => {
    smallBodyColliderThresholdRef.current = smallBodyColliderThreshold;
  }, [smallBodyColliderThreshold]);
  const smallBodyMinLinearDampingRef = useRef(smallBodyMinLinearDamping);
  useEffect(() => {
    smallBodyMinLinearDampingRef.current = smallBodyMinLinearDamping;
  }, [smallBodyMinLinearDamping]);
  const smallBodyMinAngularDampingRef = useRef(smallBodyMinAngularDamping);
  useEffect(() => {
    smallBodyMinAngularDampingRef.current = smallBodyMinAngularDamping;
  }, [smallBodyMinAngularDamping]);
  const sleepModeRef = useRef(sleepMode);
  useEffect(() => {
    sleepModeRef.current = sleepMode;
  }, [sleepMode]);
  const smallBodyDampingModeRef = useRef(smallBodyDampingMode);
  useEffect(() => {
    smallBodyDampingModeRef.current = smallBodyDampingMode;
  }, [smallBodyDampingMode]);
  const isDev = true; //process.env.NODE_ENV !== 'production';
  useEffect(() => {
    physicsWireframeStateRef.current = physicsWireframe;
  }, [physicsWireframe]);

  useEffect(() => {
    // Expose debug helpers globally
    (
      window as unknown as {
        debugStressSolver?: {
          printSolver: () => unknown;
          coreRef: typeof coreRef;
        };
      }
    ).debugStressSolver = {
      // printHierarchy: () => printWorldHierarchy(),
      // captureSnapshot: () => captureWorldSnapshot(),
      printSolver: () => {
        const core = coreRef?.current;
        if (!core || !core.solver) return null;
        // Build a compact bondTable mapping bond index -> node pair using core API
        const nodeCount =
          typeof core.solver.graphNodeCount === "function"
            ? core.solver.graphNodeCount()
            : 0;
        const seen = new Set<number>();
        const bondTable: Array<{
          index: number;
          node0: number;
          node1: number;
          area?: number;
        }> = [];
        for (let n = 0; n < nodeCount; n++) {
          const bonds = core.getNodeBonds(n) || [];
          for (const b of bonds) {
            if (seen.has(b.index)) continue;
            seen.add(b.index);
            bondTable.push({
              index: b.index,
              node0: b.node0,
              node1: b.node1,
              area: b.area,
            });
          }
        }
        return debugPrintSolver(core.solver, {
          runtime: core.runtime,
          bondTable,
          limit: 16,
        });
      },
      coreRef,
    };
  }, []);

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
      let scenario = await builder({
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
      // Apply auto bonding if enabled (centralized)
      if (autoBondingEnabled) {
        scenario = await applyAutoBondingToScenario(scenario);
      }
      const core = await buildDestructibleCore({
        scenario,
        nodeSize: (index, scen) => {
          const sizes = (
            scen.parameters as unknown as
              | { fragmentSizes?: Array<{ x: number; y: number; z: number }> }
              | undefined
          )?.fragmentSizes;
          const sz = sizes?.[index];
          if (sz) return sz;
          const sp = scen.spacing ?? { x: 0.5, y: 0.5, z: 0.32 };
          return { x: sp.x, y: sp.y, z: sp.z };
        },
        gravity: buildGravityRef.current,
        materialScale: materialScale,
        skipSingleBodies,
        damage: {
          enabled: damageEnabled,
          autoDetachOnDestroy: true,
          autoCleanupPhysics: true,
          contactDamageScale: contactDamageScale,
          minImpulseThreshold: minImpulseThreshold,
          contactCooldownMs: contactCooldownMs,
          internalContactScale: internalContactScale,
          speedMinExternal,
          speedMinInternal,
          speedMax,
          speedExponent,
          slowSpeedFactor,
          fastSpeedFactor,
        },
        onNodeDestroyed: ({ nodeIndex, actorIndex }) => {
          console.log("[Damage] node destroyed", { nodeIndex, actorIndex });
        },
        // Rebuild Rapier debug renderer when the World instance is replaced by snapshot restore
        onWorldReplaced: (newWorld) => {
          try {
            if (rapierDebugRef.current) {
              rapierDebugRef.current.dispose({});
              rapierDebugRef.current = null;
            }
            if (physicsWireframeStateRef.current) {
              rapierDebugRef.current = new RapierDebugRenderer(
                scene,
                newWorld,
                {
                  enabled: true,
                },
              );
            }
          } catch {}
        },
        resimulateOnFracture,
        maxResimulationPasses,
        snapshotMode,
        resimulateOnDamageDestroy,
        singleCollisionMode: singleCollisionModeRef.current,
        sleepLinearThreshold: sleepLinearThresholdRef.current,
        sleepAngularThreshold: sleepAngularThresholdRef.current,
        sleepMode: sleepModeRef.current,
        smallBodyDamping: {
          mode: smallBodyDampingModeRef.current,
          colliderCountThreshold: smallBodyColliderThresholdRef.current,
          minLinearDamping: smallBodyMinLinearDampingRef.current,
          minAngularDamping: smallBodyMinAngularDampingRef.current,
        },
      });
      if (!mounted) {
        core.dispose();
        return;
      }
      coreRef.current = core;
      try {
        core.setSleepThresholds?.(
          sleepLinearThresholdRef.current,
          sleepAngularThresholdRef.current,
        );
      } catch {}
      const latestProfiling = profilingRef.current;
      if (
        latestProfiling?.enabled &&
        typeof latestProfiling.onSample === "function" &&
        typeof core.setProfiler === "function"
      ) {
        core.setProfiler({
          enabled: true,
          onSample: latestProfiling.onSample,
        });
      }

      try {
        core.setSolverGravityEnabled(solverGravityRef.current);
      } catch {}
      try {
        core.setSingleCollisionMode(singleCollisionModeRef.current);
      } catch {}

      const params = scenario.parameters as unknown as
        | { fragmentGeometries?: THREE.BufferGeometry[] }
        | undefined;

      // Use BatchedMesh for optimized rendering (single draw call)
      if (useBatchedMesh) {
        const batchedResult = params?.fragmentGeometries?.length
          ? buildBatchedChunkMeshFromGeometries(
              core,
              params.fragmentGeometries,
              {
                enablePerInstanceUniforms: true,
                enableBVH: false, // Disable BVH - it causes aggressive culling when camera is close
                bvhMargin: 5.0,
              },
            )
          : buildBatchedChunkMesh(core, {
              enablePerInstanceUniforms: true,
              enableBVH: false, // Disable BVH - it causes aggressive culling when camera is close
              bvhMargin: 5.0,
            });
        batchedMeshResultRef.current = batchedResult;
        groupRef.current?.add(batchedResult.batchedMesh);
        chunkMeshesRef.current = null; // Not using individual meshes
      } else {
        // Fallback to individual meshes (legacy path)
        const { objects } = params?.fragmentGeometries?.length
          ? buildChunkMeshesFromGeometries(core, params.fragmentGeometries)
          : buildChunkMeshes(core);
        chunkMeshesRef.current = objects;
        for (const o of objects) groupRef.current?.add(o);
        batchedMeshResultRef.current = null;
      }

      const helper = new SolverDebugLinesHelper();
      debugHelperRef.current = helper;
      groupRef.current?.add(helper.object);

      // Setup Rapier wireframe renderer (dispose previous if any)
      try {
        if (rapierDebugRef.current) {
          rapierDebugRef.current.dispose({});
          rapierDebugRef.current = null;
        }
        if (physicsWireframeStateRef.current) {
          rapierDebugRef.current = new RapierDebugRenderer(scene, core.world, {
            enabled: true,
          });
        }
      } catch {}
      if (isDev)
        console.debug("[Page] Initialized destructible core", {
          iteration,
          structureId,
        });
    })();
    return () => {
      mounted = false;
      // Remove meshes and helper from the scene group to avoid leftovers
      try {
        if (rapierDebugRef.current) {
          rapierDebugRef.current.dispose({});
          rapierDebugRef.current = null;
        }
        // Dispose BatchedMesh if using it
        if (batchedMeshResultRef.current) {
          try {
            if (groupRef.current && batchedMeshResultRef.current.batchedMesh) {
              groupRef.current.remove(batchedMeshResultRef.current.batchedMesh);
            }
            batchedMeshResultRef.current.dispose();
          } catch {}
          batchedMeshResultRef.current = null;
        }
        if (groupRef.current) {
          const children = [...groupRef.current.children];
          for (const child of children) {
            groupRef.current.remove(child);
            // Best-effort dispose geometry/materials
            (
              child as unknown as {
                traverse?: (cb: (node: THREE.Object3D) => void) => void;
              }
            ).traverse?.((n: THREE.Object3D) => {
              const mesh = n as THREE.Mesh;
              const geom = mesh.geometry as unknown;
              if (
                geom &&
                typeof (geom as { dispose: () => void }).dispose === "function"
              ) {
                try {
                  (geom as { dispose: () => void }).dispose();
                } catch {}
              }
              const mat = mesh.material as
                | THREE.Material
                | THREE.Material[]
                | undefined;
              if (Array.isArray(mat)) {
                for (const m of mat) {
                  try {
                    m.dispose();
                  } catch {}
                }
              } else if (mat) {
                try {
                  mat.dispose();
                } catch {}
              }
            });
          }
        }
        chunkMeshesRef.current = null;
      } catch {}
      if (coreRef.current) coreRef.current.dispose();
      coreRef.current = null;
      // Clear debug lines caches when core is disposed
      if (debugHelperRef.current) {
        debugHelperRef.current.invalidate();
      }
    };
  }, [
    iteration,
    structureId,
    wallSpan,
    wallHeight,
    wallThickness,
    wallSpanSeg,
    wallHeightSeg,
    wallLayers,
    bondsXEnabled,
    bondsYEnabled,
    bondsZEnabled,
    autoBondingEnabled,
    scene,
    materialScale,
    skipSingleBodies,
    damageEnabled,
    contactDamageScale,
    minImpulseThreshold,
    contactCooldownMs,
    internalContactScale,
    speedMinExternal,
    speedMinInternal,
    speedMax,
    speedExponent,
    slowSpeedFactor,
    fastSpeedFactor,
    resimulateOnFracture,
    maxResimulationPasses,
    snapshotMode,
    resimulateOnDamageDestroy,
  ]);

  // Listen for a one-time test projectile spawn request; depends on speed/mass only
  useEffect(() => {
    const onSpawn = () => {
      const core = coreRef.current;
      if (!core) return;
      const target = new THREE.Vector3(0, 1.5, 0);
      const start = new THREE.Vector3(0, 4.5, 6);
      const dir = target.clone().sub(start).normalize();
      const vel = dir.multiplyScalar(projectileSpeed);
      if (isDev) console.debug("[Page] onSpawn", { start, target, vel });
      core.enqueueProjectile({
        start: { x: start.x, y: start.y, z: start.z },
        linvel: { x: vel.x, y: vel.y, z: vel.z },
        x: target.x,
        z: target.z,
        type: "ball",
        radius: projectileRadius,
        mass: projectileMass,
        friction: 0.6,
        restitution: 0.2,
      });
    };
    window.addEventListener("spawnTestProjectile", onSpawn, { once: true });
    return () => {
      window.removeEventListener(
        "spawnTestProjectile",
        onSpawn as EventListener,
      );
    };
  }, [projectileSpeed, projectileMass, projectileRadius]);

  // Toggle Rapier wireframe on/off when checkbox changes
  useEffect(() => {
    const core = coreRef.current;
    if (!physicsWireframe) {
      if (rapierDebugRef.current) {
        try {
          rapierDebugRef.current.dispose({});
        } catch {}
        rapierDebugRef.current = null;
      }
      return;
    }
    if (!core || rapierDebugRef.current) return;
    try {
      rapierDebugRef.current = new RapierDebugRenderer(scene, core.world, {
        enabled: true,
      });
    } catch {}
  }, [physicsWireframe, scene]);

  // Apply single-collision policy when toggled
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try {
      core.setSingleCollisionMode(singleCollisionMode);
    } catch {}
  }, [singleCollisionMode]);

  // Apply material scale to solver anytime it changes
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try {
      const defaults = core.runtime.defaultExtSettings();
      const scaled: Record<string, number> = {
        ...defaults,
      } as unknown as Record<string, number>;
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
      if (isDev)
        console.debug("[Page] Applied material scale", materialScale, scaled);
    } catch (e) {
      if (isDev) console.error("[Page] setSettings failed", e);
    }
  }, [materialScale]);

  useEffect(() => {
    const core = coreRef.current;
    if (core) core.setGravity(gravity);
  }, [gravity]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core || typeof core.setSleepThresholds !== "function") return;
    core.setSleepThresholds(sleepLinearThreshold, sleepAngularThreshold);
  }, [sleepLinearThreshold, sleepAngularThreshold]);

  // Update small body damping settings dynamically
  useEffect(() => {
    const core = coreRef.current;
    if (!core || typeof core.setSmallBodyDamping !== "function") return;
    core.setSmallBodyDamping({
      mode: smallBodyDampingMode,
      colliderCountThreshold: smallBodyColliderThreshold,
      minLinearDamping: smallBodyMinLinearDamping,
      minAngularDamping: smallBodyMinAngularDamping,
    });
  }, [
    smallBodyDampingMode,
    smallBodyColliderThreshold,
    smallBodyMinLinearDamping,
    smallBodyMinAngularDamping,
  ]);

  // Update sleep mode dynamically
  useEffect(() => {
    const core = coreRef.current;
    if (!core || typeof core.setSleepMode !== "function") return;
    core.setSleepMode(sleepMode);
  }, [sleepMode]);

  useEffect(() => {
    const core = coreRef.current;
    if (!core || typeof core.setProfiler !== "function") return;
    if (!profiling?.enabled || typeof profiling.onSample !== "function") {
      core.setProfiler(null);
      return;
    }
    const config = { enabled: true, onSample: profiling.onSample };
    core.setProfiler(config);
    return () => {
      core.setProfiler(null);
    };
  }, [profiling?.enabled, profiling?.onSample]);

  // Toggle whether gravity is applied to the solver without recreating the scene
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    try {
      (
        core as unknown as { setSolverGravityEnabled?: (v: boolean) => void }
      ).setSolverGravityEnabled?.(solverGravityEnabled);
    } catch {}
  }, [solverGravityEnabled]);

  // Click: spawn projectile, cut bonds, or push chunk depending on mode
  useEffect(() => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    const handle = (ev: MouseEvent) => {
      const core = coreRef.current;
      if (!core) return;
      const rect = (ev.target as HTMLElement).getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const cam = camera;
      if (!cam) {
        console.error("[Page] Missing camera in click handler");
        if (isDev) throw new Error("Missing camera");
        return;
      }
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, cam);
      if (!groupRef.current) {
        console.error("[Page] groupRef is null");
        if (isDev) throw new Error("Missing scene group");
        return;
      }
      // Intersect only with pickable chunk meshes that currently have active colliders/bodies
      const pickTargets: THREE.Object3D[] = (
        chunkMeshesRef.current ?? []
      ).filter((mesh) => {
        const idx = (
          mesh as THREE.Object3D & { userData?: Record<string, unknown> }
        )?.userData?.nodeIndex as number | undefined;
        if (typeof idx !== "number") return false;
        const seg = core.chunks[idx];
        if (!seg || seg.destroyed) return false;
        const ch = seg.colliderHandle;
        if (ch == null) return false;
        try {
          const col = core.world.getCollider(ch);
          if (!col) return false;
          // If collider exposes isEnabled, respect it
          const anyCol = col as unknown as { isEnabled?: () => boolean };
          if (typeof anyCol.isEnabled === "function" && !anyCol.isEnabled())
            return false;
        } catch {
          return false;
        }
        const bh = seg.bodyHandle;
        if (bh == null) return false;
        const body = core.world.getRigidBody(bh);
        if (!body) return false;
        return true;
      }) as unknown as THREE.Object3D[];
      const intersects: THREE.Intersection[] = raycaster.intersectObjects(
        pickTargets,
        true,
      );
      const target = new THREE.Vector3();
      if (intersects.length > 0) {
        target.copy(intersects[0].point);
      } else {
        const p = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
          p,
        );
        if (!hit) {
          console.error("[Page] No raycast hit with ground plane");
          if (isDev) throw new Error("No ray hit");
          return;
        }
        target.copy(p);
      }
      placeClickMarker(target);

      if (mode === "projectile") {
        // Spawn above and behind camera toward target
        const camPos = new THREE.Vector3();
        cam.getWorldPosition(camPos);
        const dir = new THREE.Vector3().subVectors(target, camPos).normalize();
        const start = camPos
          .clone()
          .addScaledVector(dir, 6)
          .add(new THREE.Vector3(0, 2.5, 0));
        const linvel = new THREE.Vector3()
          .subVectors(target, start)
          .normalize()
          .multiplyScalar(projectileSpeed);
        // if (isDev) console.debug('[Page] Click fire', { target, start, linvel, projType });
        core.enqueueProjectile({
          start: { x: start.x, y: start.y, z: start.z },
          linvel: { x: linvel.x, y: linvel.y, z: linvel.z },
          x: target.x,
          z: target.z,
          type: projType,
          radius: projectileRadius,
          mass: projectileMass,
          friction: 0.6,
          restitution: 0.2,
        });
      } else if (mode === "cutter") {
        // Cutter: choose first intersected mesh with nodeIndex
        let hitNodeIndex: number | null = null;
        for (const intr of intersects) {
          const obj = intr.object as THREE.Object3D & {
            userData?: Record<string, unknown>;
          };
          const idx = obj?.userData?.nodeIndex as number | undefined;
          if (typeof idx === "number") {
            hitNodeIndex = idx;
            break;
          }
        }
        if (hitNodeIndex == null) {
          if (isDev) console.warn("[Page] Cutter: no nodeIndex on hit object");
          return;
        }
        const bonds = core.getNodeBonds(hitNodeIndex);
        if (isDev)
          console.debug("[Page] Cutter: cutting bonds", {
            node: hitNodeIndex,
            count: bonds.length,
          });
        for (const b of bonds) core.cutBond(b.index);
      } else if (mode === "push") {
        // Push: pick intersected chunk and apply external force along ray direction
        let hit: THREE.Intersection | undefined;
        for (const intr of intersects) {
          const obj = intr.object as THREE.Object3D & {
            userData?: Record<string, unknown>;
          };
          const idx = obj?.userData?.nodeIndex as number | undefined;
          if (typeof idx === "number") {
            hit = intr;
            break;
          }
        }
        if (!hit) {
          if (isDev) console.warn("[Page] Push: no nodeIndex on hit object");
          return;
        }
        const nodeIndex = (
          hit.object as THREE.Object3D & { userData?: Record<string, unknown> }
        ).userData.nodeIndex as number;
        const dirWorld = raycaster.ray.direction.clone().normalize();
        const force = dirWorld.multiplyScalar(pushForce);
        // Apply to Rapier as a one-shot impulse at the hit point
        const seg = core.chunks[nodeIndex];
        const handle = seg?.bodyHandle;
        if (handle != null) {
          const body = core.world.getRigidBody(handle);
          if (body) {
            const dt =
              core.world.timestep ??
              core.world.integrationParameters?.dt ??
              1 / 60;
            const impulse = new THREE.Vector3(
              force.x * dt,
              force.y * dt,
              force.z * dt,
            );
            body.applyImpulseAtPoint(
              { x: impulse.x, y: impulse.y, z: impulse.z },
              { x: hit.point.x, y: hit.point.y, z: hit.point.z },
              true,
            );
          }
        }
        // Mirror to solver only (solver consumes and clears per-frame)
        core.applyExternalForce(
          nodeIndex,
          { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          { x: force.x, y: force.y, z: force.z },
        );
        if (isDev)
          console.debug("[Page] Push: applied", {
            nodeIndex,
            point: hit.point,
            force,
          });
      } else if (mode === "damage") {
        // Damage: pick intersected chunk and apply direct damage percent of max health
        let hit: THREE.Intersection | undefined;
        for (const intr of intersects) {
          const obj = intr.object as THREE.Object3D & {
            userData?: Record<string, unknown>;
          };
          const idx = obj?.userData?.nodeIndex as number | undefined;
          if (typeof idx === "number") {
            hit = intr;
            break;
          }
        }
        if (!hit) {
          if (isDev) console.warn("[Page] Damage: no nodeIndex on hit object");
          return;
        }
        const nodeIndex = (
          hit.object as THREE.Object3D & { userData?: Record<string, unknown> }
        ).userData.nodeIndex as number;
        if (
          !damageEnabled ||
          typeof core.applyNodeDamage !== "function" ||
          typeof core.getNodeHealth !== "function"
        ) {
          if (isDev) console.warn("[Page] Damage: damage system not enabled");
          return;
        }
        const info = core.getNodeHealth(nodeIndex);
        const maxH = Math.max(1, info?.maxHealth ?? 1);
        const amount = maxH * Math.max(0, Math.min(1, damageClickRatio));
        core.applyNodeDamage(nodeIndex, amount, "manual");
        if (isDev)
          console.debug("[Page] Damage: applied", { nodeIndex, amount });
      }
    };
    canvas.addEventListener("pointerdown", handle);
    return () => canvas.removeEventListener("pointerdown", handle);
  }, [
    mode,
    pushForce,
    projType,
    camera,
    projectileSpeed,
    projectileMass,
    projectileRadius,
    placeClickMarker,
    damageClickRatio,
    damageEnabled,
  ]);

  const hasCrashed = useRef(false);
  const lastBodyCountRef = useRef<number | null>(null);
  const lastActiveBodyCountRef = useRef<number | null>(null);
  const lastColliderCountRef = useRef<number | null>(null);
  const lastBondsCountRef = useRef<number | null>(null);
  const accumulatorRef = useRef(0);
  const FIXED_STEP_DT = 1 / 60;
  const MIN_STEP_DT = 1 / 240;
  const MAX_STEP_DT = 1 / 30;
  const MAX_FRAME_DELTA = 0.1;
  const MAX_SUBSTEPS_PER_FRAME = 5;

  useFrame((_, delta) => {
    if (hasCrashed.current) return;

    const core = coreRef.current;
    if (!core) return;
    const frameStart = perfNow();
    const clampedDelta =
      Number.isFinite(delta) && delta > 0
        ? Math.min(delta, MAX_FRAME_DELTA)
        : FIXED_STEP_DT;
    let stepsRun = 0;
    const stepWithDt = (dt: number) => {
      const clamped = Math.min(MAX_STEP_DT, Math.max(MIN_STEP_DT, dt));
      core.step(clamped);
      stepsRun += 1;
    };
    try {
      if (adaptiveDt) {
        let remaining = clampedDelta;
        while (remaining > 0 && stepsRun < MAX_SUBSTEPS_PER_FRAME) {
          const dt = Math.min(remaining, MAX_STEP_DT);
          stepWithDt(dt);
          remaining -= dt;
        }
      } else {
        accumulatorRef.current = Math.min(
          accumulatorRef.current + clampedDelta,
          MAX_FRAME_DELTA,
        );
        while (
          accumulatorRef.current >= FIXED_STEP_DT &&
          stepsRun < MAX_SUBSTEPS_PER_FRAME
        ) {
          stepWithDt(FIXED_STEP_DT);
          accumulatorRef.current -= FIXED_STEP_DT;
        }
      }
      if (stepsRun === 0) return;
      // Update scene meshes first, then debug renderers to avoid Rapier aliasing issues
      if (batchedMeshResultRef.current) {
        // Use optimized BatchedMesh update (single draw call)
        updateBatchedChunkMesh(
          core,
          batchedMeshResultRef.current.batchedMesh,
          batchedMeshResultRef.current.chunkToInstanceId,
          { updateBVH: false }, // BVH updates are expensive, use margin instead
        );
      } else if (chunkMeshesRef.current) {
        // Fallback to individual mesh updates
        updateChunkMeshes(core, chunkMeshesRef.current);
      }
      if (groupRef.current) updateProjectileMeshes(core, groupRef.current);
    } catch (e) {
      console.error(e);
      hasCrashed.current = true;
      return;
    }

    // Update Rapier wireframe last
    if (rapierDebugRef.current) rapierDebugRef.current.update();
    const helper = debugHelperRef.current;
    if (helper) {
      if (debug) {
        const lines = core.getSolverDebugLines();
        helper.update(core, lines, true);
        debugLinesActiveRef.current = true;
      } else if (debugLinesActiveRef.current) {
        helper.update(core, [], false);
        debugLinesActiveRef.current = false;
      }
    }

    if (
      bodyCountRef?.current ||
      activeBodyCountRef?.current ||
      colliderCountRef?.current ||
      bondsCountRef?.current
    ) {
      let liveCount = 0;
      let activeCount = 0;
      let colliderCount = 0;
      let bondsCount = 0;
      try {
        core.world.forEachRigidBody(() => {
          liveCount += 1;
        });
      } catch {
        liveCount = 0;
      }
      try {
        core.world.forEachActiveRigidBody(() => {
          activeCount += 1;
        });
      } catch {
        activeCount = 0;
      }
      try {
        colliderCount = core.colliderToNode ? core.colliderToNode.size : 0;
      } catch {
        colliderCount = 0;
      }
      try {
        bondsCount = core.getActiveBondsCount();
      } catch {
        bondsCount = 0;
      }
      if (bodyCountRef?.current && lastBodyCountRef.current !== liveCount) {
        bodyCountRef.current.textContent = liveCount.toString();
        lastBodyCountRef.current = liveCount;
      }
      if (
        activeBodyCountRef?.current &&
        lastActiveBodyCountRef.current !== activeCount
      ) {
        activeBodyCountRef.current.textContent = activeCount.toString();
        lastActiveBodyCountRef.current = activeCount;
      }
      if (
        colliderCountRef?.current &&
        lastColliderCountRef.current !== colliderCount
      ) {
        colliderCountRef.current.textContent = colliderCount.toString();
        lastColliderCountRef.current = colliderCount;
      }
      if (
        bondsCountRef?.current &&
        lastBondsCountRef.current !== bondsCount
      ) {
        bondsCountRef.current.textContent = bondsCount.toString();
        lastBondsCountRef.current = bondsCount;
      }
    }

    const duration = perfNow() - frameStart;
    const stats = frameStatsRef.current;
    stats.samples += 1;
    stats.total += duration;
    stats.max = Math.max(stats.max, duration);
    try {
      const stressWindow = window as StressDebugWindow;
      stressWindow.__stressFrameStats = {
        frames: stats.samples,
        lastUseFrameMs: duration,
        maxUseFrameMs: stats.max,
        avgUseFrameMs: stats.total / stats.samples,
        updatedAt: Date.now(),
      };
      if (duration > 4 && perfNow() - frameLogRef.current > 1000) {
        frameLogRef.current = perfNow();
        console.info(
          `[FrameStats] useFrame took ${duration.toFixed(
            2,
          )} ms (avg ${(stats.total / stats.samples).toFixed(2)} ms)`,
        );
      }
    } catch {}
  });

  return (
    <>
      <group ref={groupRef} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow={shadowsEnabled}
        position={[6, 8, 6]}
        intensity={1.2}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Ground />
      <OrbitControls makeDefault enableDamping dampingFactor={0.15} />
    </>
  );
}

const PROFILER_STATS_THROTTLE_MS = 200;

export default function Page() {
  console.log("Page render");

  const [debug, setDebug] = useState(false);
  const [physicsWireframe, setPhysicsWireframe] = useState(false);
  const [gravity, setGravity] = useState(-9.81);
  const [solverGravityEnabled, setSolverGravityEnabled] = useState(true);
  const [adaptiveDt, setAdaptiveDt] = useState(true);
  const [sleepLinearThreshold, setSleepLinearThreshold] = useState(0.1);
  const [sleepAngularThreshold, setSleepAngularThreshold] = useState(0.1);
  const [sleepMode, setSleepMode] = useState<OptimizationMode>("off");
  // Small body damping - higher damping for bodies with few colliders
  const [smallBodyColliderThreshold, setSmallBodyColliderThreshold] =
    useState(3);
  const [smallBodyMinLinearDamping, setSmallBodyMinLinearDamping] = useState(2);
  const [smallBodyMinAngularDamping, setSmallBodyMinAngularDamping] =
    useState(2);
  const [smallBodyDampingMode, setSmallBodyDampingMode] =
    useState<OptimizationMode>("off");
  const [singleCollisionMode, setSingleCollisionMode] =
    useState<SingleCollisionMode>("all");
  const [skipSingleBodies, setSkipSingleBodies] = useState(false);
  const [damageEnabled, setDamageEnabled] = useState(true);
  const [iteration, setIteration] = useState(0);
  const [mode, setMode] = useState<"projectile" | "cutter" | "push" | "damage">(
    "projectile",
  );
  const [damageClickRatio, setDamageClickRatio] = useState(0.5);
  const [contactDamageScale, setContactDamageScale] = useState(100.0);
  const [minImpulseThreshold, setMinImpulseThreshold] = useState(0);
  const [contactCooldownMs, setContactCooldownMs] = useState(100);
  const [internalContactScale, setInternalContactScale] = useState(0.5);
  // Impact speed scaling state (defaults must mirror core defaults)
  const [speedMinExternal, setSpeedMinExternal] = useState(0.5);
  const [speedMinInternal, setSpeedMinInternal] = useState(0.25);
  const [speedMax, setSpeedMax] = useState(6.0);
  const [speedExponent, setSpeedExponent] = useState(1.0);
  const [slowSpeedFactor, setSlowSpeedFactor] = useState(0.1);
  const [fastSpeedFactor, setFastSpeedFactor] = useState(10.0);
  // const [structureId, setStructureId] = useState<StressPresetId>("hut");
  const [structureId, setStructureId] = useState<StressPresetId>("tower");
  const [projType, setProjType] = useState<"ball" | "box">("ball");
  const [projectileSpeed, setProjectileSpeed] = useState(36);
  const [projectileMass, setProjectileMass] = useState(15000);
  const [projectileRadius, setProjectileRadius] = useState(0.5);
  const [materialScale, setMaterialScale] = useState(100_000_000.0);
  const [pushForce, setPushForce] = useState(8000);
  const [resimulateOnFracture, setResimulateOnFracture] = useState(true);
  const [resimulateOnDamageDestroy, setResimulateOnDamageDestroy] =
    useState(true);
  const [maxResimulationPasses, setMaxResimulationPasses] = useState(1);
  const [snapshotMode, setSnapshotMode] = useState<"perBody" | "world">(
    "perBody",
  );
  const [wallSpan, setWallSpan] = useState(6.0);
  const [wallHeight, setWallHeight] = useState(3.0);
  const [wallThickness, setWallThickness] = useState(0.32);
  const [wallSpanSeg, setWallSpanSeg] = useState(12);
  const [wallHeightSeg, setWallHeightSeg] = useState(6);
  const [wallLayers, setWallLayers] = useState(1);
  const [bondsXEnabled, setBondsXEnabled] = useState(true);
  const [bondsYEnabled, setBondsYEnabled] = useState(true);
  const [bondsZEnabled, setBondsZEnabled] = useState(true);
  const [autoBondingEnabled, setAutoBondingEnabled] = useState(false);
  const [showPerfOverlay, setShowPerfOverlay] = useState(true);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [profilingEnabled, setProfilingEnabled] = useState(false);
  const profilerSamplesRef = useRef<CoreProfilerSample[]>([]);
  const profilerSessionRef = useRef<{
    startedAt: number;
    config: Record<string, unknown>;
  } | null>(null);
  const [profilerStats, setProfilerStats] =
    useState<ProfilerStatsState>(EMPTY_PROFILER_STATS);
  const profilerPendingStatsRef = useRef<ProfilerStatsState | null>(null);
  const profilerStatsTimerRef = useRef<number | null>(null);
  const scheduleProfilerStatsUpdate = useCallback(
    (next: ProfilerStatsState, immediate = false) => {
      profilerPendingStatsRef.current = next;
      if (immediate) {
        if (profilerStatsTimerRef.current != null) {
          window.clearTimeout(profilerStatsTimerRef.current);
          profilerStatsTimerRef.current = null;
        }
        startTransition(() => setProfilerStats(next));
        profilerPendingStatsRef.current = null;
        return;
      }
      if (profilerStatsTimerRef.current != null) return;
      profilerStatsTimerRef.current = window.setTimeout(() => {
        profilerStatsTimerRef.current = null;
        const latest = profilerPendingStatsRef.current;
        if (!latest) return;
        startTransition(() => setProfilerStats(latest));
        profilerPendingStatsRef.current = null;
      }, PROFILER_STATS_THROTTLE_MS);
    },
    [],
  );
  useEffect(() => {
    return () => {
      if (profilerStatsTimerRef.current != null) {
        window.clearTimeout(profilerStatsTimerRef.current);
      }
    };
  }, []);
  const captureProfilerConfig = useCallback(
    () => ({
      structureId,
      mode,
      gravity,
      solverGravityEnabled,
      adaptiveDt,
      sleepLinearThreshold,
      sleepAngularThreshold,
      singleCollisionMode,
      skipSingleBodies,
      damageEnabled,
      damageClickRatio,
      contactDamageScale,
      minImpulseThreshold,
      contactCooldownMs,
      internalContactScale,
      speedMinExternal,
      speedMinInternal,
      speedMax,
      speedExponent,
      slowSpeedFactor,
      fastSpeedFactor,
      projType,
      projectileSpeed,
      projectileMass,
      projectileRadius,
      materialScale,
      pushForce,
      resimulateOnFracture,
      resimulateOnDamageDestroy,
      maxResimulationPasses,
      snapshotMode,
      wallSpan,
      wallHeight,
      wallThickness,
      wallSpanSeg,
      wallHeightSeg,
      wallLayers,
      bondsXEnabled,
      bondsYEnabled,
      bondsZEnabled,
      autoBondingEnabled,
    }),
    [
      structureId,
      mode,
      gravity,
      solverGravityEnabled,
      adaptiveDt,
      sleepLinearThreshold,
      sleepAngularThreshold,
      singleCollisionMode,
      skipSingleBodies,
      damageEnabled,
      damageClickRatio,
      contactDamageScale,
      minImpulseThreshold,
      contactCooldownMs,
      internalContactScale,
      speedMinExternal,
      speedMinInternal,
      speedMax,
      speedExponent,
      slowSpeedFactor,
      fastSpeedFactor,
      projType,
      projectileSpeed,
      projectileMass,
      projectileRadius,
      materialScale,
      pushForce,
      resimulateOnFracture,
      resimulateOnDamageDestroy,
      maxResimulationPasses,
      snapshotMode,
      wallSpan,
      wallHeight,
      wallThickness,
      wallSpanSeg,
      wallHeightSeg,
      wallLayers,
      bondsXEnabled,
      bondsYEnabled,
      bondsZEnabled,
      autoBondingEnabled,
    ],
  );
  const rigidBodyCountRef = useRef<HTMLSpanElement | null>(null);
  const activeRigidBodyCountRef = useRef<HTMLSpanElement | null>(null);
  const colliderCountRef = useRef<HTMLSpanElement | null>(null);
  const bondsCountRef = useRef<HTMLSpanElement | null>(null);
  const structures = STRESS_PRESET_METADATA;
  const currentStructure =
    structures.find((item) => item.id === structureId) ?? structures[0];
  const handleProfilerSample = useCallback(
    (sample: CoreProfilerSample) => {
      profilerSamplesRef.current.push(sample);
      scheduleProfilerStatsUpdate(
        {
          sampleCount: profilerSamplesRef.current.length,
          lastFrameMs:
            typeof sample.totalMs === "number" ? sample.totalMs : null,
          lastSample: sample,
        },
        false,
      );
    },
    [scheduleProfilerStatsUpdate],
  );
  const startProfiling = useCallback(() => {
    profilerSamplesRef.current = [];
    profilerSessionRef.current = {
      startedAt: Date.now(),
      config: captureProfilerConfig(),
    };
    scheduleProfilerStatsUpdate(EMPTY_PROFILER_STATS, true);
    setProfilingEnabled(true);
  }, [captureProfilerConfig, scheduleProfilerStatsUpdate]);
  const stopProfiling = useCallback(() => {
    setProfilingEnabled(false);
    const payload = {
      startedAt: profilerSessionRef.current?.startedAt ?? Date.now(),
      stoppedAt: Date.now(),
      config: profilerSessionRef.current?.config ?? captureProfilerConfig(),
      sampleCount: profilerSamplesRef.current.length,
      samples: profilerSamplesRef.current,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stress-profiler-${new Date()
      .toISOString()
      .replace(/[:]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    profilerSessionRef.current = null;
    profilerSamplesRef.current = [];
    scheduleProfilerStatsUpdate(EMPTY_PROFILER_STATS, true);
  }, [captureProfilerConfig, scheduleProfilerStatsUpdate]);
  const profilingControls = useMemo(
    () => ({
      enabled: profilingEnabled,
      onSample: profilingEnabled ? handleProfilerSample : undefined,
    }),
    [handleProfilerSample, profilingEnabled],
  );
  // Auto-spawn on first render disabled; click-to-spawn only.
  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <ControlPanel
        debug={debug}
        setDebug={setDebug}
        physicsWireframe={physicsWireframe}
        setPhysicsWireframe={setPhysicsWireframe}
        gravity={gravity}
        setGravity={setGravity}
        solverGravityEnabled={solverGravityEnabled}
        setSolverGravityEnabled={setSolverGravityEnabled}
        singleCollisionMode={singleCollisionMode}
        setSingleCollisionMode={setSingleCollisionMode}
        skipSingleBodies={skipSingleBodies}
        setSkipSingleBodies={setSkipSingleBodies}
        damageClickRatio={damageClickRatio}
        setDamageClickRatio={setDamageClickRatio}
        mode={mode}
        setMode={setMode}
        damageEnabled={damageEnabled}
        setDamageEnabled={setDamageEnabled}
        pushForce={pushForce}
        setPushForce={setPushForce}
        projType={projType}
        setProjType={setProjType}
        reset={() => setIteration((v) => v + 1)}
        projectileSpeed={projectileSpeed}
        setProjectileSpeed={setProjectileSpeed}
        projectileMass={projectileMass}
        setProjectileMass={setProjectileMass}
        projectileRadius={projectileRadius}
        setProjectileRadius={setProjectileRadius}
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
        bondsXEnabled={bondsXEnabled}
        setBondsXEnabled={setBondsXEnabled}
        bondsYEnabled={bondsYEnabled}
        setBondsYEnabled={setBondsYEnabled}
        bondsZEnabled={bondsZEnabled}
        setBondsZEnabled={setBondsZEnabled}
        autoBondingEnabled={autoBondingEnabled}
        setAutoBondingEnabled={setAutoBondingEnabled}
        structureId={structureId}
        setStructureId={setStructureId}
        structures={structures}
        structureDescription={currentStructure?.description}
        contactDamageScale={contactDamageScale}
        setContactDamageScale={setContactDamageScale}
        minImpulseThreshold={minImpulseThreshold}
        setMinImpulseThreshold={setMinImpulseThreshold}
        contactCooldownMs={contactCooldownMs}
        setContactCooldownMs={setContactCooldownMs}
        internalContactScale={internalContactScale}
        setInternalContactScale={setInternalContactScale}
        speedMinExternal={speedMinExternal}
        setSpeedMinExternal={setSpeedMinExternal}
        speedMinInternal={speedMinInternal}
        setSpeedMinInternal={setSpeedMinInternal}
        speedMax={speedMax}
        setSpeedMax={setSpeedMax}
        speedExponent={speedExponent}
        setSpeedExponent={setSpeedExponent}
        slowSpeedFactor={slowSpeedFactor}
        setSlowSpeedFactor={setSlowSpeedFactor}
        fastSpeedFactor={fastSpeedFactor}
        setFastSpeedFactor={setFastSpeedFactor}
        resimulateOnFracture={resimulateOnFracture}
        setResimulateOnFracture={setResimulateOnFracture}
        maxResimulationPasses={maxResimulationPasses}
        setMaxResimulationPasses={setMaxResimulationPasses}
        snapshotMode={snapshotMode}
        setSnapshotMode={setSnapshotMode}
        resimulateOnDamageDestroy={resimulateOnDamageDestroy}
        setResimulateOnDamageDestroy={setResimulateOnDamageDestroy}
        bodyCountRef={rigidBodyCountRef}
        activeBodyCountRef={activeRigidBodyCountRef}
        colliderCountRef={colliderCountRef}
        bondsCountRef={bondsCountRef}
        adaptiveDt={adaptiveDt}
        setAdaptiveDt={setAdaptiveDt}
        sleepLinearThreshold={sleepLinearThreshold}
        setSleepLinearThreshold={setSleepLinearThreshold}
        sleepAngularThreshold={sleepAngularThreshold}
        setSleepAngularThreshold={setSleepAngularThreshold}
        smallBodyColliderThreshold={smallBodyColliderThreshold}
        setSmallBodyColliderThreshold={setSmallBodyColliderThreshold}
        smallBodyMinLinearDamping={smallBodyMinLinearDamping}
        setSmallBodyMinLinearDamping={setSmallBodyMinLinearDamping}
        smallBodyMinAngularDamping={smallBodyMinAngularDamping}
        setSmallBodyMinAngularDamping={setSmallBodyMinAngularDamping}
        sleepMode={sleepMode}
        setSleepMode={setSleepMode}
        smallBodyDampingMode={smallBodyDampingMode}
        setSmallBodyDampingMode={setSmallBodyDampingMode}
        showPerfOverlay={showPerfOverlay}
        setShowPerfOverlay={setShowPerfOverlay}
        profilingEnabled={profilingEnabled}
        startProfiling={startProfiling}
        stopProfiling={stopProfiling}
        profilerStats={profilerStats}
        collapsed={controlsCollapsed}
        setCollapsed={setControlsCollapsed}
      />

      <Canvas
        shadows={shadowsEnabled}
        camera={{ position: [7, 5, 9], fov: 45 }}
      >
        <color attach="background" args={["#0e0e12"]} />
        <Scene
          debug={debug}
          physicsWireframe={physicsWireframe}
          gravity={gravity}
          solverGravityEnabled={solverGravityEnabled}
          singleCollisionMode={singleCollisionMode}
          skipSingleBodies={skipSingleBodies}
          iteration={iteration}
          structureId={structureId}
          mode={mode}
          damageEnabled={damageEnabled}
          damageClickRatio={damageClickRatio}
          contactDamageScale={contactDamageScale}
          minImpulseThreshold={minImpulseThreshold}
          contactCooldownMs={contactCooldownMs}
          internalContactScale={internalContactScale}
          speedMinExternal={speedMinExternal}
          speedMinInternal={speedMinInternal}
          speedMax={speedMax}
          speedExponent={speedExponent}
          slowSpeedFactor={slowSpeedFactor}
          fastSpeedFactor={fastSpeedFactor}
          pushForce={pushForce}
          projType={projType}
          projectileSpeed={projectileSpeed}
          projectileMass={projectileMass}
          projectileRadius={projectileRadius}
          materialScale={materialScale}
          resimulateOnFracture={resimulateOnFracture}
          maxResimulationPasses={maxResimulationPasses}
          snapshotMode={snapshotMode}
          resimulateOnDamageDestroy={resimulateOnDamageDestroy}
          wallSpan={wallSpan}
          wallHeight={wallHeight}
          wallThickness={wallThickness}
          wallSpanSeg={wallSpanSeg}
          wallHeightSeg={wallHeightSeg}
          wallLayers={wallLayers}
          bondsXEnabled={bondsXEnabled}
          bondsYEnabled={bondsYEnabled}
          bondsZEnabled={bondsZEnabled}
          autoBondingEnabled={autoBondingEnabled}
          onReset={() => setIteration((v) => v + 1)}
          bodyCountRef={rigidBodyCountRef}
          activeBodyCountRef={activeRigidBodyCountRef}
          colliderCountRef={colliderCountRef}
          bondsCountRef={bondsCountRef}
          adaptiveDt={adaptiveDt}
          sleepLinearThreshold={sleepLinearThreshold}
          sleepAngularThreshold={sleepAngularThreshold}
          smallBodyColliderThreshold={smallBodyColliderThreshold}
          smallBodyMinLinearDamping={smallBodyMinLinearDamping}
          smallBodyMinAngularDamping={smallBodyMinAngularDamping}
          sleepMode={sleepMode}
          smallBodyDampingMode={smallBodyDampingMode}
          profiling={profilingControls}
        />
        {showPerfOverlay ? (
          <R3FPerf
            // matrixUpdate deepAnalyze overClock
            position="top-left"
          />
        ) : null}
        {/* <StatsGl className="absolute top-2 left-2" trackGPU={true} horizontal={true} /> */}
      </Canvas>
    </div>
  );
}
