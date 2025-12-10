/**
 * SDF Baking Utilities using three-mesh-bvh
 *
 * Bakes a signed distance field from Three.js meshes for use in
 * WebGPU-based rigid body physics collision detection.
 */

import * as THREE from "three";
import { MeshBVH, StaticGeometryGenerator } from "three-mesh-bvh";

export interface BakedSDF {
  /** Resolution of the SDF grid (dim x dim x dim) */
  dim: number;
  /** SDF data as Float32Array (dim^3 samples) */
  data: Float32Array;
  /** Matrix to transform world-space points to [0,1]^3 texture coordinates */
  worldToSdf: THREE.Matrix4;
  /** Inverse matrix: SDF coords back to world space */
  sdfToWorld: THREE.Matrix4;
  /** Bounding box in world space */
  bounds: THREE.Box3;
}

export interface BakeOptions {
  /** Resolution of the SDF grid (default: 64) */
  resolution?: number;
  /** Margin around the bounding box in world units (default: 0.5) */
  margin?: number;
  /** Progress callback (0-1) */
  onProgress?: (progress: number) => void;
}

/**
 * Generate an SDF from a single BufferGeometry with BVH
 */
export function bakeGeometryToSdf(
  geometry: THREE.BufferGeometry,
  options: BakeOptions = {}
): BakedSDF {
  const { resolution = 64, margin = 0.5, onProgress } = options;

  // Ensure geometry has bounding box
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!.clone();

  // Build BVH for distance queries
  const bvh = new MeshBVH(geometry, { maxLeafTris: 1 });

  // Expand bounds by margin
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  bbox.getCenter(center);
  bbox.getSize(size);
  size.addScalar(2 * margin);

  // Create transform matrices
  const boundsMatrix = new THREE.Matrix4().compose(
    center,
    new THREE.Quaternion(),
    size
  );
  const worldToSdf = boundsMatrix.clone().invert();
  const sdfToWorld = boundsMatrix.clone();

  // Allocate grid
  const dim = resolution;
  const data = new Float32Array(dim * dim * dim);
  const pxWidth = 1 / dim;
  const halfWidth = 0.5 * pxWidth;

  // Temporary vectors
  const point = new THREE.Vector3();
  const ray = new THREE.Ray();
  const target: { point: THREE.Vector3; distance: number } = {
    point: new THREE.Vector3(),
    distance: 0,
  };

  // Fill SDF grid
  const totalVoxels = dim * dim * dim;
  let processedVoxels = 0;

  for (let z = 0; z < dim; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        // Normalized coordinates in [-0.5, 0.5]
        const nx = halfWidth + x * pxWidth - 0.5;
        const ny = halfWidth + y * pxWidth - 0.5;
        const nz = halfWidth + z * pxWidth - 0.5;

        // Transform to world space
        point.set(nx, ny, nz).applyMatrix4(boundsMatrix);

        // Get distance to closest point on mesh
        const res = bvh.closestPointToPoint(point, target);
        const dist = res ? res.distance : Number.MAX_VALUE;

        // Determine inside/outside using raycast
        ray.origin.copy(point);
        ray.direction.set(0, 0, 1);
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide);

        // If ray hits a backface, we're inside
        const isInside = hit && hit.face && hit.face.normal.dot(ray.direction) > 0;

        // Store signed distance
        const index = x + y * dim + z * dim * dim;
        data[index] = isInside ? -dist : dist;

        processedVoxels++;
        if (onProgress && processedVoxels % 1000 === 0) {
          onProgress(processedVoxels / totalVoxels);
        }
      }
    }
  }

  if (onProgress) {
    onProgress(1);
  }

  return {
    dim,
    data,
    worldToSdf,
    sdfToWorld,
    bounds: bbox,
  };
}

/**
 * Bake an SDF from a Three.js scene (merges all mesh geometries)
 */
export function bakeSceneToSdf(
  scene: THREE.Object3D,
  options: BakeOptions = {}
): BakedSDF {
  // Update world matrices
  scene.updateMatrixWorld(true);

  // Use StaticGeometryGenerator to merge all meshes
  const staticGen = new StaticGeometryGenerator(scene);
  staticGen.attributes = ["position", "normal"];
  staticGen.useGroups = false;

  const mergedGeometry = staticGen.generate();

  // Center the geometry
  mergedGeometry.center();

  return bakeGeometryToSdf(mergedGeometry, options);
}

