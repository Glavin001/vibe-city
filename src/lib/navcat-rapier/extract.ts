import Rapier from "@dimforge/rapier3d-compat";
import type { Vec3, Box3 } from "navcat";
import { rotateVectorByQuaternion } from "./utils";

/**
 * Geometry data for Navcat navmesh generation.
 */
export type NavcatGeometry = {
  positions: Float32Array;
  indices: Uint32Array;
};

/**
 * Cylinder obstacle representation for Navcat obstacle marking.
 */
export type CylinderObstacle = {
  center: Vec3;
  radius: number;
  height: number;
};

/**
 * Rapier HeightField data extracted for direct use as Navcat Heightfield.
 * This preserves the heightfield structure instead of tessellating to triangles.
 */
export type RapierHeightfieldData = {
  /** Number of columns (width in cells) */
  ncols: number;
  /** Number of rows (height in cells) */
  nrows: number;
  /** Height values in column-major order: heights[col * nrows + row] */
  heights: Float32Array;
  /** Scale factor for the heightfield (x, y, z dimensions) */
  scale: { x: number; y: number; z: number };
  /** World space translation */
  translation: Vec3;
  /** World space rotation quaternion */
  rotation: { x: number; y: number; z: number; w: number };
  /** World space bounds of the heightfield */
  bounds: Box3;
};

/**
 * Result of extracting data from a Rapier world.
 */
export type RapierExtractionResult = {
  /** Walkable surfaces (ground planes, static horizontal surfaces) from triangle meshes */
  geometry: NavcatGeometry;
  /** Heightfields extracted from Rapier (use these directly as Navcat Heightfields, not triangles) */
  heightfields: RapierHeightfieldData[];
  /** Static obstacles (from fixed rigid bodies) */
  staticObstacles: CylinderObstacle[];
  /** Dynamic obstacles (from dynamic/kinematic rigid bodies) */
  dynamicObstacles: CylinderObstacle[];
};

/**
 * Options for extracting data from Rapier world.
 */
export type ExtractOptions = {
  /** Treat horizontal cuboids (ground planes) as walkable surfaces. Default: true */
  includeHorizontalCuboidsAsWalkable?: boolean;
  /** Minimum dot product with up vector (0,1,0) to consider horizontal. Default: 0.95 */
  horizontalThreshold?: number;
  /** Maximum height for a cuboid to be considered a walkable surface. Default: 0.5 */
  maxWalkableHeight?: number;
};

const DEFAULT_OPTIONS: Required<ExtractOptions> = {
  includeHorizontalCuboidsAsWalkable: true,
  horizontalThreshold: 0.95,
  maxWalkableHeight: 0.5,
};

/**
 * Checks if a quaternion represents a near-horizontal rotation.
 */
function isQuaternionHorizontal(
  quat: { x: number; y: number; z: number; w: number },
  threshold: number,
): boolean {
  const { x: qx, y: qy, z: qz, w: qw } = quat;
  const rotationMagnitude = Math.sqrt(qx * qx + qy * qy + qz * qz);
  return rotationMagnitude < 0.1 || Math.abs(qw) > 0.995;
}

/**
 * Creates a cuboid top face (4 corners) in local space.
 */
function createCuboidTopFace(halfExtents: { x: number; y: number; z: number }): [
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number],
] {
  return [
    [-halfExtents.x, halfExtents.y, -halfExtents.z],
    [halfExtents.x, halfExtents.y, -halfExtents.z],
    [halfExtents.x, halfExtents.y, halfExtents.z],
    [-halfExtents.x, halfExtents.y, halfExtents.z],
  ];
}

/**
 * Adds a walkable plane (rectangle) to the geometry arrays.
 */
function addWalkablePlane(
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  positions: number[],
  indices: number[],
): void {
  const baseIndex = positions.length / 3;

  // Transform corners to world space and add to positions
  for (const corner of corners) {
    const rotated = rotateVectorByQuaternion(corner, rotation);
    positions.push(
      rotated[0] + translation.x,
      rotated[1] + translation.y,
      rotated[2] + translation.z,
    );
  }

  // Create two triangles from the rectangle
  // Use clockwise winding so normals point upward (+Y)
  // Triangle 1: baseIndex -> baseIndex + 2 -> baseIndex + 1
  // Triangle 2: baseIndex -> baseIndex + 3 -> baseIndex + 2 -> baseIndex + 3
  indices.push(baseIndex, baseIndex + 2, baseIndex + 1);
  indices.push(baseIndex, baseIndex + 3, baseIndex + 2);
}

/**
 * Creates cylinder obstacle from dimensions.
 */
function createCylinderObstacle(
  center: Vec3,
  radius: number,
  height: number,
): CylinderObstacle {
  return { center, radius, height };
}

/**
 * Processes a cuboid shape - either as walkable surface or obstacle.
 */
