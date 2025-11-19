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
import type Rapier from "@dimforge/rapier3d-compat";

/**
 * Preset options for navmesh generation quality.
 */
export type NavMeshPreset = "default" | "crisp" | "crispStrict" | "fast";

export type NavMeshGenOptions = Partial<SoloNavMeshOptions> & {
  preset?: NavMeshPreset;
  skipDetailMesh?: boolean; // Skip detail mesh generation for faster builds
};

/**
 * Default options for generating a solo navmesh from Rapier extraction.
 * Based on Navcat documentation recommendations.
 */
export function defaultSoloNavMeshOptions(preset: NavMeshPreset = "default"): SoloNavMeshOptions {
  let cellSize: number;
  let cellHeight: number;
  let walkableRadiusWorld: number;
  let maxSimplificationError: number;
  let maxEdgeLength: number;

  switch (preset) {
    case "crisp":
      cellSize = 0.1;
      cellHeight = 0.1;
      walkableRadiusWorld = 0.25;
      maxSimplificationError = 0.5;
      maxEdgeLength = 6;
      break;
    case "crispStrict":
      cellSize = 0.1;
      cellHeight = 0.1;
      walkableRadiusWorld = 0.25;
      maxSimplificationError = 0.3;
      maxEdgeLength = 4;
      break;
    case "fast":
      cellSize = 0.2; // Larger cells = fewer voxels
      cellHeight = 0.2;
      walkableRadiusWorld = 0.3;
      maxSimplificationError = 2.0; // More aggressive simplification
      maxEdgeLength = 20;
      break;
    default: // "default"
      cellSize = 0.15;
      cellHeight = 0.15;
      walkableRadiusWorld = 0.15;
      maxSimplificationError = 1.3;
      maxEdgeLength = 12;
      break;
  }

  const walkableRadiusVoxels = Math.ceil(walkableRadiusWorld / cellSize);
  const walkableClimbWorld = 0.5;
  const walkableClimbVoxels = Math.ceil(walkableClimbWorld / cellHeight);
  const walkableHeightWorld = 1.0;
  const walkableHeightVoxels = Math.ceil(walkableHeightWorld / cellHeight);
  const walkableSlopeAngleDegrees = 45;
  const borderSize = 4;
  const minRegionArea = 8;
  const mergeRegionArea = 20;
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
  options?: NavMeshGenOptions,
): { navMesh: NavMesh } | null {
  const preset = options?.preset ?? "default";
  const skipDetailMesh = options?.skipDetailMesh ?? (preset === "fast"); // Auto-skip for fast preset
  const opts = { ...defaultSoloNavMeshOptions(preset), ...options };
  // Remove custom options before passing to Navcat
  const { preset: _, skipDetailMesh: __, ...navcatOptions } = opts as SoloNavMeshOptions & NavMeshGenOptions;
  const finalOpts = navcatOptions as SoloNavMeshOptions;

  const hasGeometry =
    extraction.geometry.positions.length > 0 &&
    extraction.geometry.indices.length > 0;
  const hasHeightfields = extraction.heightfields.length > 0;

  if (!hasGeometry && !hasHeightfields) {
    return null;
  }

  const generateStartTime = performance.now();
  console.log("[Generate] Starting navmesh generation...");

  // Initialize timing variables (will be set in conditional blocks)
  let markTriTime = 0;
  let rasterTriTime = 0;
  let rasterHfTime = 0;

  const ctx: BuildContextState = BuildContext.create();
  BuildContext.start(ctx, "navmesh generation");

  // Calculate combined bounds from geometry and heightfields
  const boundsStartTime = performance.now();
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
  const boundsTime = performance.now() - boundsStartTime;
  console.log(`[Generate] Calculated bounds: ${boundsTime.toFixed(2)}ms`);

  // Create heightfield
  const heightfieldStartTime = performance.now();
  const [heightfieldWidth, heightfieldHeight] = calculateGridSize(
    vec2.create(),
    bounds,
    finalOpts.cellSize,
  );
  const heightfield = createHeightfield(
    heightfieldWidth,
    heightfieldHeight,
    bounds,
    finalOpts.cellSize,
    finalOpts.cellHeight,
  );
  const heightfieldTime = performance.now() - heightfieldStartTime;
  console.log(`[Generate] Created heightfield (${heightfieldWidth}x${heightfieldHeight}): ${heightfieldTime.toFixed(2)}ms`);

  // Rasterize triangle geometry
  if (hasGeometry) {
    const markTriStartTime = performance.now();
    BuildContext.start(ctx, "mark walkable triangles");
    const triAreaIds = new Uint8Array(
      extraction.geometry.indices.length / 3,
    ).fill(0);
    markWalkableTriangles(
      extraction.geometry.positions,
      extraction.geometry.indices,
      triAreaIds,
      finalOpts.walkableSlopeAngleDegrees,
    );
    BuildContext.end(ctx, "mark walkable triangles");
    markTriTime = performance.now() - markTriStartTime;
    console.log(`[Generate] Marked walkable triangles: ${markTriTime.toFixed(2)}ms`);

    const rasterTriStartTime = performance.now();
    BuildContext.start(ctx, "rasterize triangles");
      rasterizeTriangles(
        ctx,
        heightfield,
        extraction.geometry.positions,
        extraction.geometry.indices,
        triAreaIds,
        finalOpts.walkableClimbVoxels,
      );
    BuildContext.end(ctx, "rasterize triangles");
    rasterTriTime = performance.now() - rasterTriStartTime;
    console.log(`[Generate] Rasterized triangles: ${rasterTriTime.toFixed(2)}ms`);
  }

  // Rasterize Rapier heightfields as triangles (using Navcat's battle-tested rasterization)
  if (hasHeightfields) {
    const rasterHfStartTime = performance.now();
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
        finalOpts.walkableClimbVoxels,
      );
    }
    BuildContext.end(ctx, "rasterize heightfields");
    rasterHfTime = performance.now() - rasterHfStartTime;
    console.log(`[Generate] Rasterized ${extraction.heightfields.length} heightfields: ${rasterHfTime.toFixed(2)}ms`);
  }

  // Filter walkable surfaces
  const filterStartTime = performance.now();
  BuildContext.start(ctx, "filter walkable surfaces");
  filterLowHangingWalkableObstacles(heightfield, finalOpts.walkableClimbVoxels);
  filterLedgeSpans(
    heightfield,
    finalOpts.walkableHeightVoxels,
    finalOpts.walkableClimbVoxels,
  );
  filterWalkableLowHeightSpans(heightfield, finalOpts.walkableHeightVoxels);
  BuildContext.end(ctx, "filter walkable surfaces");
  const filterTime = performance.now() - filterStartTime;
  console.log(`[Generate] Filtered walkable surfaces: ${filterTime.toFixed(2)}ms`);

  // Build compact heightfield
  const compactStartTime = performance.now();
  BuildContext.start(ctx, "build compact heightfield");
  const compactHeightfield = buildCompactHeightfield(
    ctx,
    finalOpts.walkableHeightVoxels,
    finalOpts.walkableClimbVoxels,
    heightfield,
  );
  const compactBuildTime = performance.now() - compactStartTime;
  console.log(`[Generate] Built compact heightfield: ${compactBuildTime.toFixed(2)}ms`);

  const erodeStartTime = performance.now();
  // For crispStrict preset, skip erosion for pixel-perfect edges
  if (preset !== "crispStrict") {
    erodeWalkableArea(finalOpts.walkableRadiusVoxels, compactHeightfield);
  }
  const erodeTime = performance.now() - erodeStartTime;
  if (preset === "crispStrict") {
    console.log(`[Generate] Skipped erosion (crispStrict preset)`);
  } else {
    console.log(`[Generate] Eroded walkable area: ${erodeTime.toFixed(2)}ms`);
  }

  const distanceStartTime = performance.now();
  buildDistanceField(compactHeightfield);
  const distanceTime = performance.now() - distanceStartTime;
  console.log(`[Generate] Built distance field: ${distanceTime.toFixed(2)}ms`);
  
  BuildContext.end(ctx, "build compact heightfield");
  const compactTotalTime = performance.now() - compactStartTime;
  console.log(`[Generate] Compact heightfield total: ${compactTotalTime.toFixed(2)}ms`);

  // Build regions
  const regionsStartTime = performance.now();
  BuildContext.start(ctx, "build regions");
  buildRegions(
    ctx,
    compactHeightfield,
    finalOpts.borderSize,
    finalOpts.minRegionArea,
    finalOpts.mergeRegionArea,
  );
  BuildContext.end(ctx, "build regions");
  const regionsTime = performance.now() - regionsStartTime;
  console.log(`[Generate] Built regions: ${regionsTime.toFixed(2)}ms`);

  // Build contours
  const contoursStartTime = performance.now();
  BuildContext.start(ctx, "build contours");
  const contourSet = buildContours(
    ctx,
    compactHeightfield,
    finalOpts.maxSimplificationError,
    finalOpts.maxEdgeLength,
    ContourBuildFlags.CONTOUR_TESS_WALL_EDGES,
  );
  BuildContext.end(ctx, "build contours");
  const contoursTime = performance.now() - contoursStartTime;
  console.log(`[Generate] Built contours: ${contoursTime.toFixed(2)}ms`);

  // Build poly mesh
  const polyMeshStartTime = performance.now();
  BuildContext.start(ctx, "build poly mesh");
  const polyMesh = buildPolyMesh(ctx, contourSet, finalOpts.maxVerticesPerPoly);
  BuildContext.end(ctx, "build poly mesh");
  const polyMeshTime = performance.now() - polyMeshStartTime;
  console.log(`[Generate] Built poly mesh (${polyMesh.nPolys} polys): ${polyMeshTime.toFixed(2)}ms`);

  // Build poly mesh detail (can be skipped for faster generation)
  // When detailSampleDistance is 0, Navcat skips detail generation but still returns a valid structure
  // Also skip automatically if we have very few polygons (< 20) AND we're in fast mode (fast preset auto-skips detail)
  // For other presets, try to build detail even for small meshes (may fail, but that's handled)
  const shouldSkipDetail = skipDetailMesh || (polyMesh.nPolys < 20 && preset === "fast");
  const detailSampleDistance = shouldSkipDetail ? 0 : finalOpts.detailSampleDistance;
  const detailStartTime = performance.now();
  BuildContext.start(ctx, "build poly mesh detail");
  let polyMeshDetail: ReturnType<typeof buildPolyMeshDetail>;
  let detailBuiltSuccessfully = false;
  let detailTime = 0;
  let usedMinimalDetailFallback = false;

  if (shouldSkipDetail) {
    detailTime = performance.now() - detailStartTime;
    const reason = skipDetailMesh ? "preset/skipDetailMesh" : `few polys (${polyMesh.nPolys} < 20)`;
    console.log(`[Generate] ⏭️ Skipped detail mesh (${reason}, detailSampleDistance=0): ${detailTime.toFixed(2)}ms`);
    polyMeshDetail = {
      meshes: [],
      vertices: [],
      triangles: [],
      nMeshes: 0,
      nVertices: 0,
      nTriangles: 0,
    } as unknown as ReturnType<typeof buildPolyMeshDetail>;
  } else {
    try {
      polyMeshDetail = buildPolyMeshDetail(
        ctx,
        polyMesh,
        compactHeightfield,
        detailSampleDistance,
        finalOpts.detailSampleMaxError,
      );
      detailBuiltSuccessfully = true;
      detailTime = performance.now() - detailStartTime;
      console.log(`[Generate] Built poly mesh detail: ${detailTime.toFixed(2)}ms`);
    } catch (error) {
      console.warn(
        `[Generate] ⚠️ Detail mesh generation failed (sampleDist=${detailSampleDistance}): ${error instanceof Error ? error.message : String(error)}`,
      );

      const fallbackStart = performance.now();
      try {
        polyMeshDetail = buildPolyMeshDetail(
          ctx,
          polyMesh,
          compactHeightfield,
          0,
          finalOpts.detailSampleMaxError,
        );
        detailBuiltSuccessfully = false;
        detailTime = performance.now() - fallbackStart;
        console.warn(`[Generate] ⚠️ Detail mesh fallback succeeded with sampleDist=0: ${detailTime.toFixed(2)}ms`);
      } catch (fallbackError) {
        console.error(
          `[Generate] ❌ Detail mesh fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}. Using minimal detail structure.`,
        );
        usedMinimalDetailFallback = true;
        detailTime = performance.now() - detailStartTime;
        polyMeshDetail = {
          meshes: [],
          vertices: [],
          triangles: [],
          nMeshes: 0,
          nVertices: 0,
          nTriangles: 0,
        } as unknown as ReturnType<typeof buildPolyMeshDetail>;
        detailBuiltSuccessfully = false;
      }
    }
  }
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

  if (usedMinimalDetailFallback || shouldSkipDetail) {
    const meshes: number[] = new Array(tilePolys.polys.length * 4);
    let meshIndex = 0;
    for (const poly of tilePolys.polys) {
      const nPolyVertices = poly.vertices.length;
      meshes[meshIndex++] = 0; // verticesBase
      meshes[meshIndex++] = nPolyVertices; // total detail verts (equal to nav poly verts)
      meshes[meshIndex++] = 0; // trianglesBase
      meshes[meshIndex++] = 0; // trianglesCount
    }

    polyMeshDetail = {
      meshes,
      vertices: [],
      triangles: [],
      nMeshes: tilePolys.polys.length,
      nVertices: 0,
      nTriangles: 0,
    } as unknown as ReturnType<typeof buildPolyMeshDetail>;
  }
  
  // Fix: Set flags to non-zero so DEFAULT_QUERY_FILTER accepts them
  // DEFAULT_QUERY_FILTER requires (flags & includeFlags) !== 0
  // Since includeFlags is 0xffffffff, we need flags to have at least one bit set
  // Set flags to 1 (or any non-zero value) for all polygons
  for (const poly of tilePolys.polys) {
    if (poly.flags === 0) {
      poly.flags = 1; // Set to non-zero so filter accepts it
    }
  }
  
  // Convert detail mesh - handle cases where detail mesh structure might be invalid
  let tileDetailMesh: ReturnType<typeof polyMeshDetailToTileDetailMesh>;
  try {
    tileDetailMesh = polyMeshDetailToTileDetailMesh(tilePolys.polys, polyMeshDetail);
  } catch (error) {
    // If conversion fails (e.g., invalid detail mesh structure), provide empty arrays
    console.warn(`[Generate] ⚠️ Detail mesh conversion failed, using empty arrays: ${error instanceof Error ? error.message : String(error)}`);
    tileDetailMesh = { 
      detailMeshes: [], 
      detailVertices: [] as number[], 
      detailTriangles: [] as number[] 
    } as ReturnType<typeof polyMeshDetailToTileDetailMesh>;
  }

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
    cellSize: finalOpts.cellSize,
    cellHeight: finalOpts.cellHeight,
    walkableHeight: finalOpts.walkableHeightWorld,
    walkableRadius: finalOpts.walkableRadiusWorld,
    walkableClimb: finalOpts.walkableClimbWorld,
  });
  const tileStartTime = performance.now();
  addTile(navMesh, tile);
  const tileTime = performance.now() - tileStartTime;
  console.log(`[Generate] Added tile: ${tileTime.toFixed(2)}ms`);

  BuildContext.end(ctx, "navmesh generation");

  const totalTime = performance.now() - generateStartTime;
  
  // Log detailed breakdown - this is the most important log
  console.group(`[Generate] ✅ Navmesh generation complete! Total: ${totalTime.toFixed(2)}ms`);
  console.log(`  📐 Bounds calculation: ${boundsTime.toFixed(2)}ms`);
  console.log(`  📊 Heightfield creation (${heightfieldWidth}x${heightfieldHeight}): ${heightfieldTime.toFixed(2)}ms`);
  if (hasGeometry && markTriTime > 0) {
    console.log(`  ✓ Mark walkable triangles: ${markTriTime.toFixed(2)}ms`);
    console.log(`  ✓ Rasterize triangles: ${rasterTriTime.toFixed(2)}ms`);
  }
  if (hasHeightfields && rasterHfTime > 0) {
    console.log(`  ✓ Rasterize ${extraction.heightfields.length} heightfields: ${rasterHfTime.toFixed(2)}ms`);
  }
  console.log(`  🔍 Filter walkable surfaces: ${filterTime.toFixed(2)}ms`);
  console.log(`  📦 Compact heightfield build: ${compactBuildTime.toFixed(2)}ms`);
  console.log(`  ⚡ Erode walkable area: ${erodeTime.toFixed(2)}ms ${preset === "crispStrict" ? "(skipped)" : ""}`);
  console.log(`  📏 Distance field: ${distanceTime.toFixed(2)}ms`);
  console.log(`  🗺️ Build regions: ${regionsTime.toFixed(2)}ms`);
  console.log(`  🔷 Build contours: ${contoursTime.toFixed(2)}ms`);
  console.log(`  🔺 Build poly mesh (${polyMesh.nPolys} polys): ${polyMeshTime.toFixed(2)}ms`);
  if (shouldSkipDetail || !detailBuiltSuccessfully) {
    const reason = shouldSkipDetail ? (skipDetailMesh ? "preset" : `few polys (${polyMesh.nPolys})`) : "error";
    console.log(`  ⏭️ Skipped detail mesh (${reason}): ${detailTime.toFixed(2)}ms`);
  } else {
    console.log(`  ✨ Build poly mesh detail: ${detailTime.toFixed(2)}ms`);
  }
  console.log(`  📌 Add tile: ${tileTime.toFixed(2)}ms`);
  console.log(`  ────────────────────────────────────`);
  console.log(`  📦 Compact total: ${compactTotalTime.toFixed(2)}ms`);
  console.groupEnd();
  
  // Also log the breakdown as a single line for easy copying
  const breakdownParts = [
    `preset(${preset}${(shouldSkipDetail || !detailBuiltSuccessfully) ? ",no-detail" : ""})`,
    `bounds(${boundsTime.toFixed(2)}ms)`,
    `heightfield(${heightfieldTime.toFixed(2)}ms)`,
    ...(hasGeometry && markTriTime > 0 ? [`markTri(${markTriTime.toFixed(2)}ms)`, `rasterTri(${rasterTriTime.toFixed(2)}ms)`] : []),
    ...(hasHeightfields && rasterHfTime > 0 ? [`rasterHf(${rasterHfTime.toFixed(2)}ms)`] : []),
    `filter(${filterTime.toFixed(2)}ms)`,
    `compact(${compactTotalTime.toFixed(2)}ms)`,
    `regions(${regionsTime.toFixed(2)}ms)`,
    `contours(${contoursTime.toFixed(2)}ms)`,
    `polyMesh(${polyMeshTime.toFixed(2)}ms)`,
    (shouldSkipDetail || !detailBuiltSuccessfully) ? `detail(skipped)` : `detail(${detailTime.toFixed(2)}ms)`,
    `tile(${tileTime.toFixed(2)}ms)`,
  ];
  console.log(`[Generate] Breakdown: ${breakdownParts.join(" + ")}`);

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
  options?: NavMeshGenOptions,
): { navMesh: NavMesh } | null {
  const extraction = extractRapierToNavcat(world, rapier);
  if (!extraction) {
    return null;
  }

  return generateSoloNavMeshFromGeometry(extraction, options);
}

