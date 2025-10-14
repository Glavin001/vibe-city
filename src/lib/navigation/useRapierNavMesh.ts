import { useRef, useCallback, useEffect, useState } from 'react';
import { useRapier, useAfterPhysicsStep } from '@react-three/rapier';
import { mergePositionsAndIndices } from '@recast-navigation/generators';
import { Quaternion, Vector3, Box3 } from 'three';
import {
  ShapeType,
  type Ball,
  type RoundCuboid,
  type ConvexPolyhedron,
  type Cone,
  type Cylinder,
  type Capsule,
  type Segment,
  type HalfSpace,
  type RoundConvexPolyhedron,
  type RoundCylinder,
  type RoundCone,
  type Polyline,
  type Triangle,
  type Cuboid,
  type TriMesh,
  type Heightfield,
  type RigidBody,
  type Collider,
} from '@dimforge/rapier3d-compat';
import { useNavigation, type NavMeshData } from './useNavigation';
import { Crowd, NavMeshQuery } from 'recast-navigation';
import { DynamicTiledNavMesh } from './dynamic-tiled-navmesh';
import { navMeshBounds, recastConfig, navMeshWorkers, maxAgents, maxAgentRadius } from './constants';
import { useFrame } from '@react-three/fiber';

/** Throttle time in milliseconds */
const NAVMESH_UPDATE_THROTTLE = 1000;

// Temporary objects for transformations
const _position = new Vector3();
const _quaternion = new Quaternion();

// Cache for tessellated shape data to avoid recomputing
// const shapeTessellationCache = new Map<string, { positions: Float32Array; indices: Uint32Array }>();

interface RigidBodyCacheEntry {
  data: NavMeshData;
  position: Vector3;
  isAwake: boolean;
  isStatic: boolean;
}

/**
 * Creates a NavMeshData object from the result of mergePositionsAndIndices
 */
function createNavMeshData(result: [Float32Array, Uint32Array]): NavMeshData {
  return {
    positions: result[0],
    indices: result[1],
  };
}

type UseRapierNavMeshProps = {
  navMeshUpdateThrottle?: number;
};

/**
 * Hook to generate and update navigation mesh data from Rapier physics world
 * Creates and updates dynamicTiledNavMesh and navMeshQuery
 */