function processCuboid(
  shape: Rapier.Cuboid,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  bodyType: Rapier.RigidBodyType,
  options: Required<ExtractOptions>,
  positions: number[],
  indices: number[],
): { obstacle: CylinderObstacle | null; isWalkable: boolean } {
  const halfExtents = shape.halfExtents;
  const rotationQuat = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
  const isHorizontal = isQuaternionHorizontal(rotationQuat, options.horizontalThreshold);
  const isThin = halfExtents.y * 2 <= options.maxWalkableHeight;

  if (
    options.includeHorizontalCuboidsAsWalkable &&
    isHorizontal &&
    isThin &&
    bodyType === Rapier.RigidBodyType.Fixed
  ) {
    // Extract as walkable surface
    const corners = createCuboidTopFace(halfExtents);
    addWalkablePlane(corners, rotation, translation, positions, indices);
    return { obstacle: null, isWalkable: true };
  }

  // Treat as obstacle
  const radius = Math.max(halfExtents.x, halfExtents.z);
  const height = halfExtents.y * 2;
  const obstacle = createCylinderObstacle(
    [translation.x, translation.y - halfExtents.y, translation.z],
    radius,
    height,
  );
  return { obstacle, isWalkable: false };
}

/**
 * Processes a ball shape as an obstacle.
 */
function processBall(
  shape: Rapier.Ball,
  translation: { x: number; y: number; z: number },
): CylinderObstacle {
  const radius = shape.radius;
  return createCylinderObstacle(
    [translation.x, translation.y - radius, translation.z],
    radius,
    radius * 2,
  );
}

/**
 * Processes a cylinder shape as an obstacle.
 */
function processCylinder(
  shape: Rapier.Cylinder,
  translation: { x: number; y: number; z: number },
): CylinderObstacle {
  const radius = shape.radius;
  const halfHeight = shape.halfHeight;
  return createCylinderObstacle(
    [translation.x, translation.y - halfHeight, translation.z],
    radius,
    halfHeight * 2,
  );
}

/**
 * Processes a capsule shape as an obstacle.
 */
function processCapsule(
  shape: Rapier.Capsule,
  translation: { x: number; y: number; z: number },
): CylinderObstacle {
  const radius = shape.radius;
  const halfHeight = shape.halfHeight;
  return createCylinderObstacle(
    [translation.x, translation.y - (halfHeight + radius), translation.z],
    radius,
    (halfHeight + radius) * 2,
  );
}

/**
 * Extracts Rapier heightfield data for conversion to Navcat Heightfield.
 * Returns the heightfield data structure instead of tessellating to triangles.
 */
function extractHeightfieldData(
  shape: Rapier.Heightfield,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  rapier: typeof Rapier,
): RapierHeightfieldData {
  const { heights, ncols, nrows, scale } = shape;

  // Calculate world space bounds
  // Rapier heightfield spans from (0,0,0) to (ncols*scale.x, max_height, nrows*scale.z) in local space
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    minY = Math.min(minY, h);
    maxY = Math.max(maxY, h);
  }

  // Transform bounds to world space
  // For simplicity, calculate axis-aligned bounding box from corners
  const corners: [number, number, number][] = [
    [0, minY, 0],
    [ncols * scale.x, minY, 0],
    [ncols * scale.x, maxY, nrows * scale.z],
    [0, maxY, nrows * scale.z],
  ];

  const worldCorners = corners.map((corner) => {
    const rotated = rotateVectorByQuaternion(corner, { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    return [
      rotated[0] + translation.x,
      rotated[1] + translation.y,
      rotated[2] + translation.z,
    ] as Vec3;
  });

  // Calculate AABB from transformed corners
  const minX = Math.min(...worldCorners.map((c) => c[0]));
  const maxX = Math.max(...worldCorners.map((c) => c[0]));
  const minY_world = Math.min(...worldCorners.map((c) => c[1]));
  const maxY_world = Math.max(...worldCorners.map((c) => c[1]));
  const minZ = Math.min(...worldCorners.map((c) => c[2]));
  const maxZ = Math.max(...worldCorners.map((c) => c[2]));

  const bounds: Box3 = [
    [minX, minY_world, minZ],
    [maxX, maxY_world, maxZ],
  ];

  return {
    ncols,
    nrows,
    heights: new Float32Array(heights), // Copy the array
    scale: { x: scale.x, y: scale.y, z: scale.z },
    translation: [translation.x, translation.y, translation.z],
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
    bounds,
  };
}

/**
 * Attempts to get AABB for complex shapes using workaround.
 */
function getAABBForComplexShape(
  collider: Rapier.Collider,
): { center: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } } | null {
  const anyCollider = collider as unknown as {
    computeAABB?: () => {
      center(): { x: number; y: number; z: number };
      halfExtents(): { x: number; y: number; z: number };
    };
    computeParentAABB?: () => {
      center(): { x: number; y: number; z: number };
      halfExtents(): { x: number; y: number; z: number };
    };
  };
  const aabb = anyCollider.computeAABB?.() ?? anyCollider.computeParentAABB?.();
  if (!aabb) return null;
  return {
    center: aabb.center(),
    halfExtents: aabb.halfExtents(),
  };
}

/**
 * Processes a TriMesh shape using AABB approximation.
 */
