import type { Vec3, Box3 } from "navcat";
import { rotateVectorByQuaternion } from "./utils";
// Rapier is used as both type and value
import type RapierType from "@dimforge/rapier3d-compat";

/**
 * Geometry data for Navcat navmesh generation.
 */
export type NavcatGeometry = {
  positions: Float32Array;
  indices: Uint32Array;
};

/**
 * Options for shape triangulation quality.
 */
export type TriangulationOptions = {
  /** Number of segments for cylinder side (default: 24) */
  cylinderSegments?: number;
  /** Number of segments for sphere/capsule (default: 20) */
  sphereSegments?: number;
  /** Number of segments for capsule height (default: 16) */
  capsuleSegments?: number;
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
export type ColliderBodyKind = "fixed" | "kinematic" | "dynamic";

export type DynamicNavMeshObstacle = {
  handle: number;
  bodyType: ColliderBodyKind;
  /**
   * Center of the obstacle in world space. For cylinders this is the center of the capsule.
   */
  center: Vec3;
  /**
   * Half extents of the obstacle's axis-aligned bounding box. Used for computing radius/height.
   */
  halfExtents: Vec3;
  /**
   * Radius used when projecting a cylinder onto the navmesh.
   */
  radius: number;
  /**
   * Height of the obstacle (full height, not half height).
   */
  height: number;
};

export type RapierExtractionResult = {
  /** Static collider geometry triangulated to triangles */
  geometry: NavcatGeometry;
  /** Heightfields extracted from Rapier (use these directly as Navcat Heightfields, not triangles) */
  heightfields: RapierHeightfieldData[];
  /** Dynamic colliders represented as cylindrical obstacles */
  dynamicObstacles: DynamicNavMeshObstacle[];
  /** Handles of all static colliders used for cache invalidation */
  staticColliderHandles: number[];
  /** Stable signature describing the static collider set */
  staticSignature: string;
  /** Indicates whether cached static geometry/heightfields were reused */
  usedStaticCache: boolean;
};

export type RapierExtractionCache = {
  staticSignature?: string;
  geometry?: NavcatGeometry;
  heightfields?: RapierHeightfieldData[];
};

/**
 * Options for extracting data from Rapier world.
 */
export type ExtractOptions = {
  /** Include dynamic rigid bodies (default: true) */
  includeDynamic?: boolean;
  /** Include kinematic rigid bodies (default: true) */
  includeKinematic?: boolean;
  /** Triangulation quality options */
  triangulation?: TriangulationOptions;
  /** Cache object for reusing static extraction data */
  cache?: RapierExtractionCache;
};

const DEFAULT_OPTIONS: Required<Omit<ExtractOptions, "cache">> = {
  includeDynamic: true,
  includeKinematic: true,
  triangulation: {
    cylinderSegments: 24,
    sphereSegments: 20,
    capsuleSegments: 16,
  },
};

/**
 * Transforms a local-space vertex to world space and adds it to positions array.
 */
function addWorldVertex(
  localPos: [number, number, number],
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  positions: number[],
): number {
  const rotated = rotateVectorByQuaternion(localPos, rotation);
  const baseIndex = positions.length / 3;
  positions.push(
    rotated[0] + translation.x,
    rotated[1] + translation.y,
    rotated[2] + translation.z,
  );
  return baseIndex;
}

/**
 * Adds a triangle (by vertex indices) to the indices array.
 */
function addTriangle(indices: number[], v0: number, v1: number, v2: number): void {
  indices.push(v0, v1, v2);
}

/**
 * Triangulates a cuboid (box) into 12 triangles (6 faces × 2 triangles each).
 */
function triangulateCuboid(
  shape: RapierType.Cuboid,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  positions: number[],
  indices: number[],
): void {
  const { x: hx, y: hy, z: hz } = shape.halfExtents;

  // Define 8 vertices in local space
  const vertices: [number, number, number][] = [
    [-hx, -hy, -hz], // 0: bottom-left-back
    [hx, -hy, -hz],  // 1: bottom-right-back
    [hx, hy, -hz],   // 2: top-right-back
    [-hx, hy, -hz],  // 3: top-left-back
    [-hx, -hy, hz],  // 4: bottom-left-front
    [hx, -hy, hz],   // 5: bottom-right-front
    [hx, hy, hz],    // 6: top-right-front
    [-hx, hy, hz],   // 7: top-left-front
  ];

  // Transform and add vertices to positions
  const vertexIndices: number[] = [];
  for (const vertex of vertices) {
    vertexIndices.push(addWorldVertex(vertex, rotation, translation, positions));
  }

  // Define 6 faces, each as 2 triangles (12 total triangles)
  // Face order: front, back, left, right, top, bottom
  const faces = [
    // Front face (4-5-6-7)
    [vertexIndices[4], vertexIndices[5], vertexIndices[6]],
    [vertexIndices[4], vertexIndices[6], vertexIndices[7]],
    // Back face (0-3-2-1)
    [vertexIndices[0], vertexIndices[3], vertexIndices[2]],
    [vertexIndices[0], vertexIndices[2], vertexIndices[1]],
    // Left face (0-4-7-3)
    [vertexIndices[0], vertexIndices[4], vertexIndices[7]],
    [vertexIndices[0], vertexIndices[7], vertexIndices[3]],
    // Right face (1-2-6-5)
    [vertexIndices[1], vertexIndices[2], vertexIndices[6]],
    [vertexIndices[1], vertexIndices[6], vertexIndices[5]],
    // Top face (3-7-6-2) - this is walkable!
    [vertexIndices[3], vertexIndices[7], vertexIndices[6]],
    [vertexIndices[3], vertexIndices[6], vertexIndices[2]],
    // Bottom face (0-1-5-4)
    [vertexIndices[0], vertexIndices[1], vertexIndices[5]],
    [vertexIndices[0], vertexIndices[5], vertexIndices[4]],
  ];

  // Add all triangles
  for (const face of faces) {
    addTriangle(indices, face[0], face[1], face[2]);
  }
}

/**
 * Triangulates a sphere into triangles using latitude/longitude segments.
 */
function triangulateSphere(
  shape: RapierType.Ball,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  segments: number,
  positions: number[],
  indices: number[],
): void {
  const radius = shape.radius;
  const vertexIndices: number[] = [];

  // Generate vertices using spherical coordinates
  for (let lat = 0; lat <= segments; lat++) {
    const theta = (lat * Math.PI) / segments; // 0 to π
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= segments; lon++) {
      const phi = (lon * 2 * Math.PI) / segments; // 0 to 2π
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = radius * sinTheta * cosPhi;
      const y = radius * cosTheta;
      const z = radius * sinTheta * sinPhi;

      vertexIndices.push(
        addWorldVertex([x, y, z], rotation, translation, positions),
      );
    }
  }

  // Generate triangles (quads split into 2 triangles)
  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const current = lat * (segments + 1) + lon;
      const next = current + segments + 1;

      const i0 = vertexIndices[current];
      const i1 = vertexIndices[next];
      const i2 = vertexIndices[current + 1];
      const i3 = vertexIndices[next + 1];

      // Two triangles per quad
      addTriangle(indices, i0, i1, i2);
      addTriangle(indices, i2, i1, i3);
    }
  }
}

