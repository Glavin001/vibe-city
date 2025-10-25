import type RAPIER from '@dimforge/rapier3d-compat';
import type { ExtStressSolver, StressRuntime } from 'blast-stress-solver';
export type Vec3 = { x: number; y: number; z: number };

export type ScenarioNode = {
  centroid: Vec3;
  mass: number; // 0 => support
  volume: number;
};

export type ScenarioBond = {
  node0: number;
  node1: number;
  centroid: Vec3;
  normal: Vec3;
  area: number;
};

export type ScenarioDesc = {
  nodes: ScenarioNode[];
  bonds: ScenarioBond[];
  gridCoordinates?: Array<{ ix: number; iy: number; iz: number }>;
  spacing?: Vec3;
  parameters?: Record<string, unknown>;
};

export type ChunkData = {
  nodeIndex: number;
  size: Vec3;
  isSupport: boolean;
  baseLocalOffset: Vec3;
  localOffset: Vec3;
  colliderHandle: number | null;
  bodyHandle: number | null;
  active: boolean;
  detached: boolean;
  baseWorldPosition?: Vec3;
};

export type ProjectileSpawn = {
  x: number;
  z: number;
  type: 'ball' | 'box';
  radius: number;
  mass: number;
  linvelY?: number;
  start?: Vec3;
  linvel?: Vec3;
  friction: number;
  restitution: number;
};

export type BondRef = {
  index: number;
  node0: number;
  node1: number;
  area: number;
  centroid: Vec3;
  normal: Vec3;
};

export type DestructibleCore = {
  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  solver: ExtStressSolver;
  runtime: StressRuntime;
  rootBodyHandle: number;
  gravity: number;
  chunks: ChunkData[];
  colliderToNode: Map<number, number>;
  actorMap: Map<number, { bodyHandle: number }>;
  // Internal step control handled by core
  step: () => void;
  projectiles: Array<{ bodyHandle: number; radius: number; type: 'ball'|'box'; mesh?: unknown }>;
  enqueueProjectile: (s: ProjectileSpawn) => void;
  stepEventful: () => void;
  stepSafe: () => void;
  setGravity: (g: number) => void;
  setSolverGravityEnabled: (v: boolean) => void;
  getSolverDebugLines: (options?: {
    mode?: 'min' | 'max';
    sampleStep?: number;
    maxLines?: number;
  }) => Array<{ p0: Vec3; p1: Vec3; color0: number; color1: number }>;
  // Bond interaction helpers
  getNodeBonds: (nodeIndex: number) => BondRef[];
  cutBond: (bondIndex: number) => boolean;
  cutNodeBonds: (nodeIndex: number) => boolean;
  // External force application (non-contact force injection)
  applyExternalForce: (nodeIndex: number, worldPoint: Vec3, worldForce: Vec3) => void;
  dispose: () => void;
};


