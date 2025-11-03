import type { SoloNavMeshOptions } from "navcat/blocks";
import type { NavMesh, Vec3 } from "navcat";
import {
  BuildContext,
  type BuildContextState,
  ContourBuildFlags,
  calculateMeshBounds,
  calculateGridSize,
  createHeightfield,
  rasterizeTriangles,
  markWalkableTriangles,
  filterLowHangingWalkableObstacles,
  filterLedgeSpans,
  filterWalkableLowHeightSpans,
  buildCompactHeightfield,
  erodeWalkableArea,
  buildDistanceField,
  buildRegions,
  buildContours,
  buildPolyMesh,
  buildPolyMeshDetail,
  createNavMesh,
  polyMeshToTilePolys,
  polyMeshDetailToTileDetailMesh,
  buildTile,
  addTile,
  WALKABLE_AREA,
} from "navcat";
import { box3, vec2 } from "mathcat";
import type { RapierExtractionResult } from "./extract";
import { extractRapierToNavcat } from "./extract";
import { rotateVectorByQuaternion } from "./utils";
import Rapier from "@dimforge/rapier3d-compat";

/**
 * Default options for generating a solo navmesh from Rapier extraction.
 * Based on Navcat documentation recommendations.
 */
export function defaultSoloNavMeshOptions(): SoloNavMeshOptions {
  const cellSize = 0.15;
  const cellHeight = 0.15;
  const walkableRadiusWorld = 0.15;
  const walkableRadiusVoxels = Math.ceil(walkableRadiusWorld / cellSize);
  const walkableClimbWorld = 0.5;
  const walkableClimbVoxels = Math.ceil(walkableClimbWorld / cellHeight);
  const walkableHeightWorld = 1.0;
  const walkableHeightVoxels = Math.ceil(walkableHeightWorld / cellHeight);
  const walkableSlopeAngleDegrees = 45;
  const borderSize = 4;
  const minRegionArea = 8;
  const mergeRegionArea = 20;
  const maxSimplificationError = 1.3;
  const maxEdgeLength = 12;
  const maxVerticesPerPoly = 6;
  const detailSampleDistanceVoxels = 6;
  const detailSampleDistance =
    detailSampleDistanceVoxels < 0.9
      ? 0
      : cellSize * detailSampleDistanceVoxels;
  const detailSampleMaxErrorVoxels = 1;
  const detailSampleMaxError = cellHeight * detailSampleMaxErrorVoxels;

  return {
    cellSize,
    cellHeight,
    walkableRadiusWorld,
    walkableRadiusVoxels,
    walkableClimbWorld,
    walkableClimbVoxels,
    walkableHeightWorld,
    walkableHeightVoxels,
    walkableSlopeAngleDegrees,
    borderSize,
    minRegionArea,
    mergeRegionArea,
    maxSimplificationError,
    maxEdgeLength,
    maxVerticesPerPoly,
    detailSampleDistance,
    detailSampleMaxError,
  };
}

/**
 * Converts Rapier heightfield data to triangle vertices and indices.
 * Uses Navcat's rasterizeTriangles instead of custom quad-to-span conversion.
 */
