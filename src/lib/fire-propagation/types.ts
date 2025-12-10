/**
 * Fire Propagation System Types
 *
 * A 3D voxel-based fire simulation with temperature, moisture, and fuel dynamics.
 * Inspired by Far Cry 2's fire propagation but enhanced with a dual-axis state system.
 */

// ============================================================================
// Material System
// ============================================================================

/**
 * Material types for the fire simulation.
 * Each material has different fire behavior characteristics.
 */
export enum MaterialType {
  AIR = 0, // Empty space, allows heat convection
  GRASS = 1, // Low ignition temp, fast burn, dries quickly
  DRY_BRUSH = 2, // Very low ignition, very fast burn, spreads fire rapidly
  WOOD = 3, // Medium ignition, slow burn, high fuel
  LEAVES = 4, // Very low ignition, very fast burn
  STONE = 5, // Cannot burn, high conductivity
  WATER = 6, // Moisture source, absorbs heat, creates steam
  LAVA = 7, // Constant heat source
}

/**
 * Properties that define how a material behaves in the fire simulation.
 * Stored in a uniform buffer for GPU access.
 */
export interface MaterialProperties {
  /** Display name */
  name: string;
  /** Temperature threshold to ignite (0-1) */
  ignitionTemp: number;
  /** Maximum moisture level that allows burning (0-1) */
  maxBurnMoisture: number;
  /** How fast fuel is consumed when burning (units/second) */
  burnRate: number;
  /** How well it transfers heat to neighbors (0-1) */
  heatConductivity: number;
  /** Maximum moisture this material can hold (0-1) */
  moistureCapacity: number;
  /** How fast moisture evaporates when hot (units/second) */
  evaporationRate: number;
  /** Initial/maximum fuel amount (0-1) */
  maxFuel: number;
  /** Multiplier on ignition probability (0-2+) */
  flammability: number;
  /** If true, maintains constant high temperature */
  isHeatSource: boolean;
  /** If true, emits moisture to neighbors */
  isMoistureSource: boolean;
  /** Visual color when not burning (hex) */
  baseColor: number;
  /** Visual color when charred (hex) */
  charredColor: number;
}

/**
 * Default material properties for all material types.
 */
export const MATERIAL_PROPERTIES: Record<MaterialType, MaterialProperties> = {
  [MaterialType.AIR]: {
    name: "Air",
    ignitionTemp: 1.0, // Cannot ignite
    maxBurnMoisture: 0.0,
    burnRate: 0.0,
    heatConductivity: 0.1, // Low - air is an insulator
    moistureCapacity: 0.0,
    evaporationRate: 0.0,
    maxFuel: 0.0,
    flammability: 0.0,
    isHeatSource: false,
    isMoistureSource: false,
    baseColor: 0x000000,
    charredColor: 0x000000,
  },
  [MaterialType.GRASS]: {
    name: "Grass",
    ignitionTemp: 0.15, // Was 0.2 - easier to ignite
    maxBurnMoisture: 0.7, // Was 0.6 - burns even when very wet
    burnRate: 0.4, // Was 0.6 - burn slower
    heatConductivity: 0.95, // Was 0.9 - very high spread
    moistureCapacity: 0.7,
    evaporationRate: 1.0,
    maxFuel: 1.0, // Was 0.8 - maximum fuel
    flammability: 3.0, // Was 2.0 - highly flammable
    isHeatSource: false,
    isMoistureSource: false,
    baseColor: 0x4a7c23,
    charredColor: 0x1a1a1a,
  },
  [MaterialType.DRY_BRUSH]: {
    name: "Dry Brush",
    ignitionTemp: 0.1, // Was 0.15
    maxBurnMoisture: 0.5, // Was 0.4
    burnRate: 0.8, // Was 1.0
    heatConductivity: 0.98, // Was 0.95
    moistureCapacity: 0.3,
    evaporationRate: 2.0,
    maxFuel: 0.8, // Was 0.6
    flammability: 4.0, // Was 3.0
    isHeatSource: false,
    isMoistureSource: false,
    baseColor: 0x8b7355,
    charredColor: 0x0d0d0d,
  },
  [MaterialType.WOOD]: {
    name: "Wood",
    ignitionTemp: 0.35, // Was 0.45 - easier to ignite
    maxBurnMoisture: 0.3,
    burnRate: 0.2, // Was 0.3 - burn very slow (lots of heat)
    heatConductivity: 0.8, // Was 0.6 - conduct heat well
    moistureCapacity: 0.6,
    evaporationRate: 0.5,
    maxFuel: 1.0,
    flammability: 5.0, // Was 1.5 - VERY flammable once ignited
    isHeatSource: false,
    isMoistureSource: false,
    baseColor: 0x8b4513,
    charredColor: 0x1a0a00,
  },
  [MaterialType.LEAVES]: {
    name: "Leaves",
    ignitionTemp: 0.3, // Was 0.4 - easier to ignite
    maxBurnMoisture: 0.3,
    burnRate: 0.4, // Was 0.4 - slow burn
    heatConductivity: 0.7, // Was 0.5 - transfer heat well
    moistureCapacity: 0.9,
    evaporationRate: 1.0,
    maxFuel: 0.9,
    flammability: 6.0, // Was 2.0 - VERY flammable
    isHeatSource: false,
    isMoistureSource: false,
    baseColor: 0x228b22,
    charredColor: 0x0a0a0a,
  },
  [MaterialType.STONE]: {
    name: "Stone",
    ignitionTemp: 1.0, // Cannot ignite
    maxBurnMoisture: 0.0,
    burnRate: 0.0,
    heatConductivity: 0.9, // High - conducts heat well
    moistureCapacity: 0.1,
    evaporationRate: 0.1,
    maxFuel: 0.0,
    flammability: 0.0,
    isHeatSource: false,
    isMoistureSource: false,
    baseColor: 0x808080,
    charredColor: 0x404040,
  },
  [MaterialType.WATER]: {
    name: "Water",
    ignitionTemp: 1.0, // Cannot ignite
    maxBurnMoisture: 0.0,
    burnRate: 0.0,
    heatConductivity: 0.6,
    moistureCapacity: 1.0,
    evaporationRate: 0.0, // Water doesn't evaporate (source)
    maxFuel: 0.0,
    flammability: 0.0,
    isHeatSource: false,
    isMoistureSource: true,
    baseColor: 0x4169e1,
    charredColor: 0x4169e1,
  },
  [MaterialType.LAVA]: {
    name: "Lava",
    ignitionTemp: 1.0, // Already at max temp
    maxBurnMoisture: 0.0,
    burnRate: 0.0,
    heatConductivity: 1.0,
    moistureCapacity: 0.0,
    evaporationRate: 2.0, // Quickly evaporates nearby moisture
    maxFuel: 1.0, // Infinite fuel (heat source)
    flammability: 0.0,
    isHeatSource: true,
    isMoistureSource: false,
    baseColor: 0xff4500,
    charredColor: 0xff4500,
  },
};