/**
 * Bake an SDF from a simple ground plane
 */
export function bakeGroundPlaneSdf(options: {
  size?: number;
  resolution?: number;
  height?: number;
}): BakedSDF {
  const { size = 50, resolution = 64, height = 0 } = options;

  const dim = resolution;
  const data = new Float32Array(dim * dim * dim);

  // Create bounds
  const bounds = new THREE.Box3(
    new THREE.Vector3(-size / 2, -size / 2, -size / 2),
    new THREE.Vector3(size / 2, size / 2, size / 2)
  );

  const center = new THREE.Vector3(0, 0, 0);
  const boxSize = new THREE.Vector3(size, size, size);

  const boundsMatrix = new THREE.Matrix4().compose(
    center,
    new THREE.Quaternion(),
    boxSize
  );
  const worldToSdf = boundsMatrix.clone().invert();
  const sdfToWorld = boundsMatrix.clone();

  const pxWidth = 1 / dim;
  const halfWidth = 0.5 * pxWidth;

  for (let z = 0; z < dim; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        // Normalized coordinates
        const ny = halfWidth + y * pxWidth - 0.5;
        // World Y coordinate
        const worldY = ny * size;
        // Distance to ground plane at height
        const dist = worldY - height;

        const index = x + y * dim + z * dim * dim;
        data[index] = dist;
      }
    }
  }

  return {
    dim,
    data,
    worldToSdf,
    sdfToWorld,
    bounds,
  };
}

/**
 * Analytic SDF functions for primitives
 */
function sdfSphere(px: number, py: number, pz: number, cx: number, cy: number, cz: number, radius: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

function sdfBox(px: number, py: number, pz: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): number {
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const dz = Math.abs(pz - cz) - hz;
  const outside = Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 + Math.max(dz, 0) ** 2);
  const inside = Math.min(Math.max(dx, Math.max(dy, dz)), 0);
  return outside + inside;
}

function sdfCylinder(px: number, py: number, pz: number, cx: number, cy: number, cz: number, radius: number, halfHeight: number): number {
  const dx = px - cx;
  const dz = pz - cz;
  const distXZ = Math.sqrt(dx * dx + dz * dz) - radius;
  const distY = Math.abs(py - cy) - halfHeight;
  const outside = Math.sqrt(Math.max(distXZ, 0) ** 2 + Math.max(distY, 0) ** 2);
  const inside = Math.min(Math.max(distXZ, distY), 0);
  return outside + inside;
}

export interface TerrainObstacle {
  type: "box" | "sphere" | "cylinder";
  position: [number, number, number];
  size: [number, number, number]; // For box: halfExtents, sphere: [radius,0,0], cylinder: [radius, halfHeight, 0]
}

export interface TerrainOptions {
  size?: number;
  resolution?: number;
  /** Amplitude of terrain waves (default: 2) */
  terrainAmplitude?: number;
  /** Frequency of terrain waves (default: 0.1) */
  terrainFrequency?: number;
  /** Additional obstacles to add */
  obstacles?: TerrainObstacle[];
}

/**
 * Bake an SDF with heightfield terrain and static obstacles
 */