function convertRapierHeightfieldToTriangles(
  rapierHeightfieldData: RapierExtractionResult["heightfields"][0],
): { positions: Float32Array; indices: Uint32Array } {
  const { ncols, nrows, heights, scale, translation, rotation } =
    rapierHeightfieldData;

  const positions: number[] = [];
  const indices: number[] = [];

  // Iterate through each quad in the heightfield
  // ncols and nrows represent quad counts, so we need (ncols+1) x (nrows+1) vertices
  const numVertexCols = ncols + 1;
  const numVertexRows = nrows + 1;

  // First, generate all vertices
  for (let row = 0; row < numVertexRows; row++) {
    for (let col = 0; col < numVertexCols; col++) {
      // Get height for this vertex
      // Rapier stores heights in column-major: heights[col * numVertexRows + row]
      // where numVertexRows = nrows + 1 (quad count + 1 = vertex count)
      const heightIndex = col * numVertexRows + row;
      const h = heights[heightIndex];

      // Local space vertex position
      const localPos: [number, number, number] = [
        col * scale.x,
        h * scale.y,
        row * scale.z,
      ];

      // Transform to world space
      const rotated = rotateVectorByQuaternion(localPos, rotation);
      const worldPos: [number, number, number] = [
        rotated[0] + translation[0],
        rotated[1] + translation[1],
        rotated[2] + translation[2],
      ];

      positions.push(worldPos[0], worldPos[1], worldPos[2]);
    }
  }

  // Now generate triangle indices (2 triangles per quad)
  for (let row = 0; row < nrows; row++) {
    for (let col = 0; col < ncols; col++) {
      // Calculate vertex indices for this quad's 4 corners
      const v00 = row * numVertexCols + col;
      const v10 = row * numVertexCols + (col + 1);
      const v01 = (row + 1) * numVertexCols + col;
      const v11 = (row + 1) * numVertexCols + (col + 1);

      // Split quad into 2 triangles (diagonal from v00 to v11)
      // Triangle 1: v00 -> v10 -> v11
      indices.push(v00, v10, v11);
      // Triangle 2: v00 -> v11 -> v01
      indices.push(v00, v11, v01);
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

/**
 * Generates a Navcat solo navmesh from extracted Rapier geometry and heightfields.
 * Uses lower-level Navcat API to properly integrate both triangle geometry and heightfields.
 *
 * @param extraction - The extracted Rapier data
 * @param options - Optional navmesh generation options (uses defaults if not provided)
 * @returns Generated navmesh result, or null if extraction has no geometry or heightfields
 */
export function generateSoloNavMeshFromGeometry(
  extraction: RapierExtractionResult,
  options?: Partial<SoloNavMeshOptions>,
): { navMesh: NavMesh } | null {
  const opts = { ...defaultSoloNavMeshOptions(), ...options };

  const hasGeometry =
    extraction.geometry.positions.length > 0 &&
    extraction.geometry.indices.length > 0;
  const hasHeightfields = extraction.heightfields.length > 0;

  if (!hasGeometry && !hasHeightfields) {
    return null;
  }

  const ctx: BuildContextState = BuildContext.create();
  BuildContext.start(ctx, "navmesh generation");

  // Calculate combined bounds from geometry and heightfields
  let bounds = box3.create();
  if (hasGeometry) {
    bounds = calculateMeshBounds(
      bounds,
      extraction.geometry.positions,
      extraction.geometry.indices,
    );
  }
  if (hasHeightfields) {
    for (const hf of extraction.heightfields) {
      const hfBounds = hf.bounds;
      box3.expandByPoint(bounds, bounds, hfBounds[0]);
      box3.expandByPoint(bounds, bounds, hfBounds[1]);
    }
  }

  // Create heightfield
  const [heightfieldWidth, heightfieldHeight] = calculateGridSize(
    vec2.create(),
    bounds,
    opts.cellSize,
  );
  const heightfield = createHeightfield(
    heightfieldWidth,
    heightfieldHeight,
    bounds,
    opts.cellSize,
    opts.cellHeight,
  );

  // Rasterize triangle geometry
  if (hasGeometry) {
    BuildContext.start(ctx, "mark walkable triangles");
    const triAreaIds = new Uint8Array(
      extraction.geometry.indices.length / 3,
    ).fill(0);
    markWalkableTriangles(
      extraction.geometry.positions,
      extraction.geometry.indices,
      triAreaIds,
      opts.walkableSlopeAngleDegrees,
    );
    BuildContext.end(ctx, "mark walkable triangles");

    BuildContext.start(ctx, "rasterize triangles");
    rasterizeTriangles(
      ctx,
      heightfield,
      extraction.geometry.positions,
      extraction.geometry.indices,
      triAreaIds,
      opts.walkableClimbVoxels,
    );
    BuildContext.end(ctx, "rasterize triangles");
  }

  // Rasterize Rapier heightfields as triangles (using Navcat's battle-tested rasterization)
  if (hasHeightfields) {
    BuildContext.start(ctx, "rasterize heightfields");
    for (const rapierHf of extraction.heightfields) {
      // Convert heightfield quads to triangles
      const { positions, indices } = convertRapierHeightfieldToTriangles(rapierHf);

      // Mark all triangles as walkable (heightfields are typically ground terrain)
      const triAreaIds = new Uint8Array(indices.length / 3).fill(WALKABLE_AREA);

      // Use Navcat's rasterizeTriangles for accurate triangle clipping and span generation
      rasterizeTriangles(
        ctx,
        heightfield,
        positions,
        indices,
        triAreaIds,
        opts.walkableClimbVoxels,
      );
    }
    BuildContext.end(ctx, "rasterize heightfields");
  }

  // Filter walkable surfaces
  BuildContext.start(ctx, "filter walkable surfaces");
  filterLowHangingWalkableObstacles(heightfield, opts.walkableClimbVoxels);
  filterLedgeSpans(
    heightfield,
    opts.walkableHeightVoxels,
    opts.walkableClimbVoxels,
  );
  filterWalkableLowHeightSpans(heightfield, opts.walkableHeightVoxels);
  BuildContext.end(ctx, "filter walkable surfaces");

  // Build compact heightfield
  BuildContext.start(ctx, "build compact heightfield");
  const compactHeightfield = buildCompactHeightfield(
    ctx,
    opts.walkableHeightVoxels,
    opts.walkableClimbVoxels,
    heightfield,
  );
  erodeWalkableArea(opts.walkableRadiusVoxels, compactHeightfield);
  buildDistanceField(compactHeightfield);
  BuildContext.end(ctx, "build compact heightfield");

  // Build regions
  BuildContext.start(ctx, "build regions");
  buildRegions(
    ctx,
    compactHeightfield,
    opts.borderSize,
    opts.minRegionArea,
    opts.mergeRegionArea,
  );
  BuildContext.end(ctx, "build regions");

  // Build contours
  BuildContext.start(ctx, "build contours");
  const contourSet = buildContours(
    ctx,
    compactHeightfield,
    opts.maxSimplificationError,
    opts.maxEdgeLength,
    ContourBuildFlags.CONTOUR_TESS_WALL_EDGES,
  );
  BuildContext.end(ctx, "build contours");

  // Build poly mesh
  BuildContext.start(ctx, "build poly mesh");
  const polyMesh = buildPolyMesh(ctx, contourSet, opts.maxVerticesPerPoly);
  BuildContext.end(ctx, "build poly mesh");

  // Build poly mesh detail
  BuildContext.start(ctx, "build poly mesh detail");
  const polyMeshDetail = buildPolyMeshDetail(
    ctx,
    polyMesh,
    compactHeightfield,
    opts.detailSampleDistance,
    opts.detailSampleMaxError,
  );
  BuildContext.end(ctx, "build poly mesh detail");

  // Create navmesh
  const navMesh = createNavMesh();
  // Use polyMesh.bounds (same as generateSoloNavMesh does)
  const origin: Vec3 = [
    polyMesh.bounds[0][0],
    polyMesh.bounds[0][1],
    polyMesh.bounds[0][2],
  ];
  const tileWidthWorld = polyMesh.bounds[1][0] - polyMesh.bounds[0][0];
  const tileHeightWorld = polyMesh.bounds[1][2] - polyMesh.bounds[0][2];
  navMesh.origin = origin;
  navMesh.tileWidth = tileWidthWorld;
  navMesh.tileHeight = tileHeightWorld;
  const tilePolys = polyMeshToTilePolys(polyMesh);
  
  // Fix: Set flags to non-zero so DEFAULT_QUERY_FILTER accepts them
  // DEFAULT_QUERY_FILTER requires (flags & includeFlags) !== 0
  // Since includeFlags is 0xffffffff, we need flags to have at least one bit set
  // Set flags to 1 (or any non-zero value) for all polygons
  for (const poly of tilePolys.polys) {
    if (poly.flags === 0) {
      poly.flags = 1; // Set to non-zero so filter accepts it
    }
  }
  
  const tileDetailMesh = polyMeshDetailToTileDetailMesh(
    tilePolys.polys,
    polyMeshDetail,
  );

  const tile = buildTile({
    bounds: polyMesh.bounds,
    vertices: tilePolys.vertices,
    polys: tilePolys.polys,
    detailMeshes: tileDetailMesh.detailMeshes,
    detailVertices: tileDetailMesh.detailVertices,
    detailTriangles: tileDetailMesh.detailTriangles,
    tileX: 0,
    tileY: 0,
    tileLayer: 0,
    cellSize: opts.cellSize,
    cellHeight: opts.cellHeight,
    walkableHeight: opts.walkableHeightWorld,
    walkableRadius: opts.walkableRadiusWorld,
    walkableClimb: opts.walkableClimbWorld,
  });
  addTile(navMesh, tile);

  BuildContext.end(ctx, "navmesh generation");

  return { navMesh };
}

/**
 * Extracts data from a Rapier World and generates a Navcat solo navmesh.
 * This is a convenience function that combines extraction and generation.
 *
 * @param world - The Rapier World instance
 * @param rapier - The Rapier API instance (from Rapier.init())
 * @param options - Optional navmesh generation options (uses defaults if not provided)
 * @returns Generated navmesh result, or null if no walkable surfaces found
 */
export function generateSoloNavMeshFromRapier(
  world: Rapier.World,
  rapier: typeof Rapier,
  options?: Partial<SoloNavMeshOptions>,
): { navMesh: NavMesh } | null {
  const extraction = extractRapierToNavcat(world, rapier);
  if (!extraction) {
    return null;
  }

  return generateSoloNavMeshFromGeometry(extraction, options);
}

