"use client";

/**
 * FireScene Component
 *
 * Main scene orchestrator for the fire propagation demo.
 * Manages the fire system, handles user interactions, and renders the scene.
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, StatsGl } from "@react-three/drei";
import * as THREE from "three";
import {
  FireSystem,
  initGrassField,
  initForest,
  initMixedTerrain,
} from "@/lib/fire-propagation/fire-system";
import {
  type WindParams,
  type SimulationParams,
  type GridPreset,
  InteractionTool,
  MaterialType,
} from "@/lib/fire-propagation/types";
import { FireGridMesh, GroundPlane, FireGlowEffect } from "./FireGridMesh";

export interface FireSceneProps {
  /** Grid size preset */
  gridPreset: GridPreset;
  /** Scene preset to initialize */
  scenePreset: "grassField" | "forest" | "mixedTerrain";
  /** Wind parameters */
  wind: WindParams;
  /** Simulation parameters */
  simulation: SimulationParams;
  /** Global burn rate multiplier */
  globalBurnRate: number;
  /** Global fuel density multiplier */
  globalFuel: number;
  /** Current interaction tool */
  tool: InteractionTool;
  /** Brush radius for tools */
  brushRadius: number;
  /** Material to paint (for paint tool) */
  paintMaterial: MaterialType;
  /** Whether simulation is paused */
  paused: boolean;
  /** Reset trigger (increment to reset) */
  resetTrigger: number;
  /** Callback for stats updates */
  onStatsUpdate?: (stats: {
    burning: number;
    steaming: number;
    charred: number;
    avgTemp: number;
    avgMoist: number;
    stepMs: number;
  }) => void;
  /** Show fire glow effect */
  showGlow?: boolean;
  /** Show performance stats */
  showStats?: boolean;
  /** Show debug grid overlay */
  showDebugGrid?: boolean;
}

/**
 * Scene content component that uses R3F hooks.
 */
