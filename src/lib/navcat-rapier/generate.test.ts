import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import Rapier from "@dimforge/rapier3d-compat";
import {
  generateSoloNavMeshFromRapier,
  defaultSoloNavMeshOptions,
} from "./generate";
import {
  findPath,
  findNearestPoly,
  createFindNearestPolyResult,
  DEFAULT_QUERY_FILTER,
  queryPolygons,
  getTilesAt,
  queryPolygonsInTile,
  ANY_QUERY_FILTER,
  getNodeRefSequence,
  INVALID_NODE_REF,
  getNodeByRef,
  type Vec3,
} from "navcat";

describe("generateSoloNavMeshFromRapier", () => {
  let rapier: typeof Rapier;
  let world: Rapier.World | null = null;

  function getWorld(): Rapier.World {
    if (!world) throw new Error("World not initialized");
    return world;
  }

  beforeAll(async () => {
    await Rapier.init();
    rapier = Rapier;
  });

  beforeEach(() => {
    if (!rapier) throw new Error("Rapier not initialized");
    world = new rapier.World(new rapier.Vector3(0, -9.81, 0));
    if (!world) throw new Error("Failed to create world");
  });

  afterEach(() => {
    if (world) {
      world.free();
      world = null;
    }
  });

  it("should generate navmesh from simple ground plane", () => {
    const w = getWorld();
    // Create a ground plane
    const groundBodyDesc = rapier.RigidBodyDesc.fixed();
    const groundBody = w.createRigidBody(groundBodyDesc);
    const groundCollider = rapier.ColliderDesc.cuboid(10, 0.1, 10);
    w.createCollider(groundCollider, groundBody);

    const result = generateSoloNavMeshFromRapier(w, rapier);
    expect(result).not.toBeNull();
    expect(result!.navMesh).toBeDefined();
    expect(Object.keys(result!.navMesh.tiles).length).toBeGreaterThan(0);
  });

  it("should generate navmesh with static obstacles and find paths around them", () => {
    const w = getWorld();
    // Create ground
    const groundBodyDesc = rapier.RigidBodyDesc.fixed();
    const groundBody = w.createRigidBody(groundBodyDesc);
    const groundCollider = rapier.ColliderDesc.cuboid(10, 0.1, 10);
    w.createCollider(groundCollider, groundBody);

    // Create a corridor layout: left slab, gap, right slab
    // Plus top/bottom slabs for detour route
    const leftSlab = rapier.RigidBodyDesc.fixed();
    const leftSlabBody = w.createRigidBody(leftSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(3, 0.1, 5).setTranslation(-4, 0.1, 0),
      leftSlabBody,
    );

    const rightSlab = rapier.RigidBodyDesc.fixed();
    const rightSlabBody = w.createRigidBody(rightSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(3, 0.1, 5).setTranslation(4, 0.1, 0),
      rightSlabBody,
    );

    // Side corridors for detour
    const topSlab = rapier.RigidBodyDesc.fixed();
    const topSlabBody = w.createRigidBody(topSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(1, 0.1, 3).setTranslation(0, 0.1, 4),
      topSlabBody,
    );

    const bottomSlab = rapier.RigidBodyDesc.fixed();
    const bottomSlabBody = w.createRigidBody(bottomSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(1, 0.1, 3).setTranslation(0, 0.1, -4),
      bottomSlabBody,
    );

    // Bridge across the gap
    const bridge = rapier.RigidBodyDesc.fixed();
    const bridgeBody = w.createRigidBody(bridge);
    w.createCollider(
      rapier.ColliderDesc.cuboid(1, 0.1, 1).setTranslation(0, 0.1, 0),
      bridgeBody,
    );

    const result = generateSoloNavMeshFromRapier(w, rapier);
    expect(result).not.toBeNull();
    expect(result!.navMesh).toBeDefined();

    const navMesh = result!.navMesh;
    expect(navMesh.tileWidth).toBeGreaterThan(0);
    expect(navMesh.tileHeight).toBeGreaterThan(0);
    const tiles = Object.values(navMesh.tiles);
    expect(tiles.length).toBeGreaterThan(0);
    const tile = tiles[0];
    expect(tile.vertices.length).toBeGreaterThan(0);
    expect(tile.polys.length).toBeGreaterThan(0);
    
    // DEBUG CHECK 1: BV-Tree not built or empty
    expect(tile.bvTree).toBeDefined();
    expect(tile.bvTree.nodes).toBeDefined();
    expect(tile.bvTree.nodes.length).toBeGreaterThan(0);
    
    // DEBUG CHECK 2: Quantization factor issue
    expect(tile.bvTree.quantFactor).toBeGreaterThan(0);
    expect(tile.bvTree.quantFactor).toBeLessThan(1000); // Reasonable upper bound
    
    // DEBUG CHECK 3: Node references not set
    expect(tile.polyNodes).toBeDefined();
    expect(tile.polyNodes.length).toBe(tile.polys.length);
    let invalidNodeRefCount = 0;
    for (let i = 0; i < tile.polys.length; i++) {
      const nodeIndex = tile.polyNodes[i];
      expect(nodeIndex).toBeGreaterThanOrEqual(0);
      const node = navMesh.nodes[nodeIndex];
      expect(node).toBeDefined();
      
      // Note: ref can be 0 if type=0, nodeIndex=0, sequence=0 (all valid)
      // INVALID_NODE_REF is actually -1
      if (node.ref === INVALID_NODE_REF) {
        invalidNodeRefCount++;
      }
      expect(node.type).toBeGreaterThanOrEqual(0);
      expect(node.tileId).toBe(tile.id);
      expect(node.polyIndex).toBe(i);
    }
    
    // Check if refs are invalid - this should never happen if addTile works correctly
    expect(invalidNodeRefCount).toBe(0);
    
    // DEBUG CHECK 4: Filter rejecting all polygons
    // Test with ANY_QUERY_FILTER to bypass filter - should always work
    const polysInTileNoFilter: number[] = [];
    queryPolygonsInTile(polysInTileNoFilter, navMesh, tile, tile.bounds, ANY_QUERY_FILTER);
    expect(polysInTileNoFilter.length).toBeGreaterThan(0);
    
    // Verify DEFAULT_QUERY_FILTER accepts polygons (flags must be non-zero)
    if (polysInTileNoFilter.length > 0) {
      const firstRef = polysInTileNoFilter[0];
      const firstNode = getNodeByRef(navMesh, firstRef);
      expect(firstNode?.flags).not.toBe(0); // Flags must be non-zero for filter
      expect(DEFAULT_QUERY_FILTER.passFilter(firstRef, navMesh)).toBe(true);
    }
    
    // DEBUG CHECK 5: Bounds overlap calculation
    const centerX = (tile.bounds[0][0] + tile.bounds[1][0]) / 2;
    const centerZ = (tile.bounds[0][2] + tile.bounds[1][2]) / 2;
    const querySize = Math.min(navMesh.tileWidth, navMesh.tileHeight) * 0.1;
    const queryBounds: [Vec3, Vec3] = [
      [centerX - querySize, tile.bounds[0][1], centerZ - querySize],
      [centerX + querySize, tile.bounds[1][1], centerZ + querySize],
    ];
    // Check if query bounds overlap tile bounds
    const boundsOverlap =
      queryBounds[0][0] <= tile.bounds[1][0] &&
      queryBounds[1][0] >= tile.bounds[0][0] &&
      queryBounds[0][1] <= tile.bounds[1][1] &&
      queryBounds[1][1] >= tile.bounds[0][1] &&
      queryBounds[0][2] <= tile.bounds[1][2] &&
      queryBounds[1][2] >= tile.bounds[0][2];
    expect(boundsOverlap).toBe(true);
    
    // DEBUG CHECK 6: Tile sequence mismatch
    expect(tile.sequence).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < tile.polyNodes.length; i++) {
      const node = navMesh.nodes[tile.polyNodes[i]];
      // Check if node ref sequence matches tile sequence
      const nodeSequence = getNodeRefSequence(node.ref);
      expect(nodeSequence).toBe(tile.sequence);
    }
    
    // DEBUG CHECK 7: BV-Tree node index issue
    let leafNodeCount = 0;
    for (let i = 0; i < tile.bvTree.nodes.length; i++) {
      const bvNode = tile.bvTree.nodes[i];
      if (bvNode.i >= 0) {
        // Leaf node
        leafNodeCount++;
        expect(bvNode.i).toBeLessThan(tile.polys.length);
      }
    }
    expect(leafNodeCount).toBeGreaterThan(0);
    
    // Verify tile is registered at (0, 0)
    const tilesAtOrigin = getTilesAt(navMesh, 0, 0);
    expect(tilesAtOrigin.length).toBeGreaterThan(0);
    expect(tilesAtOrigin[0].id).toBe(tile.id);
    
    // Now try queryPolygons with default filter - should work now that flags are set
    const polys = queryPolygons(navMesh, queryBounds, DEFAULT_QUERY_FILTER);
    expect(polys.length).toBeGreaterThan(0);
    
    // Query directly in the tile using queryPolygonsInTile
    const polysInTile: number[] = [];
    queryPolygonsInTile(polysInTile, navMesh, tile, tile.bounds, DEFAULT_QUERY_FILTER);
    expect(polysInTile.length).toBeGreaterThan(0);

    // Try to find a path from left to right
    const start: Vec3 = [-6, 0.2, 0];
    const end: Vec3 = [6, 0.2, 0];
    const halfExtents: Vec3 = [0.5, 1, 0.5];

    const startResult = findNearestPoly(
      createFindNearestPolyResult(),
      navMesh,
      start,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    const endResult = findNearestPoly(
      createFindNearestPolyResult(),
      navMesh,
      end,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    // Both must succeed - this is a requirement
    expect(startResult.success).toBe(true);
    expect(endResult.success).toBe(true);

    // Now find the path - this must work
    const path = findPath(
      navMesh,
      startResult.position,
      endResult.position,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    // Path should exist and have multiple points (going across bridge)
    expect(path.path.length).toBeGreaterThan(0);
  });

  it("should handle dynamic obstacles - path changes when bridge is moved", () => {
    const w = getWorld();
    // Create ground
    const groundBodyDesc = rapier.RigidBodyDesc.fixed();
    const groundBody = w.createRigidBody(groundBodyDesc);
    const groundCollider = rapier.ColliderDesc.cuboid(10, 0.1, 10);
    w.createCollider(groundCollider, groundBody);

    // Create corridor layout
    const leftSlab = rapier.RigidBodyDesc.fixed();
    const leftSlabBody = w.createRigidBody(leftSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(3, 0.1, 5).setTranslation(-4, 0.1, 0),
      leftSlabBody,
    );

    const rightSlab = rapier.RigidBodyDesc.fixed();
    const rightSlabBody = w.createRigidBody(rightSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(3, 0.1, 5).setTranslation(4, 0.1, 0),
      rightSlabBody,
    );

    // Side corridors for detour
    const topSlab = rapier.RigidBodyDesc.fixed();
    const topSlabBody = w.createRigidBody(topSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(1, 0.1, 3).setTranslation(0, 0.1, 4),
      topSlabBody,
    );

    const bottomSlab = rapier.RigidBodyDesc.fixed();
    const bottomSlabBody = w.createRigidBody(bottomSlab);
    w.createCollider(
      rapier.ColliderDesc.cuboid(1, 0.1, 3).setTranslation(0, 0.1, -4),
      bottomSlabBody,
    );

    // Bridge across the gap (initially present)
    const bridge = rapier.RigidBodyDesc.dynamic(); // Dynamic so we can move it
    const bridgeBody = w.createRigidBody(bridge);
    w.createCollider(
      rapier.ColliderDesc.cuboid(1, 0.1, 1).setTranslation(0, 0.1, 0),
      bridgeBody,
    );

    // Generate initial navmesh with bridge
    let result = generateSoloNavMeshFromRapier(w, rapier);
    expect(result).not.toBeNull();
    const initialNavMesh = result!.navMesh;
    expect(initialNavMesh.tileWidth).toBeGreaterThan(0);
    expect(initialNavMesh.tileHeight).toBeGreaterThan(0);
    const initialTiles = Object.values(initialNavMesh.tiles);
    expect(initialTiles.length).toBeGreaterThan(0);
    expect(initialTiles[0].vertices.length).toBeGreaterThan(0);
    expect(initialTiles[0].polys.length).toBeGreaterThan(0);
    const initialTile = initialTiles[0];
    // Verify tile is registered at (0, 0)
    const initialTilesAtOrigin = getTilesAt(initialNavMesh, 0, 0);
    expect(initialTilesAtOrigin.length).toBeGreaterThan(0);
    expect(initialTilesAtOrigin[0].id).toBe(initialTile.id);
    
    // Query directly in the tile using queryPolygonsInTile
    const initialPolysInTile: number[] = [];
    queryPolygonsInTile(initialPolysInTile, initialNavMesh, initialTile, initialTile.bounds, DEFAULT_QUERY_FILTER);
    expect(initialPolysInTile.length).toBeGreaterThan(0);
    
    // Also test queryPolygons with center bounds
    const initialCenterX = (initialTile.bounds[0][0] + initialTile.bounds[1][0]) / 2;
    const initialCenterZ = (initialTile.bounds[0][2] + initialTile.bounds[1][2]) / 2;
    const initialQuerySize = Math.min(initialNavMesh.tileWidth, initialNavMesh.tileHeight) * 0.1;
    const initialQueryBounds: [Vec3, Vec3] = [
      [initialCenterX - initialQuerySize, initialTile.bounds[0][1], initialCenterZ - initialQuerySize],
      [initialCenterX + initialQuerySize, initialTile.bounds[1][1], initialCenterZ + initialQuerySize],
    ];
    const initialPolys = queryPolygons(
      initialNavMesh,
      initialQueryBounds,
      DEFAULT_QUERY_FILTER,
    );
    expect(initialPolys.length).toBeGreaterThan(0);

    const start: Vec3 = [-6, 0.2, 0];
    const end: Vec3 = [6, 0.2, 0];
    const halfExtents: Vec3 = [0.5, 1, 0.5];

    const startResult = findNearestPoly(
      createFindNearestPolyResult(),
      initialNavMesh,
      start,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    const endResult = findNearestPoly(
      createFindNearestPolyResult(),
      initialNavMesh,
      end,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    // Both must succeed - this is a requirement
    expect(startResult.success).toBe(true);
    expect(endResult.success).toBe(true);

    // Find the initial path - this must work
    const initialPath = findPath(
      initialNavMesh,
      startResult.position,
      endResult.position,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );
    const initialPathLength = initialPath.path.length;
    expect(initialPathLength).toBeGreaterThan(0);

    // Move bridge away from the gap (simulate dynamic obstacle movement)
    bridgeBody.setTranslation({ x: 10, y: 0.1, z: 10 }, true);

    // Regenerate navmesh without bridge in the gap
    result = generateSoloNavMeshFromRapier(w, rapier);
    expect(result).not.toBeNull();
    const updatedNavMesh = result!.navMesh;
    expect(updatedNavMesh.tileWidth).toBeGreaterThan(0);
    expect(updatedNavMesh.tileHeight).toBeGreaterThan(0);
    const updatedTiles = Object.values(updatedNavMesh.tiles);
    expect(updatedTiles.length).toBeGreaterThan(0);
    expect(updatedTiles[0].vertices.length).toBeGreaterThan(0);
    expect(updatedTiles[0].polys.length).toBeGreaterThan(0);
    const updatedTile = updatedTiles[0];
    // Verify tile is registered at (0, 0)
    const updatedTilesAtOrigin = getTilesAt(updatedNavMesh, 0, 0);
    expect(updatedTilesAtOrigin.length).toBeGreaterThan(0);
    expect(updatedTilesAtOrigin[0].id).toBe(updatedTile.id);
    
    // Query directly in the tile using queryPolygonsInTile
    const updatedPolysInTile: number[] = [];
    queryPolygonsInTile(updatedPolysInTile, updatedNavMesh, updatedTile, updatedTile.bounds, DEFAULT_QUERY_FILTER);
    expect(updatedPolysInTile.length).toBeGreaterThan(0);
    
    // Also test queryPolygons with center bounds
    const updatedCenterX = (updatedTile.bounds[0][0] + updatedTile.bounds[1][0]) / 2;
    const updatedCenterZ = (updatedTile.bounds[0][2] + updatedTile.bounds[1][2]) / 2;
    const updatedQuerySize = Math.min(updatedNavMesh.tileWidth, updatedNavMesh.tileHeight) * 0.1;
    const updatedQueryBounds: [Vec3, Vec3] = [
      [updatedCenterX - updatedQuerySize, updatedTile.bounds[0][1], updatedCenterZ - updatedQuerySize],
      [updatedCenterX + updatedQuerySize, updatedTile.bounds[1][1], updatedCenterZ + updatedQuerySize],
    ];
    const updatedPolys = queryPolygons(
      updatedNavMesh,
      updatedQueryBounds,
      DEFAULT_QUERY_FILTER,
    );
    expect(updatedPolys.length).toBeGreaterThan(0);

    const updatedStartResult = findNearestPoly(
      createFindNearestPolyResult(),
      updatedNavMesh,
      start,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    const updatedEndResult = findNearestPoly(
      createFindNearestPolyResult(),
      updatedNavMesh,
      end,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    // All must succeed - this is a requirement
    expect(startResult.success).toBe(true);
    expect(endResult.success).toBe(true);
    expect(updatedStartResult.success).toBe(true);
    expect(updatedEndResult.success).toBe(true);

    // Find the updated path - this must work
    const updatedPath = findPath(
      updatedNavMesh,
      updatedStartResult.position,
      updatedEndResult.position,
      halfExtents,
      DEFAULT_QUERY_FILTER,
    );

    // Path should still exist (detour through side corridors)
    expect(updatedPath.path.length).toBeGreaterThan(0);

    // Verify both navmeshes have tiles
    expect(Object.keys(initialNavMesh.tiles).length).toBeGreaterThan(0);
    expect(Object.keys(updatedNavMesh.tiles).length).toBeGreaterThan(0);
  });
});