export const useRapierNavMesh = ({ navMeshUpdateThrottle = NAVMESH_UPDATE_THROTTLE }: UseRapierNavMeshProps = {}) => {
  const { world } = useRapier();

  // Cache for static and dynamic objects
  const staticCache = useRef<NavMeshData>({
    positions: new Float32Array(),
    indices: new Uint32Array(),
  });

  const dynamicCache = useRef<NavMeshData>({
    positions: new Float32Array(),
    indices: new Uint32Array(),
  });

  // Map to track rigid bodies and their cached data
  const rigidBodyMap = useRef(new Map<number, RigidBodyCacheEntry>());
  const previousHandles = useRef(new Set<number>());

  // Track last update time for throttling
  const lastUpdateTime = useRef(performance.now());
  const isUpdating = useRef(false);

  // Create navigation objects
  useEffect(() => {
    // Create dynamic tiled navmesh
    const dynamicTiledNavMesh = new DynamicTiledNavMesh({ navMeshBounds, recastConfig, workers: navMeshWorkers });

    // Create navmesh query
    const navMeshQuery = new NavMeshQuery(dynamicTiledNavMesh.navMesh);
    const crowd = new Crowd(dynamicTiledNavMesh.navMesh, { maxAgents, maxAgentRadius });

    // Set state with new objects
    useNavigation.setState({
      dynamicTiledNavMesh,
      navMesh: dynamicTiledNavMesh.navMesh,
      navMeshQuery,
      crowd,
    });

    // Initialize static bodies
    // const toMerge: NavMeshData[] = [];

    // world.forEachRigidBody((body) => {
    //   if (body.isFixed()) {
    //     const bodyData = processRigidBody(body);
    //     toMerge.push(bodyData);

    //     // Cache the static body data
    //     rigidBodyMap.current.set(body.handle, {
    //       data: bodyData,
    //       position: new Vector3().copy(body.translation() as unknown as Vector3),
    //       isAwake: false,
    //       isStatic: true,
    //     });

    //     previousHandles.current.add(body.handle);
    //   }
    // });

    // if (toMerge.length > 0) {
    //   staticCache.current = createNavMeshData(mergePositionsAndIndices(toMerge));
    //   const navMeshData = staticCache.current;
    //   useNavigation.setState({ navMeshData });

    //   // Build navmesh tiles from the initial data
    //   const positions = navMeshData.positions;
    //   const indices = navMeshData.indices;
    //   if (positions.length > 0 && indices.length > 0) {
    //     // Get all tiles within bounds
    //     const tiles = dynamicTiledNavMesh.getTilesForBounds(navMeshBounds);
    //     for (const tile of tiles) {
    //       dynamicTiledNavMesh.buildTile(positions, indices, tile);
    //     }
    //   }
    // }

    // Set initial update time
    lastUpdateTime.current = performance.now();

    // Cleanup on unmount
    return () => {
      navMeshQuery.destroy();
      dynamicTiledNavMesh.destroy();
      crowd.destroy();

      useNavigation.setState({
        dynamicTiledNavMesh: undefined,
        navMesh: undefined,
        navMeshQuery: undefined,
        navMeshData: undefined,
        crowd: undefined,
      });
    };
  }, []);

  // Update the navmesh on every physics step, but throttled
  useAfterPhysicsStep(() => {
    const startTime = performance.now();
    const currentTime = startTime;
    const timeSinceLastUpdate = currentTime - lastUpdateTime.current;

    // Only update if enough time has passed since last update
    if (isUpdating.current || timeSinceLastUpdate < navMeshUpdateThrottle) {
      return;
    }
    // console.log(`Updating navmesh: ${timeSinceLastUpdate.toFixed(2)}ms`);

    try {
      // Collect data about changed rigid bodies
      const currentHandles = new Set<number>();
      const dynamicToMerge: NavMeshData[] = [];
      let staticChanged = false;
      let anyChanges = false;

      // Iterate through all rigid bodies in the physics world
      world.forEachRigidBody((body) => {
        const handle = body.handle;
        currentHandles.add(handle);

        // Use the API methods that the Rapier body actually provides
        const isStatic = body.isFixed?.() || false;

        if (!previousHandles.current.has(handle)) {
          // New rigid body added
          const data = processRigidBody(body);

          if (isStatic) {
            staticChanged = true;
          } else {
            dynamicToMerge.push(data);
          }

          // Cache the body data
          rigidBodyMap.current.set(handle, {
            data,
            position: new Vector3().copy(body.translation() as unknown as Vector3),
            isAwake: !body.isSleeping?.(),
            isStatic,
          });

          anyChanges = true;
        } else {
          // Existing rigid body
          const cached = rigidBodyMap.current.get(handle);
          if (!cached) return;

          if (isStatic) {
            // Static bodies don't change their geometry; reuse cached data
          } else {
            // For dynamic bodies, check if they've moved or changed state
            const currentPosition = body.translation() as unknown as Vector3;
            const isAwake = !body.isSleeping?.();

            if (!cached.position.equals(currentPosition) || cached.isAwake !== isAwake) {
              // Body has moved or changed state; recompute
              const data = processRigidBody(body);
              dynamicToMerge.push(data);

              // Update cache
              cached.data = data;
              cached.position.copy(currentPosition);
              cached.isAwake = isAwake;

              anyChanges = true;
            } else {
              // No change; reuse cached data
              dynamicToMerge.push(cached.data);
            }
          }
        }
      });

      // Handle removed rigid bodies
      for (const handle of previousHandles.current) {
        if (!currentHandles.has(handle)) {
          const cached = rigidBodyMap.current.get(handle);
          if (cached?.isStatic) {
            staticChanged = true;
          }
          rigidBodyMap.current.delete(handle);
          anyChanges = true;
        }
      }

      // If nothing changed, don't bother updating the navmesh
      if (!anyChanges) {
        const endTime = performance.now();
        // console.log('No changes detected, skipping update. Duration:', endTime - startTime, 'ms');
        return;
      }

      // Update static cache if needed
      if (staticChanged) {
        const staticToMerge: NavMeshData[] = [];

        for (const [_, entry] of rigidBodyMap.current.entries()) {
          if (entry.isStatic) {
            staticToMerge.push(entry.data);
          }
        }

        if (staticToMerge.length > 0) {
          staticCache.current = createNavMeshData(mergePositionsAndIndices(staticToMerge));
        } else {
          staticCache.current = { positions: new Float32Array(), indices: new Uint32Array() };
        }
      }

      // Update dynamic cache
      if (dynamicToMerge.length > 0) {
        dynamicCache.current = createNavMeshData(mergePositionsAndIndices(dynamicToMerge));
      } else {
        dynamicCache.current = { positions: new Float32Array(), indices: new Uint32Array() };
      }

      // Merge static and dynamic caches
      const navMeshData = createNavMeshData(mergePositionsAndIndices([staticCache.current, dynamicCache.current]));
      useNavigation.setState({ navMeshData });

      // Get the dynamicTiledNavMesh from navigation state
      const { dynamicTiledNavMesh } = useNavigation.getState();
      if (dynamicTiledNavMesh && (staticChanged || dynamicToMerge.length > 0)) {
        // Update affected tiles
        const positions = navMeshData.positions;
        const indices = navMeshData.indices;

        if (positions.length > 0 && indices.length > 0) {
          // Calculate bounds from the actual positions instead of using the entire map bounds
          const bounds = new Box3();

          // Iterate through positions (each position is x,y,z so step by 3)
          for (let i = 0; i < positions.length; i += 3) {
            _position.set(positions[i], positions[i + 1], positions[i + 2]);
            bounds.expandByPoint(_position);
          }

          // Get only the tiles that intersect with our calculated bounds
          const tiles = dynamicTiledNavMesh.getTilesForBounds(bounds);
          console.log('tiles', tiles.length, tiles[0], tiles[tiles.length - 1]);
          for (const tile of tiles) {
            dynamicTiledNavMesh.buildTile(positions, indices, tile);
          }
        }
      }

      // Update previous handles for the next step
      previousHandles.current = currentHandles;

      // Update the last update time
      lastUpdateTime.current = currentTime;

      const endTime = performance.now();
      //   console.log('NavMesh update completed. Duration:', endTime - startTime, 'ms');
    } catch (error) {
      console.error(error);
    } finally {
      isUpdating.current = false;
    }
  });

  useFrame((_, delta) => {
    const crowd = useNavigation.getState().crowd;
    if (!crowd) return;

    crowd.update(1 / 60, Math.min(delta, 0.1));
  });

  return null;
};