/**
 * Triangulates a cylinder into triangles.
 */
function triangulateCylinder(
  shape: RapierType.Cylinder,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  segments: number,
  positions: number[],
  indices: number[],
): void {
  const radius = shape.radius;
  const halfHeight = shape.halfHeight;

  // Generate vertices for top and bottom circles, and side
  const topVertices: number[] = [];
  const bottomVertices: number[] = [];

  // Top and bottom circle vertices
  for (let i = 0; i <= segments; i++) {
    const angle = (i * 2 * Math.PI) / segments;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);

    const topX = radius * cosAngle;
    const topY = halfHeight;
    const topZ = radius * sinAngle;
    topVertices.push(
      addWorldVertex([topX, topY, topZ], rotation, translation, positions),
    );

    const bottomX = radius * cosAngle;
    const bottomY = -halfHeight;
    const bottomZ = radius * sinAngle;
    bottomVertices.push(
      addWorldVertex([bottomX, bottomY, bottomZ], rotation, translation, positions),
    );
  }

  // Top face triangles (walkable!)
  // Use center point (first vertex) and fan out
  const topCenterIndex = addWorldVertex([0, halfHeight, 0], rotation, translation, positions);
  for (let i = 0; i < segments; i++) {
    const i1 = topVertices[i];
    const i2 = topVertices[(i + 1) % (segments + 1)];
    addTriangle(indices, topCenterIndex, i2, i1);
  }

  // Bottom face triangles
  const bottomCenterIndex = addWorldVertex([0, -halfHeight, 0], rotation, translation, positions);
  for (let i = 0; i < segments; i++) {
    const i1 = bottomVertices[i];
    const i2 = bottomVertices[(i + 1) % (segments + 1)];
    addTriangle(indices, bottomCenterIndex, i1, i2);
  }

  // Side triangles (vertical wall)
  for (let i = 0; i < segments; i++) {
    const i1 = i;
    const i2 = (i + 1) % (segments + 1);
    addTriangle(indices, bottomVertices[i1], topVertices[i2], bottomVertices[i2]);
    addTriangle(indices, bottomVertices[i1], topVertices[i1], topVertices[i2]);
  }
}