// ============================================================================
// Voxel State
// ============================================================================

/**
 * Dynamic state of a single voxel cell.
 * Stored as 4 bytes in the GPU buffer (uint8 each).
 */
export interface VoxelState {
  /** Current heat level (0-255 maps to 0.0-1.0) */
  temperature: number;
  /** Current wetness (0-255 maps to 0.0-1.0) */
  moisture: number;
  /** Remaining burnable material (0-255 maps to 0.0-1.0) */
  fuel: number;
  /** Index into MaterialType enum */
  materialId: MaterialType;
}

/**
 * Derived visual state for rendering purposes.
 * Calculated from VoxelState + MaterialProperties.
 */
export enum VisualState {
  EMPTY = 0, // Air or void
  NORMAL = 1, // Default material appearance
  WET = 2, // High moisture, darker color
  BURNING = 3, // Active fire
  SMOLDERING = 4, // Hot but not fully burning
  STEAMING = 5, // Hot + wet = steam
  CHARRED = 6, // Fuel depleted, blackened
  FROZEN = 7, // Cold + wet = ice
}

// ============================================================================
// Grid Configuration
// ============================================================================

/**
 * Configuration for the voxel grid.
 */
export interface GridConfig {
  /** Grid dimensions in voxels */
  sizeX: number;
  sizeY: number; // Height (vertical)
  sizeZ: number;
  /** World-space size of each voxel in meters */
  voxelSize: number;
  /** Grid origin in world coordinates */
  originX: number;
  originY: number;
  originZ: number;
}

/**
 * Preset grid configurations.
 */
export const GRID_PRESETS = {
  small: { sizeX: 64, sizeY: 32, sizeZ: 64, voxelSize: 1.0 },
  medium: { sizeX: 128, sizeY: 48, sizeZ: 128, voxelSize: 0.75 },
  large: { sizeX: 256, sizeY: 64, sizeZ: 256, voxelSize: 0.5 },
} as const;

export type GridPreset = keyof typeof GRID_PRESETS;

// ============================================================================
// Wind System
// ============================================================================

/**
 * Wind parameters affecting fire propagation.
 */
export interface WindParams {
  /** Base wind direction in degrees (0 = +X, 90 = +Z) */
  direction: number;
  /** Base wind speed (0-1, affects propagation bias strength) */
  speed: number;
  /** Turbulence intensity (0-1, adds noise to direction) */
  turbulence: number;
  /** Gust frequency in Hz (0 = no gusts) */
  gustFrequency: number;
  /** Gust amplitude (multiplier on speed during gusts) */
  gustAmplitude: number;
  /** Local variation scale - how much wind varies spatially (0-1) */
  localVariation: number;
  /** Spatial frequency of wind variation (higher = more frequent changes) */
  variationScale: number;
}

/**
 * Default wind configuration.
 */