/**
 * Process a rigid body and all its colliders for navigation mesh data
 */
function processRigidBody(body: RigidBody): NavMeshData {
  const toMerge: NavMeshData[] = [];

  // Process each collider on the rigid body
  if (body.numColliders) {
    const numColliders = body.numColliders();
    for (let i = 0; i < numColliders; i++) {
      try {
        const collider = body.collider(i);
        const colliderData = processCollider(collider);
        if (colliderData) {
          toMerge.push(colliderData);
        }
      } catch (error) {
        console.error('Error processing collider', error);
      }
    }
  }

  return toMerge.length > 0
    ? createNavMeshData(mergePositionsAndIndices(toMerge))
    : { positions: new Float32Array(), indices: new Uint32Array() };
}

/**
 * Process a collider for navigation mesh data
 */
function processCollider(collider: Collider): NavMeshData | null {
  const shape = collider.shape as AllShapes;
  if (!shape) return null;

  // Generate a hash for the collider shape
  //   const hash = generateShapeHash(collider);

  // Check cache first
  //   if (shapeTessellationCache.has(hash)) {
  //     const cachedData = shapeTessellationCache.get(hash);
  //     if (cachedData) {
  //       return cachedData;
  //     }
  //   }

  // Get local shape data
  const localData = getTessellatedData(shape, collider);
  if (!localData) return null;

  // Transform to world space
  const worldPositions = transformToWorldSpace(localData.positions, collider);
  const result = {
    positions: worldPositions,
    indices: localData.indices,
  };

  // Store in cache
  //   shapeTessellationCache.set(hash, result);

  return result;
}

