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
  markCylinderArea,
  NULL_AREA,
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

export type NavMeshBuildCache = {
  staticSignature?: string;
  optionsSignature?: string;
  baseCompactHeightfield?: ReturnType<typeof buildCompactHeightfield>;
  bounds?: ReturnType<typeof calculateMeshBounds>;
  heightfieldSize?: [number, number];
};

export type NavMeshGenOptions = Partial<SoloNavMeshOptions> & {
  preset?: NavMeshPreset;
  skipDetailMesh?: boolean; // Skip detail mesh generation for faster builds
  cache?: NavMeshBuildCache;
  obstacleMargin?: number; // Extra padding when stamping dynamic obstacles
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
  const skipDetailMesh = options?.skipDetailMesh ?? (preset === "fast");
  const obstacleMargin = options?.obstacleMargin;
  const opts = { ...defaultSoloNavMeshOptions(preset), ...options };
  const { preset: _, skipDetailMesh: __, cache, obstacleMargin: ___, ...navcatOptions } =
    opts as SoloNavMeshOptions & NavMeshGenOptions;
  const finalOpts = navcatOptions as SoloNavMeshOptions;
  const cacheRef = cache ?? options?.cache ?? undefined;

  const hasStaticGeometry =
    extraction.geometry.positions.length > 0 &&
    extraction.geometry.indices.length > 0;
  const hasHeightfields = extraction.heightfields.length > 0;

  if (!hasStaticGeometry && !hasHeightfields && extraction.dynamicObstacles.length === 0) {
    return null;
  }

  const staticSignature = [
    extraction.staticColliderHandles.join(","),
    extraction.geometry.positions.length,
    extraction.geometry.indices.length,
    extraction.heightfields.length,
  ].join("|");

  const optionsSignature = [
    finalOpts.cellSize,
    finalOpts.cellHeight,
    finalOpts.walkableSlopeAngleDegrees,
    finalOpts.walkableClimbVoxels,
    finalOpts.walkableHeightVoxels,
    finalOpts.walkableRadiusVoxels,
    skipDetailMesh ? 1 : 0,
  ].join("|");

  const needsRebuild =
    !cacheRef?.baseCompactHeightfield ||
    !cacheRef.bounds ||
    !cacheRef.heightfieldSize ||
    cacheRef.staticSignature !== staticSignature ||
    cacheRef.optionsSignature !== optionsSignature;

  let baseCompact = cacheRef?.baseCompactHeightfield ?? null;
  let cachedBounds = cacheRef?.bounds ?? null;
  let heightfieldWidth = cacheRef?.heightfieldSize?.[0];
  let heightfieldHeight = cacheRef?.heightfieldSize?.[1];

  const generateStartTime = performance.now();

  let boundsTime = 0;
  let heightfieldTime = 0;
  let markTriTime = 0;
  let rasterTriTime = 0;
  let rasterHfTime = 0;
  let filterTime = 0;
  let compactBuildTime = 0;
  let erodeTime = 0;
  let distanceTime = 0;

  if (needsRebuild) {
    const staticCtx: BuildContextState = BuildContext.create();
    BuildContext.start(staticCtx, "static navmesh bake");

    const boundsStartTime = performance.now();
    let bounds = box3.create();
    if (hasStaticGeometry) {
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
    boundsTime = performance.now() - boundsStartTime;

    const heightfieldStartTime = performance.now();
    const [hfWidth, hfHeight] = calculateGridSize(vec2.create(), bounds, finalOpts.cellSize);
    heightfieldWidth = hfWidth;
    heightfieldHeight = hfHeight;
    const heightfield = createHeightfield(
      hfWidth,
      hfHeight,
      bounds,
      finalOpts.cellSize,
      finalOpts.cellHeight,
    );
    heightfieldTime = performance.now() - heightfieldStartTime;

    if (hasStaticGeometry) {
      const markTriStartTime = performance.now();
      BuildContext.start(staticCtx, "mark walkable triangles");
      const triAreaIds = new Uint8Array(
        extraction.geometry.indices.length / 3,
      ).fill(0);
      markWalkableTriangles(
        extraction.geometry.positions,
        extraction.geometry.indices,
        triAreaIds,
        finalOpts.walkableSlopeAngleDegrees,
      );
      BuildContext.end(staticCtx, "mark walkable triangles");
      markTriTime = performance.now() - markTriStartTime;

      const rasterTriStartTime = performance.now();
      BuildContext.start(staticCtx, "rasterize triangles");
      rasterizeTriangles(
        staticCtx,
        heightfield,
        extraction.geometry.positions,
        extraction.geometry.indices,
        triAreaIds,
        finalOpts.walkableClimbVoxels,
      );
      BuildContext.end(staticCtx, "rasterize triangles");
      rasterTriTime = performance.now() - rasterTriStartTime;
    }

    if (hasHeightfields) {
      const rasterHfStartTime = performance.now();
      BuildContext.start(staticCtx, "rasterize heightfields");
      for (const rapierHf of extraction.heightfields) {
        const { positions, indices } = convertRapierHeightfieldToTriangles(rapierHf);
        const triAreaIds = new Uint8Array(indices.length / 3).fill(WALKABLE_AREA);
        rasterizeTriangles(
          staticCtx,
          heightfield,
          positions,
          indices,
          triAreaIds,
          finalOpts.walkableClimbVoxels,
        );
      }
      BuildContext.end(staticCtx, "rasterize heightfields");
      rasterHfTime = performance.now() - rasterHfStartTime;
    }

    const filterStartTime = performance.now();
    BuildContext.start(staticCtx, "filter walkable surfaces");
    filterLowHangingWalkableObstacles(heightfield, finalOpts.walkableClimbVoxels);
    filterLedgeSpans(heightfield, finalOpts.walkableHeightVoxels, finalOpts.walkableClimbVoxels);
    filterWalkableLowHeightSpans(heightfield, finalOpts.walkableHeightVoxels);
    BuildContext.end(staticCtx, "filter walkable surfaces");
    filterTime = performance.now() - filterStartTime;

    const compactStartTime = performance.now();
    BuildContext.start(staticCtx, "build compact heightfield");
    const compactHeightfield = buildCompactHeightfield(
      staticCtx,
      finalOpts.walkableHeightVoxels,
      finalOpts.walkableClimbVoxels,
      heightfield,
    );
    compactBuildTime = performance.now() - compactStartTime;

    const erodeStartTime = performance.now();
    if (preset !== "crispStrict") {
      erodeWalkableArea(finalOpts.walkableRadiusVoxels, compactHeightfield);
    }
    erodeTime = performance.now() - erodeStartTime;

    const distanceStartTime = performance.now();
    buildDistanceField(compactHeightfield);
    distanceTime = performance.now() - distanceStartTime;

    BuildContext.end(staticCtx, "build compact heightfield");
    BuildContext.end(staticCtx, "static navmesh bake");

    baseCompact = compactHeightfield;
    cachedBounds = bounds;

    if (cacheRef) {
      cacheRef.staticSignature = staticSignature;
      cacheRef.optionsSignature = optionsSignature;
      cacheRef.baseCompactHeightfield = structuredClone(compactHeightfield);
      cacheRef.bounds = structuredClone(bounds);
      cacheRef.heightfieldSize = [hfWidth, hfHeight];
    }
  }

  if (!baseCompact || !cachedBounds || heightfieldWidth === undefined || heightfieldHeight === undefined) {
    return null;
  }

  const ctx: BuildContextState = BuildContext.create();
  BuildContext.start(ctx, "navmesh generation");

  const workingCompact = structuredClone(cacheRef?.baseCompactHeightfield ?? baseCompact);

  if (extraction.dynamicObstacles.length > 0) {
    const padding = obstacleMargin ?? finalOpts.cellSize * 0.5;
    for (const obstacle of extraction.dynamicObstacles) {
      if (obstacle.radius <= 0) {
        continue;
      }
      const bottom: Vec3 = [
        obstacle.center[0],
        obstacle.center[1] - obstacle.height / 2,
        obstacle.center[2],
      ];

      const radius = obstacle.radius + padding;
      const height = obstacle.height + padding;

      // Quick bounds check
      if (
        bottom[0] + radius < cachedBounds[0][0] ||
        bottom[0] - radius > cachedBounds[1][0] ||
        bottom[2] + radius < cachedBounds[0][2] ||
        bottom[2] - radius > cachedBounds[1][2]
      ) {
        continue;
      }

      markCylinderArea(bottom, radius, height, NULL_AREA, workingCompact);
    }
  }

  const regionsStartTime = performance.now();
  BuildContext.start(ctx, "build regions");
  buildRegions(
    ctx,
    workingCompact,
    finalOpts.borderSize,
    finalOpts.minRegionArea,
    finalOpts.mergeRegionArea,
  );
  BuildContext.end(ctx, "build regions");
  const regionsTime = performance.now() - regionsStartTime;

  const contoursStartTime = performance.now();
  BuildContext.start(ctx, "build contours");
  const contourSet = buildContours(
    ctx,
    workingCompact,
    finalOpts.maxSimplificationError,
    finalOpts.maxEdgeLength,
    ContourBuildFlags.CONTOUR_TESS_WALL_EDGES,
  );
  BuildContext.end(ctx, "build contours");
  const contoursTime = performance.now() - contoursStartTime;

  const polyMeshStartTime = performance.now();
  BuildContext.start(ctx, "build poly mesh");
  const polyMesh = buildPolyMesh(ctx, contourSet, finalOpts.maxVerticesPerPoly);
  BuildContext.end(ctx, "build poly mesh");
  const polyMeshTime = performance.now() - polyMeshStartTime;

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
        workingCompact,
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
          workingCompact,
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

  const navMesh = createNavMesh();
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
      meshes[meshIndex++] = 0;
      meshes[meshIndex++] = nPolyVertices;
      meshes[meshIndex++] = 0;
      meshes[meshIndex++] = 0;
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

  for (const poly of tilePolys.polys) {
    if (poly.flags === 0) {
      poly.flags = 1;
    }
  }

  let tileDetailMesh: ReturnType<typeof polyMeshDetailToTileDetailMesh>;
  try {
    tileDetailMesh = polyMeshDetailToTileDetailMesh(tilePolys.polys, polyMeshDetail);
  } catch (error) {
    console.warn(`[Generate] ⚠️ Detail mesh conversion failed, using empty arrays: ${error instanceof Error ? error.message : String(error)}`);
    tileDetailMesh = {
      detailMeshes: [],
      detailVertices: [] as number[],
      detailTriangles: [] as number[],
    } as ReturnType<typeof polyMeshDetailToTileDetailMesh>;
  }

  const tileParams = {
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
  } as Parameters<typeof buildTile>[0];

  const tileStartTime = performance.now();
  addTile(navMesh, buildTile(tileParams));
  const tileTime = performance.now() - tileStartTime;

  BuildContext.end(ctx, "navmesh generation");

  const totalTime = performance.now() - generateStartTime;
  console.group(`[Generate] ✅ Navmesh generation complete! Total: ${totalTime.toFixed(2)}ms`);
  if (needsRebuild) {
    console.log(`  📐 Bounds calculation: ${boundsTime.toFixed(2)}ms`);
    console.log(`  📊 Heightfield creation (${heightfieldWidth}x${heightfieldHeight}): ${heightfieldTime.toFixed(2)}ms`);
    if (hasStaticGeometry) {
      console.log(`  ✓ Mark walkable triangles: ${markTriTime.toFixed(2)}ms`);
      console.log(`  ✓ Rasterize triangles: ${rasterTriTime.toFixed(2)}ms`);
    }
    if (hasHeightfields) {
      console.log(`  ✓ Rasterize ${extraction.heightfields.length} heightfields: ${rasterHfTime.toFixed(2)}ms`);
    }
    console.log(`  🔍 Filter walkable surfaces: ${filterTime.toFixed(2)}ms`);
    console.log(`  📦 Compact heightfield build: ${compactBuildTime.toFixed(2)}ms`);
    if (preset === "crispStrict") {
      console.log(`  ⚡ Erode walkable area: skipped`);
    } else {
      console.log(`  ⚡ Erode walkable area: ${erodeTime.toFixed(2)}ms`);
    }
    console.log(`  📏 Distance field: ${distanceTime.toFixed(2)}ms`);
  } else {
    console.log(`  ♻️ Reused static compact heightfield from cache`);
  }
  console.log(`  🗺️ Build regions: ${regionsTime.toFixed(2)}ms`);
  console.log(`  🔷 Build contours: ${contoursTime.toFixed(2)}ms`);
  console.log(`  🔺 Build poly mesh (${polyMesh.nPolys} polys): ${polyMeshTime.toFixed(2)}ms`);
  if (shouldSkipDetail || !detailBuiltSuccessfully) {
    const reason = shouldSkipDetail ? (skipDetailMesh ? "preset" : `few polys (${polyMesh.nPolys})`) : "error";
    console.log(`  ⏭️ Detail mesh: skipped (${reason})`);
  } else {
    console.log(`  ✨ Build poly mesh detail: ${detailTime.toFixed(2)}ms`);
  }
  console.log(`  📌 Add tile: ${tileTime.toFixed(2)}ms`);
  console.groupEnd();

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