/**
 * Triangulates a capsule (cylinder with hemispherical caps).
 */
function triangulateCapsule(
  shape: RapierType.Capsule,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  segments: number,
  heightSegments: number,
  positions: number[],
  indices: number[],
): void {
  const radius = shape.radius;
  const halfHeight = shape.halfHeight;

  // We'll generate the capsule as:
  // - Top hemisphere
  // - Middle cylinder
  // - Bottom hemisphere

  const baseIndex = positions.length / 3;

  // Generate vertices
  for (let h = 0; h <= heightSegments + 2; h++) {
    let y: number;
    let currentRadius: number;

    if (h === 0) {
      // Bottom pole
      y = -halfHeight - radius;
      currentRadius = 0;
    } else if (h <= heightSegments / 2) {
      // Bottom hemisphere
      const theta = ((h - 1) / (heightSegments / 2)) * (Math.PI / 2);
      y = -halfHeight - radius * Math.cos(theta);
      currentRadius = radius * Math.sin(theta);
    } else if (h <= heightSegments / 2 + heightSegments) {
      // Middle cylinder
      const t = (h - heightSegments / 2) / heightSegments;
      y = -halfHeight + t * (halfHeight * 2);
      currentRadius = radius;
    } else {
      // Top hemisphere
      const theta = ((h - heightSegments / 2 - heightSegments - 1) / (heightSegments / 2)) * (Math.PI / 2);
      y = halfHeight + radius * Math.sin(theta);
      currentRadius = radius * Math.cos(theta);
    }

    for (let i = 0; i <= segments; i++) {
      const angle = (i * 2 * Math.PI) / segments;
      const x = currentRadius * Math.cos(angle);
      const z = currentRadius * Math.sin(angle);
      addWorldVertex([x, y, z], rotation, translation, positions);
    }
  }

  // Generate triangles
  const totalHeightSegments = heightSegments + 2;
  for (let h = 0; h < totalHeightSegments; h++) {
    for (let i = 0; i < segments; i++) {
      const current = baseIndex + h * (segments + 1) + i;
      const next = baseIndex + (h + 1) * (segments + 1) + i;
      const currentNext = current + 1;
      const nextNext = next + 1;

      addTriangle(indices, current, next, currentNext);
      addTriangle(indices, currentNext, next, nextNext);
    }
  }
}

/**
 * Extracts Rapier heightfield data for conversion to Navcat Heightfield.
 * Returns the heightfield data structure instead of tessellating to triangles.
 */
