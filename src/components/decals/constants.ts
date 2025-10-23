import * as THREE from "three";

// Grid layout for walls
export const WALL_COUNT_X = 20;
export const WALL_COUNT_Z = 10;
export const WALL_SPACING = 2.0;

// Decals
export const MAX_DECALS = 2000;
// Realistic bullet hole size: ~5cm diameter (walls are 1.5m x 1m, so 0.05 units = 5cm)
export const DECAL_SIZE = new THREE.Vector3(0.05, 0.05, 0.01);
export const DECAL_ALPHA_TEST = 0.5;
export const DECAL_POLY_OFFSET = -4;

// BatchedMesh budgets (heuristics)
export const AVG_VERTS_PER_DECAL = 128;
export const AVG_INDICES_PER_DECAL = 256;
export const VERT_BUDGET = MAX_DECALS * AVG_VERTS_PER_DECAL;
export const INDEX_BUDGET = MAX_DECALS * AVG_INDICES_PER_DECAL;
export const OPTIMIZE_EVERY = 50;

// CSG hole defaults (demo)
export const HOLE_RADIUS = 0.03; // ~6cm diameter
export const HOLE_DEPTH = 0.3;   // exceed wall thickness (0.15)

export function getWallTransform(ix: number, iz: number) {
  const position = new THREE.Vector3(
    ix * WALL_SPACING,
    1.0 + Math.sin(ix * 0.35) * 0.5,
    (iz - WALL_COUNT_Z * 0.5) * WALL_SPACING
  );
  const rotation = new THREE.Euler(0, (ix * 0.15) % (Math.PI * 2), 0);
  const scale = new THREE.Vector3(1, 1, 1);
  return { position, rotation, scale };
}


