/**
 * Fire Propagation System Library
 *
 * A 3D voxel-based fire simulation with temperature, moisture, and fuel dynamics.
 *
 * @example
 * ```ts
 * import { FireSystem, initGrassField, MaterialType } from '@/lib/fire-propagation';
 *
 * // Create a fire simulation system
 * const system = new FireSystem('medium');
 *
 * // Initialize with a preset scene
 * initGrassField(system);
 *
 * // Start a fire
 * system.ignite(32, 0, 32, 3);
 *
 * // Run simulation
 * system.step(1/60);
 *
 * // Get state buffer for rendering
 * const buffer = system.getStateBuffer();
 * ```
 */

// Types
export {
  MaterialType,
  VisualState,
  MATERIAL_PROPERTIES,
  GRID_PRESETS,
  DEFAULT_WIND,
  DEFAULT_SIMULATION,
  DEFAULT_BRUSH,
  InteractionTool,
  type MaterialProperties,
  type VoxelState,
  type GridConfig,
  type GridPreset,
  type WindParams,
  type SimulationParams,
  type SimulationStats,
  type BrushConfig,
  type ScenePreset,
  type GpuMaterialProps,
  type GpuSimulationUniforms,
} from "./types";

// Core simulation
export {
  FireSystem,
  initGrassField,
  initForest,
  initMixedTerrain,
} from "./fire-system";

// Shaders
export {
  fireComputeShader,
  createMaterialPropertiesData,
  createSimulationUniformsData,
} from "./shaders/fire-compute";

export {
  fireRenderShader,
  groundPlaneShader,
  FIRE_COLORS,
} from "./shaders/fire-render";