type AllShapes =
  | Ball
  | Cuboid
  | Capsule
  | Cylinder
  | Cone
  | ConvexPolyhedron
  | RoundCuboid
  | RoundCylinder
  | RoundCone
  | RoundConvexPolyhedron
  | HalfSpace
  | Segment
  | Triangle
  | Polyline
  | TriMesh
  | Heightfield;

/**
 * Generate a hash key for a collider based on its shape and transform
 */
function generateShapeHash(collider: Collider): string {
  const translation = collider.translation();
  const rotation = collider.rotation();
  const shape = collider.shape as AllShapes;
  const type = shape.type;

  let shapeParams = '';

  switch (shape.type) {
    case ShapeType.Cuboid: // Cuboid
      {
        const halfExtents = shape.halfExtents;
        shapeParams = `cube-${halfExtents.x}-${halfExtents.y}-${halfExtents.z}`;
      }
      break;
    case ShapeType.Ball: // Ball
      shapeParams = `ball-${shape.radius}`;
      break;
    case ShapeType.Capsule: // Capsule
      shapeParams = `capsule-${shape.halfHeight}-${shape.radius}`;
      break;
    case ShapeType.Cylinder: // Cylinder
      shapeParams = `cylinder-${shape.halfHeight}-${shape.radius}`;
      break;
    case ShapeType.Cone: // Cone
      shapeParams = `cone-${shape.halfHeight}-${shape.radius}`;
      break;
    case ShapeType.TriMesh: // TriMesh, TODO ensure this actually works
      shapeParams = `trimesh-${shape.vertices.length}-${shape.indices.length}`;
      break;
    case ShapeType.HeightField: // HeightField, TODO ensure this actually works
      shapeParams = `heightfield-${shape.ncols}-${shape.nrows}`;
      break;
    case ShapeType.ConvexPolyhedron:
      // Use a unique identifier for complex shapes
      shapeParams = `complex-${Math.random().toString(36)}`;
      break;
    default:
      return `unsupported-${Math.random().toString(36)}`;
  }

  return `${type}-${shapeParams}-${translation.x.toFixed(3)}-${translation.y.toFixed(3)}-${translation.z.toFixed(
    3,
  )}-${rotation.x.toFixed(3)}-${rotation.y.toFixed(3)}-${rotation.z.toFixed(3)}-${rotation.w.toFixed(3)}`;
}

/**
 * Get tessellated data for a collider shape
 */