function FireSceneContent({
  gridPreset,
  scenePreset,
  wind,
  simulation,
  globalBurnRate,
  globalFuel,
  tool,
  brushRadius,
  paintMaterial,
  paused,
  resetTrigger,
  onStatsUpdate,
  showGlow = true,
  showDebugGrid = false,
}: Omit<FireSceneProps, "showStats">) {
  const systemRef = useRef<FireSystem | null>(null);
  const [system, setSystem] = useState<FireSystem | null>(null);
  const lastResetRef = useRef(resetTrigger);
  const { camera, raycaster, pointer } = useThree();

  // Initialize or reset the fire system
  useEffect(() => {
    // Create new system
    const newSystem = new FireSystem(gridPreset, [0, 0, 0]);

    // Initialize with preset
    switch (scenePreset) {
      case "forest":
        initForest(newSystem);
        break;
      case "mixedTerrain":
        initMixedTerrain(newSystem);
        break;
      case "grassField":
      default:
        initGrassField(newSystem);
        break;
    }

    systemRef.current = newSystem;
    setSystem(newSystem);
    lastResetRef.current = resetTrigger;

    // Set camera to view terrain from above at an angle
    const { sizeX, sizeY, sizeZ, voxelSize } = newSystem.config;
    const gridWidth = sizeX * voxelSize;
    const gridHeight = sizeY * voxelSize;
    const gridDepth = sizeZ * voxelSize;

    // Position camera to see the whole terrain
    const cameraDistance = Math.max(gridWidth, gridDepth) * 1.2;
    camera.position.set(
      gridWidth * 0.7,
      cameraDistance * 0.6,
      gridDepth * 0.7
    );
    camera.lookAt(gridWidth * 0.5, gridHeight * 0.1, gridDepth * 0.5);

    return () => {
      // Cleanup not needed for CPU system
    };
  }, [gridPreset, scenePreset, resetTrigger, camera]);

  // Update wind and simulation parameters
  useEffect(() => {
    const sys = systemRef.current;
    if (!sys) return;
    sys.wind = { ...wind };
    sys.simulation = { ...simulation };
  }, [wind, simulation]);

  // Update global multipliers
  useEffect(() => {
    const sys = systemRef.current;
    if (!sys) return;
    sys.setGlobalMultipliers(globalBurnRate, globalFuel);
  }, [globalBurnRate, globalFuel]);

  // Run simulation step each frame
  useFrame((state, delta) => {
    const sys = systemRef.current;
    if (!sys || paused) return;

    // Run simulation
    sys.step(delta);

    // Report stats (throttled)
    if (onStatsUpdate && Math.random() < 0.1) {
      const stats = sys.getStats();
      onStatsUpdate({
        burning: stats.burningVoxels,
        steaming: stats.steamingVoxels,
        charred: stats.charredVoxels,
        avgTemp: stats.avgTemperature,
        avgMoist: stats.avgMoisture,
        stepMs: stats.stepTimeMs,
      });
    }
  });

  // Handle clicks for tools
  const handleClick = useCallback(
    (event: THREE.Event) => {
      const sys = systemRef.current;
      if (!sys || tool === InteractionTool.NONE) return;

      // Update raycaster
      raycaster.setFromCamera(pointer, camera);

      // Create a ground plane for intersection
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, intersection);

      if (!intersection) return;

      // Convert world position to grid coordinates
      const { sizeX, sizeY, sizeZ, voxelSize, originX, originY, originZ } =
        sys.config;
      const gx = Math.floor((intersection.x - originX) / voxelSize);
      const gy = 0; // Ground level
      const gz = Math.floor((intersection.z - originZ) / voxelSize);

      // Clamp to grid bounds
      const cx = Math.max(0, Math.min(sizeX - 1, gx));
      const cz = Math.max(0, Math.min(sizeZ - 1, gz));

      // Apply tool
      switch (tool) {
        case InteractionTool.IGNITE:
          sys.ignite(cx, gy, cz, brushRadius);
          break;
        case InteractionTool.EXTINGUISH:
          sys.wet(cx, gy, cz, brushRadius);
          break;
        case InteractionTool.PAINT_MATERIAL:
          sys.fillSphere(cx, gy, cz, brushRadius, paintMaterial);
          break;
        case InteractionTool.HEAT:
          // Add heat without igniting
          for (let dz = -brushRadius; dz <= brushRadius; dz++) {
            for (let dy = 0; dy <= brushRadius; dy++) {
              for (let dx = -brushRadius; dx <= brushRadius; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist <= brushRadius) {
                  const state = sys.getVoxel(cx + dx, gy + dy, cz + dz);
                  if (state) {
                    sys.setVoxel(cx + dx, gy + dy, cz + dz, {
                      temperature: Math.min(
                        1,
                        state.temperature + 0.3 * (1 - dist / brushRadius)
                      ),
                    });
                  }
                }
              }
            }
          }
          break;
        case InteractionTool.COOL:
          // Remove heat
          for (let dz = -brushRadius; dz <= brushRadius; dz++) {
            for (let dy = 0; dy <= brushRadius; dy++) {
              for (let dx = -brushRadius; dx <= brushRadius; dx++) {
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist <= brushRadius) {
                  const state = sys.getVoxel(cx + dx, gy + dy, cz + dz);
                  if (state) {
                    sys.setVoxel(cx + dx, gy + dy, cz + dz, {
                      temperature: Math.max(
                        0.1,
                        state.temperature - 0.3 * (1 - dist / brushRadius)
                      ),
                    });
                  }
                }
              }
            }
          }
          break;
      }
    },
    [tool, brushRadius, paintMaterial, raycaster, camera, pointer]
  );

  // Set up click handler
  useEffect(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;

    const handlePointerDown = (e: PointerEvent) => {
      // Update Three.js pointer
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      handleClick(e as unknown as THREE.Event);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    return () => canvas.removeEventListener("pointerdown", handlePointerDown);
  }, [handleClick, pointer]);

  if (!system) {
    return null;
  }

  return (
    <>
      {/* Fire grid visualization */}
      <FireGridMesh system={system} showDebugGrid={showDebugGrid} />

      {/* Fire glow effect */}
      {showGlow && <FireGlowEffect system={system} />}

      {/* Ground plane */}
      {/* <GroundPlane
        size={Math.max(system.config.sizeX, system.config.sizeZ) * system.config.voxelSize * 1.5}
      /> */}

      {/* Lighting - omnidirectional to ensure visibility from all angles */}
      {/* Strong ambient for base visibility */}
      <ambientLight intensity={1.2} />
      
      {/* Hemisphere light for natural sky/ground gradient */}
      <hemisphereLight
        args={[0xffffff, 0x444444, 0.8]}
      />
      
      {/* Multiple directional lights from different angles */}
      <directionalLight
        position={[50, 100, 50]}
        intensity={0.8}
      />
      <directionalLight
        position={[-50, 80, -50]}
        intensity={0.6}
      />
      <directionalLight
        position={[50, 60, -50]}
        intensity={0.4}
      />
      <directionalLight
        position={[-50, 60, 50]}
        intensity={0.4}
      />

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        target={[
          system.config.sizeX * system.config.voxelSize * 0.5,
          system.config.sizeY * system.config.voxelSize * 0.25,
          system.config.sizeZ * system.config.voxelSize * 0.5,
        ]}
        minDistance={10}
        maxDistance={500}
        maxPolarAngle={Math.PI / 2 - 0.1}
        enableDamping
        dampingFactor={0.1}
      />
    </>
  );
}

/**
 * Main FireScene component with stats overlay.
 */
export function FireScene({
  showStats = true,
  ...props
}: FireSceneProps) {
  return (
    <>
      <FireSceneContent {...props} />
      {showStats && <StatsGl className="absolute top-4 left-4" />}
    </>
  );
}

export default FireScene;