function processTriMesh(
  collider: Rapier.Collider,
): CylinderObstacle | null {
  const aabb = getAABBForComplexShape(collider);
  if (!aabb) return null;

  const { center, halfExtents } = aabb;
  const radius = Math.max(halfExtents.x, halfExtents.z);
  return createCylinderObstacle(
    [center.x, center.y - halfExtents.y, center.z],
    radius,
    halfExtents.y * 2,
  );
}

/**
 * Processes an unknown shape type using AABB approximation.
 */
function processUnknownShape(collider: Rapier.Collider): CylinderObstacle | null {
  return processTriMesh(collider);
}

/**
 * Processes a single collider shape and updates extraction results.
 */
function processColliderShape(
  shape: Rapier.Shape,
  collider: Rapier.Collider,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  bodyType: Rapier.RigidBodyType,
  rapier: typeof Rapier,
  options: Required<ExtractOptions>,
  positions: number[],
  indices: number[],
): { obstacle: CylinderObstacle | null; isWalkable: boolean; heightfield: RapierHeightfieldData | null } {
  switch (shape.type) {
    case rapier.ShapeType.Cuboid: {
      const result = processCuboid(
        shape as Rapier.Cuboid,
        rotation,
        translation,
        bodyType,
        options,
        positions,
        indices,
      );
      return { ...result, heightfield: null };
    }

    case rapier.ShapeType.Ball: {
      return {
        obstacle: processBall(shape as Rapier.Ball, translation),
        isWalkable: false,
        heightfield: null,
      };
    }

    case rapier.ShapeType.Cylinder: {
      return {
        obstacle: processCylinder(shape as Rapier.Cylinder, translation),
        isWalkable: false,
        heightfield: null,
      };
    }

    case rapier.ShapeType.Capsule: {
      return {
        obstacle: processCapsule(shape as Rapier.Capsule, translation),
        isWalkable: false,
        heightfield: null,
      };
    }

    case rapier.ShapeType.HeightField: {
      // Extract as heightfield data instead of tessellating
      const heightfieldData = extractHeightfieldData(
        shape as Rapier.Heightfield,
        rotation,
        translation,
        rapier,
      );
      return { obstacle: null, isWalkable: true, heightfield: heightfieldData };
    }

    case rapier.ShapeType.TriMesh: {
      return {
        obstacle: processTriMesh(collider),
        isWalkable: false,
        heightfield: null,
      };
    }

    default: {
      return {
        obstacle: processUnknownShape(collider),
        isWalkable: false,
        heightfield: null,
      };
    }
  }
}

/**
 * Extracts collider data from a Rapier World and converts it to Navcat-compatible format.
 * Works with any Rapier.js instance (not limited to React Three Fiber).
 *
 * **HeightFields**: Rapier HeightField shapes are extracted as structured data
 * (RapierHeightfieldData) rather than tessellated triangles. This preserves the
 * heightfield structure for direct use with Navcat's Heightfield format.
 * See Navcat examples for how to use heightfields in navmesh generation.
 *
 * @param world - The Rapier World instance
 * @param rapier - The Rapier API instance (from Rapier.init())
 * @param options - Extraction options
 * @returns Extracted geometry, heightfields, and obstacles, or null if no walkable surfaces found
 */
export function extractRapierToNavcat(
  world: Rapier.World,
  rapier: typeof Rapier,
  options: ExtractOptions = {},
): RapierExtractionResult | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const positions: number[] = [];
  const indices: number[] = [];
  const staticObstacles: CylinderObstacle[] = [];
  const dynamicObstacles: CylinderObstacle[] = [];
  const heightfields: RapierHeightfieldData[] = [];

  world.forEachCollider((collider) => {
    const parent = collider.parent();
    if (!parent) return;

    const bodyType = parent.bodyType();
    const translation = collider.translation();
    const rotation = collider.rotation();
    const shape = collider.shape;

    const result = processColliderShape(
      shape,
      collider,
      rotation,
      translation,
      bodyType,
      rapier,
      opts,
      positions,
      indices,
    );

    // Collect heightfield if present
    if (result.heightfield) {
      heightfields.push(result.heightfield);
    }

    // Categorize obstacle by body type
    if (result.obstacle && !result.isWalkable) {
      if (bodyType === rapier.RigidBodyType.Fixed) {
        staticObstacles.push(result.obstacle);
      } else {
        dynamicObstacles.push(result.obstacle);
      }
    }
  });

  // Return null only if we have nothing useful (no geometry, no heightfields, and no obstacles)
  // Note: Even if we only have obstacles, we should return a result (with empty geometry)
  const hasGeometry = positions.length > 0 && indices.length > 0;
  const hasHeightfields = heightfields.length > 0;
  const hasObstacles = staticObstacles.length > 0 || dynamicObstacles.length > 0;
  
  if (!hasGeometry && !hasHeightfields && !hasObstacles) {
    return null;
  }

  return {
    geometry: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
    },
    heightfields,
    staticObstacles,
    dynamicObstacles,
  };
}