function getTessellatedData(shape: AllShapes, collider: Collider): NavMeshData | null {
  //   console.log('getTessellatedData', shape.type);
  switch (shape.type) {
    case ShapeType.Cuboid:
      return tessellateCuboid(shape.halfExtents);
    case ShapeType.Ball:
      return tessellateBall(shape.radius);
    case ShapeType.Capsule:
      return tessellateCapsule(shape.halfHeight, shape.radius);
    case ShapeType.Cylinder:
      return tessellateCylinder(shape.radius, shape.halfHeight);
    case ShapeType.Cone:
      return tessellateCone(shape.radius, shape.halfHeight);
    // case ShapeType.TriMesh:
    //   return { positions: (shape as any).vertices, indices: (shape as any).indices };
    case ShapeType.HeightField:
      return tessellateHeightfield(shape);
    // case ShapeType.ConvexPolyhedron: {
    //   const positions = shape.vertices;
    //   const indices = collider.indices();
    //   if (!positions || !indices) {
    //     console.error('No positions or indices for convex polyhedron');
    //     return null;
    //   }
    //   return {
    //     positions: new Float32Array(positions),
    //     indices: new Uint32Array(indices),
    //   };
    // }
    default:
      //   console.warn(`Unsupported shape type: ${shape.type}`);
      return null;
  }
}

/**
 * Transform local positions to world space
 */
function transformToWorldSpace(localPositions: Float32Array, collider: Collider): Float32Array {
  const positions = new Float32Array(localPositions.length);
  const translation = collider.translation();
  const rotation = collider.rotation();

  // Convert Rapier quaternion to Three.js quaternion
  _quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

  // Apply rotation and translation to each position
  for (let i = 0; i < localPositions.length; i += 3) {
    _position.set(localPositions[i], localPositions[i + 1], localPositions[i + 2]);
    _position.applyQuaternion(_quaternion);
    _position.add(translation as unknown as Vector3);

    positions[i] = _position.x;
    positions[i + 1] = _position.y;
    positions[i + 2] = _position.z;
  }

  return positions;
}

/**
 * Tessellate a cuboid shape
 */
function tessellateCuboid(halfExtents: { x: number; y: number; z: number }): NavMeshData {
  const hx = halfExtents.x;
  const hy = halfExtents.y;
  const hz = halfExtents.z;

  const positions = new Float32Array([
    -hx,
    -hy,
    -hz,
    hx,
    -hy,
    -hz,
    hx,
    hy,
    -hz,
    -hx,
    hy,
    -hz, // front
    -hx,
    -hy,
    hz,
    hx,
    -hy,
    hz,
    hx,
    hy,
    hz,
    -hx,
    hy,
    hz, // back
  ]);

  const indices = new Uint32Array([
    0,
    1,
    2,
    0,
    2,
    3, // front
    1,
    5,
    6,
    1,
    6,
    2, // right
    5,
    4,
    7,
    5,
    7,
    6, // back
    4,
    0,
    3,
    4,
    3,
    7, // left
    3,
    2,
    6,
    3,
    6,
    7, // top
    4,
    5,
    1,
    4,
    1,
    0, // bottom
  ]);

  return { positions, indices };
}

/**
 * Tessellate a ball shape
 */
function tessellateBall(radius: number, segments = 16, rings = 8): NavMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  // Generate vertices
  for (let ring = 0; ring <= rings; ring++) {
    const theta = (ring * Math.PI) / rings;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let segment = 0; segment < segments; segment++) {
      const phi = (segment * 2 * Math.PI) / segments;
      const x = radius * sinTheta * Math.cos(phi);
      const y = radius * cosTheta;
      const z = radius * sinTheta * Math.sin(phi);
      positions.push(x, y, z);
    }
  }

  // Generate indices
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * segments + segment;
      const b = (ring + 1) * segments + segment;
      const c = (ring + 1) * segments + ((segment + 1) % segments);
      const d = ring * segments + ((segment + 1) % segments);
      indices.push(a, b, c, a, c, d);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/**
 * Tessellate a capsule shape
 */
