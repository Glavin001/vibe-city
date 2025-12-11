import type { MutableRefObject } from "react";
import type {
  CoreProfilerSample,
  OptimizationMode,
  SingleCollisionMode,
} from "@/lib/stress/core/types";
import type { StressPresetId } from "@/lib/stress/scenarios/structurePresets";

// Tab identifiers for the control panel
export type TabId = "scene" | "interaction" | "physics" | "damage" | "debug";

// Profiler stats state
export type ProfilerStatsState = {
  sampleCount: number;
  lastFrameMs: number | null;
  lastSample: CoreProfilerSample | null;
};

// Empty profiler stats constant for initialization
export const EMPTY_PROFILER_STATS: ProfilerStatsState = {
  sampleCount: 0,
  lastFrameMs: null,
  lastSample: null,
};

// Profiler controls props
export type ProfilerControlsProps = {
  profilingEnabled: boolean;
  startProfiling: () => void;
  stopProfiling: () => void;
  profilerStats: ProfilerStatsState;
};

// Structure preset metadata type
export type StructurePreset = {
  id: StressPresetId;
  label: string;
  description: string;
};

// Interaction mode type
export type InteractionMode = "projectile" | "cutter" | "push" | "damage";

// Projectile type
export type ProjectileType = "ball" | "box";

// Snapshot mode type
export type SnapshotMode = "perBody" | "world";

// View mode type (orbit vs first-person)
export type ViewMode = "orbit" | "fps";

// Main control panel props - organized by section
export type ControlPanelProps = {
  // Panel visibility
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  showPerfOverlay: boolean;
  setShowPerfOverlay: (v: boolean) => void;

  // Scene controls
  structureId: StressPresetId;
  setStructureId: (v: StressPresetId) => void;
  structures: readonly StructurePreset[];
  structureDescription?: string;
  mode: InteractionMode;
  setMode: (v: InteractionMode) => void;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  reset: () => void;

  // Stats refs
  bodyCountRef: MutableRefObject<HTMLSpanElement | null>;
  activeBodyCountRef: MutableRefObject<HTMLSpanElement | null>;
  colliderCountRef: MutableRefObject<HTMLSpanElement | null>;
  bondsCountRef: MutableRefObject<HTMLSpanElement | null>;

  // Wall dimensions (only for wall presets)
  wallSpan: number;
  setWallSpan: (v: number) => void;
  wallHeight: number;
  setWallHeight: (v: number) => void;
  wallThickness: number;
  setWallThickness: (v: number) => void;
  wallSpanSeg: number;
  setWallSpanSeg: (v: number) => void;
  wallHeightSeg: number;
  setWallHeightSeg: (v: number) => void;
  wallLayers: number;
  setWallLayers: (v: number) => void;

  // Physics - Gravity
  gravity: number;
  setGravity: (v: number) => void;
  solverGravityEnabled: boolean;
  setSolverGravityEnabled: (v: boolean) => void;
  adaptiveDt: boolean;
  setAdaptiveDt: (v: boolean) => void;

  // Physics - Sleep optimization
  sleepMode: OptimizationMode;
  setSleepMode: (v: OptimizationMode) => void;
  sleepLinearThreshold: number;
  setSleepLinearThreshold: (v: number) => void;
  sleepAngularThreshold: number;
  setSleepAngularThreshold: (v: number) => void;

  // Physics - Small body damping
  smallBodyDampingMode: OptimizationMode;
  setSmallBodyDampingMode: (v: OptimizationMode) => void;
  smallBodyColliderThreshold: number;
  setSmallBodyColliderThreshold: (v: number) => void;
  smallBodyMinLinearDamping: number;
  setSmallBodyMinLinearDamping: (v: number) => void;
  smallBodyMinAngularDamping: number;
  setSmallBodyMinAngularDamping: (v: number) => void;

  // Physics - Fracture rollback
  resimulateOnFracture: boolean;
  setResimulateOnFracture: (v: boolean) => void;
  resimulateOnDamageDestroy: boolean;
  setResimulateOnDamageDestroy: (v: boolean) => void;
  maxResimulationPasses: number;
  setMaxResimulationPasses: (v: number) => void;
  snapshotMode: SnapshotMode;
  setSnapshotMode: (v: SnapshotMode) => void;

  // Physics - Collision settings
  singleCollisionMode: SingleCollisionMode;
  setSingleCollisionMode: (v: SingleCollisionMode) => void;
  skipSingleBodies: boolean;
  setSkipSingleBodies: (v: boolean) => void;

  // Projectile settings
  projType: ProjectileType;
  setProjType: (v: ProjectileType) => void;
  projectileRadius: number;
  setProjectileRadius: (v: number) => void;
  projectileSpeed: number;
  setProjectileSpeed: (v: number) => void;
  projectileMass: number;
  setProjectileMass: (v: number) => void;
  pushForce: number;
  setPushForce: (v: number) => void;

  // Damage settings
  damageEnabled: boolean;
  setDamageEnabled: (v: boolean) => void;
  damageClickRatio: number;
  setDamageClickRatio: (v: number) => void;
  contactDamageScale: number;
  setContactDamageScale: (v: number) => void;
  internalContactScale: number;
  setInternalContactScale: (v: number) => void;
  minImpulseThreshold: number;
  setMinImpulseThreshold: (v: number) => void;
  contactCooldownMs: number;
  setContactCooldownMs: (v: number) => void;

  // Damage - Impact speed scaling
  speedMinExternal: number;
  setSpeedMinExternal: (v: number) => void;
  speedMinInternal: number;
  setSpeedMinInternal: (v: number) => void;
  speedMax: number;
  setSpeedMax: (v: number) => void;
  speedExponent: number;
  setSpeedExponent: (v: number) => void;
  slowSpeedFactor: number;
  setSlowSpeedFactor: (v: number) => void;
  fastSpeedFactor: number;
  setFastSpeedFactor: (v: number) => void;

  // Debug - Visualization
  debug: boolean;
  setDebug: (v: boolean) => void;
  physicsWireframe: boolean;
  setPhysicsWireframe: (v: boolean) => void;
  autoBondingEnabled: boolean;
  setAutoBondingEnabled: (v: boolean) => void;

  // Debug - Material / Bonds
  materialScale: number;
  setMaterialScale: (v: number) => void;
  bondsXEnabled: boolean;
  setBondsXEnabled: (v: boolean) => void;
  bondsYEnabled: boolean;
  setBondsYEnabled: (v: boolean) => void;
  bondsZEnabled: boolean;
  setBondsZEnabled: (v: boolean) => void;

  // Profiler
  profilingEnabled: boolean;
  startProfiling: () => void;
  stopProfiling: () => void;
  profilerStats: ProfilerStatsState;
};