function extractHeightfieldData(
  shape: RapierType.Heightfield,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  _rapier: typeof RapierType,
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
  collider: RapierType.Collider,
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

function createDynamicObstacle(
  collider: RapierType.Collider,
  bodyType: ColliderBodyKind,
  translation: { x: number; y: number; z: number },
  rapier: typeof RapierType,
): DynamicNavMeshObstacle | null {
  const aabb = getAABBForComplexShape(collider);

  let center: Vec3 | null = null;
  let halfExtents: Vec3 | null = null;

  if (aabb) {
    center = [aabb.center.x, aabb.center.y, aabb.center.z];
    halfExtents = [aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z];
  } else {
    const shape = collider.shape;

    switch (shape.type) {
      case rapier.ShapeType.Cuboid: {
        const { x, y, z } = (shape as RapierType.Cuboid).halfExtents;
        center = [translation.x, translation.y, translation.z];
        halfExtents = [x, y, z];
        break;
      }
      case rapier.ShapeType.Ball: {
        const radius = (shape as RapierType.Ball).radius;
        center = [translation.x, translation.y, translation.z];
        halfExtents = [radius, radius, radius];
        break;
      }
      case rapier.ShapeType.Capsule: {
        const { radius, halfHeight } = shape as RapierType.Capsule;
        center = [translation.x, translation.y, translation.z];
        halfExtents = [radius, halfHeight + radius, radius];
        break;
      }
      case rapier.ShapeType.Cylinder: {
        const { radius, halfHeight } = shape as RapierType.Cylinder;
        center = [translation.x, translation.y, translation.z];
        halfExtents = [radius, halfHeight, radius];
        break;
      }
      default: {
        return null;
      }
    }
  }

  if (!center || !halfExtents) {
    return null;
  }

  const radius = Math.max(Math.abs(halfExtents[0]), Math.abs(halfExtents[2]));
  const height = Math.max(0.0001, Math.abs(halfExtents[1]) * 2);

  return {
    handle: collider.handle,
    bodyType,
    center,
    halfExtents,
    radius,
    height,
  };
}

/**
 * Triangulates a TriMesh shape by extracting its vertices and indices.
 */
function triangulateTriMesh(
  shape: RapierType.TriMesh,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  positions: number[],
  indices: number[],
): void {
  // Get vertices and indices from Rapier TriMesh (these are properties, not methods)
  const anyShape = shape as unknown as {
    vertices: Float32Array;
    indices: Uint32Array;
  };
  const vertices = anyShape.vertices;
  const indices_rapier = anyShape.indices;

  const baseIndex = positions.length / 3;

  // Transform and add all vertices
  for (let i = 0; i < vertices.length; i += 3) {
    const localPos: [number, number, number] = [vertices[i], vertices[i + 1], vertices[i + 2]];
    addWorldVertex(localPos, rotation, translation, positions);
  }

  // Add triangles using Rapier's indices
  for (let i = 0; i < indices_rapier.length; i += 3) {
    addTriangle(
      indices,
      baseIndex + indices_rapier[i],
      baseIndex + indices_rapier[i + 1],
      baseIndex + indices_rapier[i + 2],
    );
  }
}

/**
 * Triangulates a ConvexPolyhedron shape.
 * Note: Rapier ConvexPolyhedron may not expose vertices directly.
 * For now, we'll use AABB approximation as fallback.
 */
function triangulateConvex(
  collider: RapierType.Collider,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  positions: number[],
  indices: number[],
): boolean {
  // Try to get vertices from convex shape
  const anyShape = collider.shape as unknown as {
    points?: Float32Array;
    indices?: Uint32Array;
  };

  if (anyShape.points && anyShape.indices) {
    const vertices = anyShape.points;
    const indices_rapier = anyShape.indices;

    const baseIndex = positions.length / 3;

    // Transform and add vertices
    for (let i = 0; i < vertices.length; i += 3) {
      const localPos: [number, number, number] = [vertices[i], vertices[i + 1], vertices[i + 2]];
      addWorldVertex(localPos, rotation, translation, positions);
    }

    // Add triangles
    for (let i = 0; i < indices_rapier.length; i += 3) {
      addTriangle(
        indices,
        baseIndex + indices_rapier[i],
        baseIndex + indices_rapier[i + 1],
        baseIndex + indices_rapier[i + 2],
      );
    }
    return true;
  }

  // Fallback: use AABB as a cuboid
  const aabb = getAABBForComplexShape(collider);
  if (!aabb) return false;

  const { halfExtents } = aabb;
  // Create a temporary cuboid shape
  const tempCuboid = {
    halfExtents: {
      x: halfExtents.x,
      y: halfExtents.y,
      z: halfExtents.z,
    },
  } as RapierType.Cuboid;

  // Use cuboid triangulation with adjusted translation (account for AABB center offset)
  const aabbCenter = aabb.center;
  const adjustedTranslation = {
    x: translation.x + (aabbCenter.x - translation.x),
    y: translation.y + (aabbCenter.y - translation.y),
    z: translation.z + (aabbCenter.z - translation.z),
  };

  triangulateCuboid(tempCuboid, rotation, adjustedTranslation, positions, indices);
  return true;
}

/**
 * Processes a single collider shape and triangulates it to geometry.
 */
function processColliderShape(
  shape: RapierType.Shape,
  collider: RapierType.Collider,
  rotation: { x: number; y: number; z: number; w: number },
  translation: { x: number; y: number; z: number },
  rapier: typeof RapierType,
  options: Required<ExtractOptions>,
  positions: number[],
  indices: number[],
): { heightfield: RapierHeightfieldData | null } {
  const triOpts = options.triangulation;

  switch (shape.type) {
    case rapier.ShapeType.Cuboid: {
      triangulateCuboid(
        shape as RapierType.Cuboid,
        rotation,
        translation,
        positions,
        indices,
      );
      return { heightfield: null };
    }

    case rapier.ShapeType.Ball: {
      triangulateSphere(
        shape as RapierType.Ball,
        rotation,
        translation,
        triOpts.sphereSegments ?? 20,
        positions,
        indices,
      );
      return { heightfield: null };
    }

    case rapier.ShapeType.Cylinder: {
      triangulateCylinder(
        shape as RapierType.Cylinder,
        rotation,
        translation,
        triOpts.cylinderSegments ?? 24,
        positions,
        indices,
      );
      return { heightfield: null };
    }

    case rapier.ShapeType.Capsule: {
      triangulateCapsule(
        shape as RapierType.Capsule,
        rotation,
        translation,
        triOpts.sphereSegments ?? 20,
        triOpts.capsuleSegments ?? 16,
        positions,
        indices,
      );
      return { heightfield: null };
    }

    case rapier.ShapeType.HeightField: {
      // Extract as heightfield data instead of tessellating
      const heightfieldData = extractHeightfieldData(
        shape as RapierType.Heightfield,
        rotation,
        translation,
        rapier,
      );
      return { heightfield: heightfieldData };
    }

    case rapier.ShapeType.TriMesh: {
      triangulateTriMesh(
        shape as RapierType.TriMesh,
        rotation,
        translation,
        positions,
        indices,
      );
      return { heightfield: null };
    }

    case rapier.ShapeType.ConvexPolyhedron: {
      triangulateConvex(collider, rotation, translation, positions, indices);
      return { heightfield: null };
    }

    default: {
      // For unknown shapes, try to triangulate as convex, otherwise skip
      console.warn(`[Extract] Unknown shape type ${shape.type}, attempting convex fallback`);
      triangulateConvex(collider, rotation, translation, positions, indices);
      return { heightfield: null };
    }
  }
}

/**
 * Extracts collider data from a Rapier World and converts it to Navcat-compatible format.
 * Works with any Rapier.js instance (not limited to React Three Fiber).
 *
 * **All colliders are triangulated to geometry** (no obstacles). Fixed, kinematic, and dynamic
 * bodies are all included as walkable geometry. Slope filtering during navmesh generation
 * will determine which surfaces are actually walkable.
 *
 * **HeightFields**: Rapier HeightField shapes are extracted as structured data
 * (RapierHeightfieldData) rather than tessellated triangles. This preserves the
 * heightfield structure for direct use with Navcat's Heightfield format.
 *
 * @param world - The Rapier World instance
 * @param rapier - The Rapier API instance (from Rapier.init())
 * @param options - Extraction options
 * @returns Extracted geometry and heightfields, or null if no geometry found
 */
export function extractRapierToNavcat(
  world: RapierType.World,
  rapier: typeof RapierType,
  options: ExtractOptions = {},
): RapierExtractionResult | null {
  const extractStartTime = performance.now();
  
  // Merge options with defaults
  const opts: Required<Omit<ExtractOptions, "cache">> & { cache?: RapierExtractionCache } = {
    includeDynamic: options.includeDynamic ?? DEFAULT_OPTIONS.includeDynamic,
    includeKinematic: options.includeKinematic ?? DEFAULT_OPTIONS.includeKinematic,
    triangulation: {
      ...DEFAULT_OPTIONS.triangulation,
      ...options.triangulation,
    },
    cache: options.cache ?? undefined,
  };

  type ColliderEntry = {
    collider: RapierType.Collider;
    kind: ColliderBodyKind;
  };

  const colliderEntries: ColliderEntry[] = [];
  let colliderCount = 0;
  let processedCount = 0;
  const gatherStartTime = performance.now();

  world.forEachCollider((collider) => {
    colliderCount++;
    const parent = collider.parent();
    if (!parent) return;

    const bodyType = parent.bodyType();
    let kind: ColliderBodyKind | null = null;

    if (bodyType === rapier.RigidBodyType.Fixed) {
      kind = "fixed";
    } else if (
      bodyType === rapier.RigidBodyType.KinematicPositionBased ||
      bodyType === rapier.RigidBodyType.KinematicVelocityBased
    ) {
      if (!opts.includeKinematic) {
        return;
      }
      kind = "kinematic";
    } else if (bodyType === rapier.RigidBodyType.Dynamic) {
      if (!opts.includeDynamic) {
        return;
      }
      kind = "dynamic";
    }

    if (!kind) {
      return;
    }

    processedCount++;
    colliderEntries.push({ collider, kind });
  });

  const gatherTime = performance.now() - gatherStartTime;

  const staticColliderHandles = colliderEntries
    .filter((entry) => entry.kind === "fixed")
    .map((entry) => entry.collider.handle)
    .sort((a, b) => a - b);

  const staticHandlesKey = staticColliderHandles.join(",");
  const cacheRef = opts.cache;
  const cachedSignatureKey = cacheRef?.staticSignature?.split("|")[0];
  const canReuseStatic =
    !!cacheRef &&
    cachedSignatureKey === staticHandlesKey &&
    cacheRef.geometry &&
    cacheRef.heightfields;

  const positions: number[] = [];
  const indices: number[] = [];
  const heightfields: RapierHeightfieldData[] = [];
  let usedStaticCache = false;

  if (!canReuseStatic) {
    const staticProcessStart = performance.now();

    for (const entry of colliderEntries) {
      if (entry.kind !== "fixed") {
        continue;
      }

      const collider = entry.collider;
      const translation = collider.translation();
      const rotation = collider.rotation();
      const shape = collider.shape;

      const result = processColliderShape(
        shape,
        collider,
        rotation,
        translation,
        rapier,
        opts,
        positions,
        indices,
      );

      if (result.heightfield) {
        heightfields.push(result.heightfield);
      }
    }

    const staticProcessTime = performance.now() - staticProcessStart;
    console.log(
      `[Extract] Processed ${processedCount}/${colliderCount} colliders (static build ${staticProcessTime.toFixed(
        2,
      )}ms, gather ${gatherTime.toFixed(2)}ms)`,
    );
  } else {
    usedStaticCache = true;
    console.log(
      `[Extract] Reused cached static geometry for ${staticColliderHandles.length} colliders (gather ${gatherTime.toFixed(
        2,
      )}ms)`,
    );
  }

  const dynamicObstacles: DynamicNavMeshObstacle[] = [];
  const dynamicProcessStart = performance.now();

  for (const entry of colliderEntries) {
    if (entry.kind === "fixed") {
      continue;
    }

    const translation = entry.collider.translation();
    const obstacle = createDynamicObstacle(entry.collider, entry.kind, translation, rapier);
    if (obstacle) {
      dynamicObstacles.push(obstacle);
    }
  }

  const dynamicProcessTime = performance.now() - dynamicProcessStart;

  let geometry: NavcatGeometry;
  let finalHeightfields: RapierHeightfieldData[];

  if (canReuseStatic && cacheRef) {
    geometry = cacheRef.geometry!;
    finalHeightfields = cacheRef.heightfields!;
  } else {
    geometry = {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
    };
    finalHeightfields = heightfields;

    if (cacheRef) {
      cacheRef.geometry = geometry;
      cacheRef.heightfields = finalHeightfields;
    }
  }

  const staticSignature = [
    staticHandlesKey,
    geometry.positions.length,
    geometry.indices.length,
    finalHeightfields.length,
  ].join("|");

  if (cacheRef) {
    cacheRef.staticSignature = staticSignature;
  }

  const hasGeometry = geometry.positions.length > 0 && geometry.indices.length > 0;
  const hasHeightfields = finalHeightfields.length > 0;

  if (!hasGeometry && !hasHeightfields && dynamicObstacles.length === 0) {
    const totalTime = performance.now() - extractStartTime;
    console.log(`[Extract] No data extracted (${totalTime.toFixed(2)}ms)`);
    return null;
  }

  const totalTime = performance.now() - extractStartTime;
  console.log(
    `[Extract] Extraction complete: ${totalTime.toFixed(2)}ms (dynamic ${dynamicProcessTime.toFixed(2)}ms)`,
    {
      triangles: geometry.indices.length / 3,
      vertices: geometry.positions.length / 3,
      heightfields: finalHeightfields.length,
      usedStaticCache,
    },
  );

  return {
    geometry,
    heightfields: finalHeightfields,
    dynamicObstacles,
    staticColliderHandles,
    staticSignature,
    usedStaticCache,
  };
}