export function bakeTerrainWithObstaclesSdf(options: TerrainOptions = {}): BakedSDF {
  const {
    size = 100,
    resolution = 64,
    terrainAmplitude = 2,
    terrainFrequency = 0.1,
    obstacles = [],
  } = options;

  const dim = resolution;
  const data = new Float32Array(dim * dim * dim);

  // Create bounds - center at y=size/4 to have more room above ground
  const bounds = new THREE.Box3(
    new THREE.Vector3(-size / 2, -size / 4, -size / 2),
    new THREE.Vector3(size / 2, (3 * size) / 4, size / 2)
  );

  const center = new THREE.Vector3(0, size / 4, 0);
  const boxSize = new THREE.Vector3(size, size, size);

  const boundsMatrix = new THREE.Matrix4().compose(
    center,
    new THREE.Quaternion(),
    boxSize
  );
  const worldToSdf = boundsMatrix.clone().invert();
  const sdfToWorld = boundsMatrix.clone();

  const pxWidth = 1 / dim;
  const halfWidth = 0.5 * pxWidth;

  for (let z = 0; z < dim; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        // Normalized coordinates
        const nx = halfWidth + x * pxWidth - 0.5;
        const ny = halfWidth + y * pxWidth - 0.5;
        const nz = halfWidth + z * pxWidth - 0.5;

        // World coordinates
        const worldX = nx * size;
        const worldY = ny * size + size / 4; // Offset to match center
        const worldZ = nz * size;

        // Heightfield terrain using multiple sine waves
        const terrainHeight =
          Math.sin(worldX * terrainFrequency) * Math.cos(worldZ * terrainFrequency) * terrainAmplitude +
          Math.sin(worldX * terrainFrequency * 2.3 + 1.5) * Math.sin(worldZ * terrainFrequency * 1.7) * (terrainAmplitude * 0.5) +
          Math.sin(worldX * terrainFrequency * 0.5) * Math.cos(worldZ * terrainFrequency * 0.7 + 2.0) * (terrainAmplitude * 0.3);

        // Distance to terrain (approximation of heightfield SDF)
        let dist = worldY - terrainHeight;

        // Union with obstacles (take minimum)
        for (const obs of obstacles) {
          let obsDist: number;
          const [ox, oy, oz] = obs.position;
          const [sx, sy, sz] = obs.size;

          switch (obs.type) {
            case "sphere":
              obsDist = sdfSphere(worldX, worldY, worldZ, ox, oy, oz, sx);
              break;
            case "box":
              obsDist = sdfBox(worldX, worldY, worldZ, ox, oy, oz, sx, sy, sz);
              break;
            case "cylinder":
              obsDist = sdfCylinder(worldX, worldY, worldZ, ox, oy, oz, sx, sy);
              break;
            default:
              obsDist = Number.MAX_VALUE;
          }

          dist = Math.min(dist, obsDist);
        }

        const index = x + y * dim + z * dim * dim;
        data[index] = dist;
      }
    }
  }

  return {
    dim,
    data,
    worldToSdf,
    sdfToWorld,
    bounds,
  };
}

/**
 * Generate random obstacles for a terrain
 */
export function generateRandomObstacles(options: {
  count?: number;
  spread?: number;
  minSize?: number;
  maxSize?: number;
  terrainAmplitude?: number;
  terrainFrequency?: number;
  seed?: number;
}): TerrainObstacle[] {
  const {
    count = 20,
    spread = 30,
    minSize = 1,
    maxSize = 4,
    terrainAmplitude = 2,
    terrainFrequency = 0.1,
  } = options;

  // Simple seeded random
  let seed = options.seed ?? 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const obstacles: TerrainObstacle[] = [];

  for (let i = 0; i < count; i++) {
    const x = (random() - 0.5) * spread * 2;
    const z = (random() - 0.5) * spread * 2;

    // Calculate terrain height at this position
    const terrainY =
      Math.sin(x * terrainFrequency) * Math.cos(z * terrainFrequency) * terrainAmplitude +
      Math.sin(x * terrainFrequency * 2.3 + 1.5) * Math.sin(z * terrainFrequency * 1.7) * (terrainAmplitude * 0.5) +
      Math.sin(x * terrainFrequency * 0.5) * Math.cos(z * terrainFrequency * 0.7 + 2.0) * (terrainAmplitude * 0.3);

    const size = minSize + random() * (maxSize - minSize);
    const typeRand = random();

    if (typeRand < 0.5) {
      // Box
      const hx = size * (0.5 + random() * 0.5);
      const hy = size * (0.5 + random() * 1.5);
      const hz = size * (0.5 + random() * 0.5);
      obstacles.push({
        type: "box",
        position: [x, terrainY + hy, z],
        size: [hx, hy, hz],
      });
    } else if (typeRand < 0.8) {
      // Sphere
      obstacles.push({
        type: "sphere",
        position: [x, terrainY + size, z],
        size: [size, 0, 0],
      });
    } else {
      // Cylinder (pillar)
      const radius = size * 0.5;
      const halfHeight = size * (1 + random() * 2);
      obstacles.push({
        type: "cylinder",
        position: [x, terrainY + halfHeight, z],
        size: [radius, halfHeight, 0],
      });
    }
  }

  return obstacles;
}