export const DEFAULT_WIND: WindParams = {
  direction: 45,
  speed: 0.6, // Was 0.3
  turbulence: 0.4, // Was 0.2
  gustFrequency: 0.2, // Was 0.1
  gustAmplitude: 0.8, // Was 0.5
  localVariation: 0.5, // Was 0.4
  variationScale: 0.08, // Was 0.05
};

// ============================================================================
// Simulation Parameters
// ============================================================================

/**
 * Global simulation parameters.
 */
export interface SimulationParams {
  /** Simulation speed multiplier */
  timeScale: number;
  /** Ambient temperature (0-1, affects cooling rate) */
  ambientTemperature: number;
  /** Ambient humidity (0-1, affects moisture gain) */
  ambientHumidity: number;
  /** Convection strength (upward heat bias multiplier) */
  convectionStrength: number;
  /** Radiant heat range in voxels */
  radiantHeatRange: number;
  /** Whether embers can spawn and spread fire */
  embersEnabled: boolean;
  /** Ember spawn probability per burning cell per second */
  emberSpawnRate: number;
  /** Maximum ember travel distance in voxels */
  emberMaxDistance: number;
}

/**
 * Default simulation parameters.
 */
export const DEFAULT_SIMULATION: SimulationParams = {
  timeScale: 2.0, // Was 1.0 - 2x speed
  ambientTemperature: 0.1,
  ambientHumidity: 0.2,
  convectionStrength: 4.0, // Was 2.5 - stronger heat rise
  radiantHeatRange: 4, // Was 2 - heat reaches further
  embersEnabled: true,
  emberSpawnRate: 0.15, // Was 0.05 - more embers
  emberMaxDistance: 15, // Was 10
};

// ============================================================================
// Interaction Tools
// ============================================================================

/**
 * Available interaction tools for the user.
 */
export enum InteractionTool {
  NONE = "none",
  IGNITE = "ignite", // Start fire at click location
  EXTINGUISH = "extinguish", // Add water/moisture
  PAINT_MATERIAL = "paint", // Paint material type
  HEAT = "heat", // Add heat without igniting
  COOL = "cool", // Remove heat
}

/**
 * Brush configuration for painting tools.
 */
export interface BrushConfig {
  /** Brush radius in voxels */
  radius: number;
  /** Brush strength (0-1) */
  strength: number;
  /** Brush shape */
  shape: "sphere" | "cylinder" | "cube";
  /** Material to paint (for PAINT_MATERIAL tool) */
  paintMaterial: MaterialType;
}

/**
 * Default brush configuration.
 */
export const DEFAULT_BRUSH: BrushConfig = {
  radius: 3,
  strength: 1.0,
  shape: "sphere",
  paintMaterial: MaterialType.GRASS,
};

// ============================================================================
// Scene Presets
// ============================================================================

/**
 * Predefined scene configurations for quick setup.
 */
export interface ScenePreset {
  id: string;
  name: string;
  description: string;
  gridPreset: GridPreset;
  /** Function to initialize the grid with materials */
  initializeMaterials: (
    grid: Uint8Array,
    config: GridConfig
  ) => void;
  /** Initial wind settings */
  wind: WindParams;
  /** Suggested camera position */
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
}

// ============================================================================
// GPU Buffer Types
// ============================================================================

/**
 * Structure of the material properties uniform buffer.
 * Packed for GPU alignment (16-byte aligned structs).
 */
export interface GpuMaterialProps {
  // vec4 aligned
  ignitionTemp: number;
  maxBurnMoisture: number;
  burnRate: number;
  heatConductivity: number;
  // vec4 aligned
  moistureCapacity: number;
  evaporationRate: number;
  maxFuel: number;
  flammability: number;
  // vec4 aligned (flags packed as floats)
  isHeatSource: number; // 0 or 1
  isMoistureSource: number; // 0 or 1
  _padding1: number;
  _padding2: number;
}

/**
 * Structure of the simulation uniforms buffer.
 */
export interface GpuSimulationUniforms {
  // vec4 aligned
  gridSize: [number, number, number, number]; // x, y, z, total
  // vec4 aligned
  voxelSize: number;
  deltaTime: number;
  time: number;
  timeScale: number;
  // vec4 aligned
  windDirection: [number, number]; // normalized x, z
  windSpeed: number;
  turbulence: number;
  // vec4 aligned
  ambientTemp: number;
  ambientHumidity: number;
  convectionStrength: number;
  radiantHeatRange: number;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * Runtime statistics for the simulation.
 */
export interface SimulationStats {
  /** Total number of voxels */
  totalVoxels: number;
  /** Number of currently burning voxels */
  burningVoxels: number;
  /** Number of steaming voxels */
  steamingVoxels: number;
  /** Number of charred voxels */
  charredVoxels: number;
  /** Average temperature across all voxels */
  avgTemperature: number;
  /** Average moisture across all voxels */
  avgMoisture: number;
  /** Simulation step time in ms */
  stepTimeMs: number;
  /** Frames per second */
  fps: number;
}

