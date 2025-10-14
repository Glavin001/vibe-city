import type { RecastConfig } from 'recast-navigation';
import * as THREE from 'three';

// TODO: make configurable
// const navMeshBounds = new THREE.Box3(new THREE.Vector3(-50, -10, -50), new THREE.Vector3(70, 30, 40));
export const navMeshBounds = new THREE.Box3(new THREE.Vector3(-500, -10, -500), new THREE.Vector3(500, 100, 500));
const cellSize = 0.15;
const cellHeight = 0.45;

export const recastConfig: Partial<RecastConfig> = {
  tileSize: 128,
  cs: cellSize,
  ch: cellHeight,
  // walkableRadius: 0.8 / cellSize,
  // walkableClimb: 1.5 / cellHeight,
  walkableRadius: 0.4 / cellSize,
  walkableClimb: 1.5 / cellHeight,
  walkableHeight: 3 / cellHeight,
};

export const navMeshWorkers = navigator.hardwareConcurrency ?? 3;

export const maxAgents = 50;
export const maxAgentRadius = 0.5;