/**
 * Combine multiple BakedSDFs using min operation (union)
 */
export function combineSDFs(
  sdfs: BakedSDF[],
  resolution: number = 64,
  bounds?: THREE.Box3
): BakedSDF {
  if (sdfs.length === 0) {
    throw new Error("Must provide at least one SDF to combine");
  }

  // Compute combined bounds
  const combinedBounds = bounds ?? new THREE.Box3();
  if (!bounds) {
    for (const sdf of sdfs) {
      combinedBounds.union(sdf.bounds);
    }
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  combinedBounds.getCenter(center);
  combinedBounds.getSize(size);

  const boundsMatrix = new THREE.Matrix4().compose(
    center,
    new THREE.Quaternion(),
    size
  );
  const worldToSdf = boundsMatrix.clone().invert();
  const sdfToWorld = boundsMatrix.clone();

  const dim = resolution;
  const data = new Float32Array(dim * dim * dim);
  const pxWidth = 1 / dim;
  const halfWidth = 0.5 * pxWidth;
  const point = new THREE.Vector3();

  for (let z = 0; z < dim; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const nx = halfWidth + x * pxWidth - 0.5;
        const ny = halfWidth + y * pxWidth - 0.5;
        const nz = halfWidth + z * pxWidth - 0.5;

        point.set(nx, ny, nz).applyMatrix4(boundsMatrix);

        // Sample all SDFs and take minimum
        let minDist = Number.MAX_VALUE;
        for (const sdf of sdfs) {
          const dist = sampleSdf(sdf, point);
          minDist = Math.min(minDist, dist);
        }

        const index = x + y * dim + z * dim * dim;
        data[index] = minDist;
      }
    }
  }

  return {
    dim,
    data,
    worldToSdf,
    sdfToWorld,
    bounds: combinedBounds,
  };
}

/**
 * Sample an SDF at a world-space point using trilinear interpolation
 */
export function sampleSdf(sdf: BakedSDF, worldPoint: THREE.Vector3): number {
  const localPoint = worldPoint.clone().applyMatrix4(sdf.worldToSdf);

  // Convert to [0,1] range
  const u = localPoint.x + 0.5;
  const v = localPoint.y + 0.5;
  const w = localPoint.z + 0.5;

  // If outside bounds, return large positive distance
  if (u < 0 || u > 1 || v < 0 || v > 1 || w < 0 || w > 1) {
    return Number.MAX_VALUE;
  }

  const dim = sdf.dim;
  const fx = u * dim - 0.5;
  const fy = v * dim - 0.5;
  const fz = w * dim - 0.5;

  const x0 = Math.max(0, Math.floor(fx));
  const y0 = Math.max(0, Math.floor(fy));
  const z0 = Math.max(0, Math.floor(fz));
  const x1 = Math.min(dim - 1, x0 + 1);
  const y1 = Math.min(dim - 1, y0 + 1);
  const z1 = Math.min(dim - 1, z0 + 1);

  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;

  // Trilinear interpolation
  const c000 = sdf.data[x0 + y0 * dim + z0 * dim * dim];
  const c100 = sdf.data[x1 + y0 * dim + z0 * dim * dim];
  const c010 = sdf.data[x0 + y1 * dim + z0 * dim * dim];
  const c110 = sdf.data[x1 + y1 * dim + z0 * dim * dim];
  const c001 = sdf.data[x0 + y0 * dim + z1 * dim * dim];
  const c101 = sdf.data[x1 + y0 * dim + z1 * dim * dim];
  const c011 = sdf.data[x0 + y1 * dim + z1 * dim * dim];
  const c111 = sdf.data[x1 + y1 * dim + z1 * dim * dim];

  const c00 = c000 * (1 - tx) + c100 * tx;
  const c10 = c010 * (1 - tx) + c110 * tx;
  const c01 = c001 * (1 - tx) + c101 * tx;
  const c11 = c011 * (1 - tx) + c111 * tx;

  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;

  return c0 * (1 - tz) + c1 * tz;
}