// Props for individual tabs - subsets of ControlPanelProps
export type SceneTabProps = Pick<
  ControlPanelProps,
  | "structureId"
  | "setStructureId"
  | "structures"
  | "structureDescription"
  | "wallSpan"
  | "setWallSpan"
  | "wallHeight"
  | "setWallHeight"
  | "wallThickness"
  | "setWallThickness"
  | "wallSpanSeg"
  | "setWallSpanSeg"
  | "wallHeightSeg"
  | "setWallHeightSeg"
  | "wallLayers"
  | "setWallLayers"
  | "materialScale"
  | "setMaterialScale"
  | "bondsXEnabled"
  | "setBondsXEnabled"
  | "bondsYEnabled"
  | "setBondsYEnabled"
  | "bondsZEnabled"
  | "setBondsZEnabled"
>;

export type PhysicsTabProps = Pick<
  ControlPanelProps,
  | "gravity"
  | "setGravity"
  | "solverGravityEnabled"
  | "setSolverGravityEnabled"
  | "adaptiveDt"
  | "setAdaptiveDt"
  | "sleepMode"
  | "setSleepMode"
  | "sleepLinearThreshold"
  | "setSleepLinearThreshold"
  | "sleepAngularThreshold"
  | "setSleepAngularThreshold"
  | "smallBodyDampingMode"
  | "setSmallBodyDampingMode"
  | "smallBodyColliderThreshold"
  | "setSmallBodyColliderThreshold"
  | "smallBodyMinLinearDamping"
  | "setSmallBodyMinLinearDamping"
  | "smallBodyMinAngularDamping"
  | "setSmallBodyMinAngularDamping"
  | "resimulateOnFracture"
  | "setResimulateOnFracture"
  | "resimulateOnDamageDestroy"
  | "setResimulateOnDamageDestroy"
  | "maxResimulationPasses"
  | "setMaxResimulationPasses"
  | "snapshotMode"
  | "setSnapshotMode"
  | "singleCollisionMode"
  | "setSingleCollisionMode"
  | "skipSingleBodies"
  | "setSkipSingleBodies"
  | "damageEnabled"
>;

export type InteractionTabProps = Pick<
  ControlPanelProps,
  | "mode"
  | "setMode"
  | "viewMode"
  | "setViewMode"
  | "projType"
  | "setProjType"
  | "projectileRadius"
  | "setProjectileRadius"
  | "projectileSpeed"
  | "setProjectileSpeed"
  | "projectileMass"
  | "setProjectileMass"
  | "pushForce"
  | "setPushForce"
>;

export type DamageTabProps = Pick<
  ControlPanelProps,
  | "damageEnabled"
  | "setDamageEnabled"
  | "damageClickRatio"
  | "setDamageClickRatio"
  | "contactDamageScale"
  | "setContactDamageScale"
  | "internalContactScale"
  | "setInternalContactScale"
  | "minImpulseThreshold"
  | "setMinImpulseThreshold"
  | "contactCooldownMs"
  | "setContactCooldownMs"
  | "speedMinExternal"
  | "setSpeedMinExternal"
  | "speedMinInternal"
  | "setSpeedMinInternal"
  | "speedMax"
  | "setSpeedMax"
  | "speedExponent"
  | "setSpeedExponent"
  | "slowSpeedFactor"
  | "setSlowSpeedFactor"
  | "fastSpeedFactor"
  | "setFastSpeedFactor"
>;

export type DebugTabProps = Pick<
  ControlPanelProps,
  | "debug"
  | "setDebug"
  | "physicsWireframe"
  | "setPhysicsWireframe"
  | "autoBondingEnabled"
  | "setAutoBondingEnabled"
  | "showPerfOverlay"
  | "setShowPerfOverlay"
  | "profilingEnabled"
  | "startProfiling"
  | "stopProfiling"
  | "profilerStats"
>;