function tessellateCapsule(halfHeight: number, radius: number, nCap = 8, nCyl = 4, segments = 16): NavMeshData {
  const profile: number[][] = [];

  // Top hemisphere
  for (let i = 0; i <= nCap; i++) {
    const theta = (i / nCap) * (Math.PI / 2);
    profile.push([radius * Math.sin(theta), halfHeight + radius * Math.cos(theta)]);
  }

  // Cylinder part
  for (let i = 1; i < nCyl; i++) {
    const t = i / nCyl;
    profile.push([radius, halfHeight - t * 2 * halfHeight]);
  }

  // Bottom hemisphere
  for (let i = 0; i <= nCap; i++) {
    const theta = Math.PI / 2 + (i / nCap) * (Math.PI / 2);
    profile.push([radius * Math.sin(theta), -halfHeight + radius * Math.cos(theta)]);
  }

  const positions: number[] = [];
  const indices: number[] = [];

  // Generate vertices by revolving the profile
  for (const [x, y] of profile) {
    for (let segment = 0; segment < segments; segment++) {
      const phi = (segment / segments) * 2 * Math.PI;
      positions.push(x * Math.cos(phi), y, x * Math.sin(phi));
    }
  }

  // Generate indices
  const rings = profile.length;
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * segments + segment;
      const b = ring * segments + ((segment + 1) % segments);
      const c = (ring + 1) * segments + ((segment + 1) % segments);
      const d = (ring + 1) * segments + segment;
      indices.push(a, d, c, a, c, b);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/**
 * Tessellate a cylinder shape
 */
function tessellateCylinder(radius: number, halfHeight: number, segments = 16): NavMeshData {
  const positions: number[] = [];
  const indices: number[] = [];

  // Generate side vertices
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * 2 * Math.PI;
    const x = radius * Math.cos(phi);
    const z = radius * Math.sin(phi);
    positions.push(x, halfHeight, z, x, -halfHeight, z);
  }

  // Generate side faces
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = ((i + 1) % segments) * 2;
    const d = c + 1;
    indices.push(a, b, d, a, d, c);
  }

  // Top cap
  const topCenter = positions.length / 3;
  positions.push(0, halfHeight, 0);
  for (let i = 0; i < segments; i++) {
    indices.push(topCenter, ((i + 1) % segments) * 2, i * 2);
  }

  // Bottom cap
  const bottomCenter = positions.length / 3;
  positions.push(0, -halfHeight, 0);
  for (let i = 0; i < segments; i++) {
    indices.push(bottomCenter, i * 2 + 1, ((i + 1) % segments) * 2 + 1);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/**
 * Tessellate a cone shape
 */
function tessellateCone(radius: number, halfHeight: number, segments = 16): NavMeshData {
  const positions: number[] = [0, halfHeight, 0]; // apex
  const indices: number[] = [];

  // Generate base vertices
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * 2 * Math.PI;
    positions.push(radius * Math.cos(phi), -halfHeight, radius * Math.sin(phi));
  }

  // Generate side faces
  for (let i = 0; i < segments; i++) {
    const a = 0; // apex
    const b = i + 1;
    const c = ((i + 1) % segments) + 1;
    indices.push(a, c, b);
  }

  // Base cap
  const baseCenter = positions.length / 3;
  positions.push(0, -halfHeight, 0);
  for (let i = 0; i < segments; i++) {
    indices.push(baseCenter, i + 1, ((i + 1) % segments) + 1);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/**
 * Tessellate a heightfield shape
 */
function tessellateHeightfield(shape: Heightfield): NavMeshData {
  const heights = shape.heights;
  const nx = shape.ncols;
  const ny = shape.nrows;
  const scale = shape.scale;

  const positions = new Float32Array((nx + 1) * (ny + 1) * 3);

  // Generate vertices
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const idx = (i * (ny + 1) + j) * 3;
      positions[idx] = i * scale.x;
      positions[idx + 1] = heights[i * ny + j];
      positions[idx + 2] = j * scale.z;
    }
  }

  // Generate indices
  const indices: number[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const a = i * (ny + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (ny + 1) + j;
      const d = c + 1;
      indices.push(a, c, d, a, d, b);
    }
  }

  return {
    positions,
    indices: new Uint32Array(indices),
  };
}
