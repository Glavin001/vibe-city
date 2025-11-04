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
  removeTile,
  markCylinderArea,
  NULL_AREA,
  WALKABLE_AREA,
} from "navcat";
import { box3, triangle3, vec2, vec3 } from "mathcat";
import type { Box3 } from "mathcat";
import type { RapierExtractionResult } from "./extract";
import { extractRapierToNavcat } from "./extract";
import { rotateVectorByQuaternion } from "./utils";
import type Rapier from "@dimforge/rapier3d-compat";

function boxesIntersect(a: Box3, b: Box3): boolean {
  return !(
    a[1][0] < b[0][0] ||
    a[0][0] > b[1][0] ||
    a[1][1] < b[0][1] ||
    a[0][1] > b[1][1] ||
    a[1][2] < b[0][2] ||
    a[0][2] > b[1][2]
  );
}

/**
 * Preset options for navmesh generation quality.
 */
export type NavMeshPreset = "default" | "crisp" | "crispStrict" | "fast";

export type NavMeshBuildCache = {
  staticSignature?: string;
  optionsSignature?: string;
  baseCompactHeightfield?: ReturnType<typeof buildCompactHeightfield>;
  workingCompactHeightfield?: ReturnType<typeof buildCompactHeightfield>;
  bounds?: ReturnType<typeof calculateMeshBounds>;
  heightfieldSize?: [number, number];
  lastDynamicSignature?: string;
  lastNavMesh?: NavMesh | null;
  tileWidth?: number;
  tileHeight?: number;
  tileSizeVoxels?: number;
  tileSizeWorld?: number;
  tiles?: NavMeshTileCacheEntry[];
};

export type NavMeshTileCacheEntry = {
  key: string;
  tileX: number;
  tileY: number;
  bounds: Box3;
  expandedBounds: Box3;
  baseCompactHeightfield: ReturnType<typeof buildCompactHeightfield>;
  workingCompactHeightfield?: ReturnType<typeof buildCompactHeightfield>;
};

export type NavMeshGenerationStats = {
  totalTime: number;
  reusedStatic: boolean;
  reusedNavMesh: boolean;
  dynamicObstacleCount: number;
};

export type NavMeshGenerationResult = {
  navMesh: NavMesh;
  stats: NavMeshGenerationStats;
};

export type NavMeshGenOptions = Partial<SoloNavMeshOptions> & {
  preset?: NavMeshPreset;
  skipDetailMesh?: boolean; // Skip detail mesh generation for faster builds
  cache?: NavMeshBuildCache;
  obstacleMargin?: number; // Extra padding when stamping dynamic obstacles
  tileSizeVoxels?: number; // Controls tile resolution (in voxels)
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
): NavMeshGenerationResult | null {
  const preset = options?.preset ?? "default";
  const skipDetailMesh = options?.skipDetailMesh ?? (preset === "fast");
  const tileSizeVoxels = options?.tileSizeVoxels ?? 32;
  const obstacleMargin = options?.obstacleMargin;

  const mergedOptions = { ...defaultSoloNavMeshOptions(preset), ...options };
  const {
    preset: _preset,
    skipDetailMesh: _skipDetailMesh,
    cache,
    obstacleMargin: _obstacleMargin,
    tileSizeVoxels: _tileSizeVoxels,
    ...navcatOptions
  } = mergedOptions as NavMeshGenOptions &
    SoloNavMeshOptions & { tileSizeVoxels?: number };
  const finalOpts = navcatOptions as SoloNavMeshOptions;
  const cacheRef = cache ?? options?.cache ?? undefined;

  const hasStaticGeometry =
    extraction.geometry.positions.length > 0 &&
    extraction.geometry.indices.length > 0;
  const hasHeightfields = extraction.heightfields.length > 0;

  if (
    !hasStaticGeometry &&
    !hasHeightfields &&
    extraction.dynamicObstacles.length === 0
  ) {
    return null;
  }

  const staticSignature = extraction.staticSignature;
  const optionsSignature = [
    finalOpts.cellSize,
    finalOpts.cellHeight,
    finalOpts.walkableSlopeAngleDegrees,
    finalOpts.walkableClimbVoxels,
    finalOpts.walkableHeightVoxels,
    finalOpts.walkableRadiusVoxels,
    skipDetailMesh ? 1 : 0,
    tileSizeVoxels,
  ].join("|");

  const needsRebuild =
    !cacheRef?.tiles ||
    !cacheRef.bounds ||
    cacheRef.staticSignature !== staticSignature ||
    cacheRef.optionsSignature !== optionsSignature ||
    cacheRef.tileSizeVoxels !== tileSizeVoxels;

  const reusedStatic = !needsRebuild;

  const dynamicSignature = extraction.dynamicObstacles
    .map((obstacle) => {
      const centerKey = obstacle.center
        .map((value) => value.toFixed(3))
        .join(",");
      const halfKey = obstacle.halfExtents
        .map((value) => value.toFixed(3))
        .join(",");
      return [
        obstacle.handle,
        centerKey,
        halfKey,
        obstacle.radius.toFixed(3),
        obstacle.height.toFixed(3),
      ].join(":");
    })
    .sort()
    .join("|");

  const generateStartTime = performance.now();

  if (
    !needsRebuild &&
    cacheRef?.lastNavMesh &&
    cacheRef.lastDynamicSignature === dynamicSignature
  ) {
    const totalTime = performance.now() - generateStartTime;
    cacheRef.lastDynamicSignature = dynamicSignature;
    console.log(
      `[Generate] ♻️ Reusing cached navmesh (static + dynamic unchanged): ${totalTime.toFixed(
        2,
      )}ms`,
    );
    return {
      navMesh: cacheRef.lastNavMesh,
      stats: {
        totalTime,
        reusedStatic: true,
        reusedNavMesh: true,
        dynamicObstacleCount: extraction.dynamicObstacles.length,
      },
    };
  }

  const convertedHeightfields = extraction.heightfields.map(
    convertRapierHeightfieldToTriangles,
  );

  let cachedBounds = cacheRef?.bounds ?? null;
  let tileWidth = cacheRef?.tileWidth ?? 0;
  let tileHeight = cacheRef?.tileHeight ?? 0;
  let tileSizeWorld =
    cacheRef?.tileSizeWorld ?? tileSizeVoxels * finalOpts.cellSize;
  let tiles = cacheRef?.tiles ?? null;

  let boundsTime = 0;
  let rasterTriTime = 0;
  let rasterHfTime = 0;
  let filterTime = 0;
  let compactBuildTime = 0;
  let erodeTime = 0;
  let distanceTime = 0;

  if (needsRebuild) {
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

    cachedBounds = bounds;

    const gridSize = calculateGridSize(vec2.create(), bounds, finalOpts.cellSize);
    tileWidth = Math.max(
      1,
      Math.floor((gridSize[0] + tileSizeVoxels - 1) / tileSizeVoxels),
    );
    tileHeight = Math.max(
      1,
      Math.floor((gridSize[1] + tileSizeVoxels - 1) / tileSizeVoxels),
    );
    tileSizeWorld = tileSizeVoxels * finalOpts.cellSize;

    const borderWorld = finalOpts.borderSize * finalOpts.cellSize;
    const tileVoxelExtent = Math.floor(tileSizeVoxels + finalOpts.borderSize * 2);

    const geometryPositions = extraction.geometry.positions;
    const geometryIndices = extraction.geometry.indices;

    const newTiles: NavMeshTileCacheEntry[] = [];

    for (let tx = 0; tx < tileWidth; tx++) {
      for (let ty = 0; ty < tileHeight; ty++) {
        const min = [
          cachedBounds[0][0] + tx * tileSizeWorld,
          cachedBounds[0][1],
          cachedBounds[0][2] + ty * tileSizeWorld,
        ] as Vec3;
        const max = [
          cachedBounds[0][0] + (tx + 1) * tileSizeWorld,
          cachedBounds[1][1],
          cachedBounds[0][2] + (ty + 1) * tileSizeWorld,
        ] as Vec3;

        const tileBounds = box3.create();
        box3.set(tileBounds, min, max);

        const expandedBounds = box3.clone(tileBounds);
        expandedBounds[0][0] -= borderWorld;
        expandedBounds[0][2] -= borderWorld;
        expandedBounds[1][0] += borderWorld;
        expandedBounds[1][2] += borderWorld;

        const heightfield = createHeightfield(
          tileVoxelExtent,
          tileVoxelExtent,
          expandedBounds,
          finalOpts.cellSize,
          finalOpts.cellHeight,
        );

        const tileCtx: BuildContextState = BuildContext.create();

        if (hasStaticGeometry) {
          const trianglesInBox: number[] = [];
          const tri = triangle3.create();
          for (let i = 0; i < geometryIndices.length; i += 3) {
            const a = geometryIndices[i];
            const b = geometryIndices[i + 1];
            const c = geometryIndices[i + 2];
            vec3.fromBuffer(tri[0], geometryPositions, a * 3);
            vec3.fromBuffer(tri[1], geometryPositions, b * 3);
            vec3.fromBuffer(tri[2], geometryPositions, c * 3);
            if (box3.intersectsTriangle3(expandedBounds, tri)) {
              trianglesInBox.push(a, b, c);
            }
          }

          if (trianglesInBox.length > 0) {
            const triAreaIds = new Uint8Array(
              trianglesInBox.length / 3,
            ).fill(0);
            const rasterStart = performance.now();
            markWalkableTriangles(
              geometryPositions,
              trianglesInBox,
              triAreaIds,
              finalOpts.walkableSlopeAngleDegrees,
            );
            rasterizeTriangles(
              tileCtx,
              heightfield,
              geometryPositions,
              trianglesInBox,
              triAreaIds,
              finalOpts.walkableClimbVoxels,
            );
            rasterTriTime += performance.now() - rasterStart;
          }
        }

        if (convertedHeightfields.length > 0) {
          for (let hfIndex = 0; hfIndex < convertedHeightfields.length; hfIndex++) {
            const hfData = convertedHeightfields[hfIndex];
            const hfBounds = extraction.heightfields[hfIndex].bounds;
            if (!boxesIntersect(expandedBounds, hfBounds)) {
              continue;
            }

            const hfTriangles: number[] = [];
            const tri = triangle3.create();
            for (let i = 0; i < hfData.indices.length; i += 3) {
              const a = hfData.indices[i];
              const b = hfData.indices[i + 1];
              const c = hfData.indices[i + 2];
              vec3.fromBuffer(tri[0], hfData.positions, a * 3);
              vec3.fromBuffer(tri[1], hfData.positions, b * 3);
              vec3.fromBuffer(tri[2], hfData.positions, c * 3);
              if (box3.intersectsTriangle3(expandedBounds, tri)) {
                hfTriangles.push(a, b, c);
              }
            }

            if (hfTriangles.length > 0) {
              const triAreaIds = new Uint8Array(
                hfTriangles.length / 3,
              ).fill(WALKABLE_AREA);
              const rasterStart = performance.now();
              rasterizeTriangles(
                tileCtx,
                heightfield,
                hfData.positions,
                hfTriangles,
                triAreaIds,
                finalOpts.walkableClimbVoxels,
              );
              rasterHfTime += performance.now() - rasterStart;
            }
          }
        }

        const filterStart = performance.now();
        filterLowHangingWalkableObstacles(
          heightfield,
          finalOpts.walkableClimbVoxels,
        );
        filterLedgeSpans(
          heightfield,
          finalOpts.walkableHeightVoxels,
          finalOpts.walkableClimbVoxels,
        );
        filterWalkableLowHeightSpans(
          heightfield,
          finalOpts.walkableHeightVoxels,
        );
        filterTime += performance.now() - filterStart;

        const compactStart = performance.now();
        const compactHeightfield = buildCompactHeightfield(
          tileCtx,
          finalOpts.walkableHeightVoxels,
          finalOpts.walkableClimbVoxels,
          heightfield,
        );
        compactBuildTime += performance.now() - compactStart;

        const erodeStart = performance.now();
        if (preset !== "crispStrict") {
          erodeWalkableArea(finalOpts.walkableRadiusVoxels, compactHeightfield);
        }
        erodeTime += performance.now() - erodeStart;

        const distanceStart = performance.now();
        buildDistanceField(compactHeightfield);
        distanceTime += performance.now() - distanceStart;

        const baseClone = structuredClone(compactHeightfield);
        const workingClone = structuredClone(compactHeightfield);

        newTiles.push({
          key: `${tx}_${ty}`,
          tileX: tx,
          tileY: ty,
          bounds: tileBounds,
          expandedBounds,
          baseCompactHeightfield: baseClone,
          workingCompactHeightfield: workingClone,
        });
      }
    }

    tiles = newTiles;

    if (cacheRef) {
      cacheRef.staticSignature = staticSignature;
      cacheRef.optionsSignature = optionsSignature;
      cacheRef.tileSizeVoxels = tileSizeVoxels;
      cacheRef.tileSizeWorld = tileSizeWorld;
      cacheRef.tileWidth = tileWidth;
      cacheRef.tileHeight = tileHeight;
      cacheRef.bounds = structuredClone(cachedBounds);
      cacheRef.heightfieldSize = [tileVoxelExtent, tileVoxelExtent];
      cacheRef.tiles = newTiles.map((tile) => ({
        key: tile.key,
        tileX: tile.tileX,
        tileY: tile.tileY,
        bounds: structuredClone(tile.bounds) as Box3,
        expandedBounds: structuredClone(tile.expandedBounds) as Box3,
        baseCompactHeightfield: structuredClone(tile.baseCompactHeightfield),
        workingCompactHeightfield: structuredClone(tile.baseCompactHeightfield),
      }));
    }
  }

  if (!cachedBounds || !tiles) {
    return null;
  }

  const navMesh = createNavMesh();
  navMesh.origin = cachedBounds[0];
  navMesh.tileWidth = tileSizeWorld;
  navMesh.tileHeight = tileSizeWorld;

  type PreparedObstacle = {
    bottom: Vec3;
    radius: number;
    height: number;
    handle: number;
  };

  const padding = obstacleMargin ?? finalOpts.cellSize * 0.5;
  const navMeshMin = cachedBounds[0];
  const navMeshMax = cachedBounds[1];

  const stampableObstacles: PreparedObstacle[] = [];
  for (const obstacle of extraction.dynamicObstacles) {
    if (obstacle.radius <= 0) {
      continue;
    }

    const radius = obstacle.radius + padding;
    const height = obstacle.height + padding;
    const bottom = [
      obstacle.center[0],
      obstacle.center[1] - obstacle.height / 2,
      obstacle.center[2],
    ] as Vec3;

    if (
      bottom[0] + radius < navMeshMin[0] ||
      bottom[0] - radius > navMeshMax[0] ||
      bottom[1] > navMeshMax[1] ||
      bottom[1] + height < navMeshMin[1] ||
      bottom[2] + radius < navMeshMin[2] ||
      bottom[2] - radius > navMeshMax[2]
    ) {
      continue;
    }

    stampableObstacles.push({
      bottom,
      radius,
      height,
      handle: obstacle.handle,
    });
  }

  const obstacleStamped = new Set<number>();

  let totalTilesBuilt = 0;
  let tilePolysTime = 0;
  let detailConvertTime = 0;
  let tileAddTime = 0;

  for (const tile of tiles) {
    const baseCompact = tile.baseCompactHeightfield;
    if (!baseCompact) {
      continue;
    }

    const workingCompact = structuredClone(baseCompact);
    tile.workingCompactHeightfield = workingCompact;

    const expandedMin = tile.expandedBounds[0];
    const expandedMax = tile.expandedBounds[1];

    for (let i = 0; i < stampableObstacles.length; i++) {
      const obstacle = stampableObstacles[i];
      const bottomY = obstacle.bottom[1];
      if (
        obstacle.bottom[0] + obstacle.radius < expandedMin[0] ||
        obstacle.bottom[0] - obstacle.radius > expandedMax[0] ||
        bottomY > expandedMax[1] ||
        bottomY + obstacle.height < expandedMin[1] ||
        obstacle.bottom[2] + obstacle.radius < expandedMin[2] ||
        obstacle.bottom[2] - obstacle.radius > expandedMax[2]
      ) {
        continue;
      }
      markCylinderArea(
        obstacle.bottom,
        obstacle.radius,
        obstacle.height,
        NULL_AREA,
        workingCompact,
      );
      obstacleStamped.add(i);
    }

    const tileCtx: BuildContextState = BuildContext.create();
    buildRegions(
      tileCtx,
      workingCompact,
      finalOpts.borderSize,
      finalOpts.minRegionArea,
      finalOpts.mergeRegionArea,
    );
    const contourSet = buildContours(
      tileCtx,
      workingCompact,
      finalOpts.maxSimplificationError,
      finalOpts.maxEdgeLength,
      ContourBuildFlags.CONTOUR_TESS_WALL_EDGES,
    );
    const polyMesh = buildPolyMesh(
      tileCtx,
      contourSet,
      finalOpts.maxVerticesPerPoly,
    );

    if (polyMesh.nPolys === 0) {
      continue;
    }

    totalTilesBuilt++;

    const tileShouldSkipDetail =
      skipDetailMesh || (preset === "fast" && polyMesh.nPolys < 20);
    const detailSampleDistance = tileShouldSkipDetail
      ? 0
      : finalOpts.detailSampleDistance;

    let polyMeshDetail: ReturnType<typeof buildPolyMeshDetail>;
    let detailBuiltSuccessfully = false;
    let usedMinimalDetailFallback = false;

    if (!tileShouldSkipDetail) {
      try {
        polyMeshDetail = buildPolyMeshDetail(
          tileCtx,
          polyMesh,
          workingCompact,
          detailSampleDistance,
          finalOpts.detailSampleMaxError,
        );
        detailBuiltSuccessfully = true;
      } catch (error) {
        console.warn(
          `[Generate] ⚠️ Detail mesh failed for tile (${tile.tileX}, ${tile.tileY}) at sampleDist=${detailSampleDistance}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        try {
          polyMeshDetail = buildPolyMeshDetail(
            tileCtx,
            polyMesh,
            workingCompact,
            0,
            finalOpts.detailSampleMaxError,
          );
        } catch (fallbackError) {
          console.error(
            `[Generate] ❌ Detail mesh fallback failed for tile (${tile.tileX}, ${tile.tileY}): ${
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError)
            }`,
          );
          usedMinimalDetailFallback = true;
          polyMeshDetail = {
            meshes: [],
            vertices: [],
            triangles: [],
            nMeshes: 0,
            nVertices: 0,
            nTriangles: 0,
          } as unknown as ReturnType<typeof buildPolyMeshDetail>;
        }
      }
    } else {
      polyMeshDetail = {
        meshes: [],
        vertices: [],
        triangles: [],
        nMeshes: 0,
        nVertices: 0,
        nTriangles: 0,
      } as unknown as ReturnType<typeof buildPolyMeshDetail>;
    }

    const tilePolysStart = performance.now();
    const tilePolys = polyMeshToTilePolys(polyMesh);
    tilePolysTime += performance.now() - tilePolysStart;

    if (tileShouldSkipDetail || usedMinimalDetailFallback) {
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
    const detailConvertStart = performance.now();
    try {
      tileDetailMesh = polyMeshDetailToTileDetailMesh(
        tilePolys.polys,
        polyMeshDetail,
      );
    } catch (error) {
      console.warn(
        `[Generate] ⚠️ Detail conversion failed for tile (${tile.tileX}, ${tile.tileY}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      tileDetailMesh = {
        detailMeshes: [],
        detailVertices: [] as number[],
        detailTriangles: [] as number[],
      } as ReturnType<typeof polyMeshDetailToTileDetailMesh>;
    }
    detailConvertTime += performance.now() - detailConvertStart;

    const tileParams = {
      bounds: polyMesh.bounds,
      vertices: tilePolys.vertices,
      polys: tilePolys.polys,
      detailMeshes: tileDetailMesh.detailMeshes,
      detailVertices: tileDetailMesh.detailVertices,
      detailTriangles: tileDetailMesh.detailTriangles,
      tileX: tile.tileX,
      tileY: tile.tileY,
      tileLayer: 0,
      cellSize: finalOpts.cellSize,
      cellHeight: finalOpts.cellHeight,
      walkableHeight: finalOpts.walkableHeightWorld,
      walkableRadius: finalOpts.walkableRadiusWorld,
      walkableClimb: finalOpts.walkableClimbWorld,
    } as Parameters<typeof buildTile>[0];

    const tileAddStart = performance.now();
    removeTile(navMesh, tile.tileX, tile.tileY, 0);
    addTile(navMesh, buildTile(tileParams));
    tileAddTime += performance.now() - tileAddStart;

    if (!detailBuiltSuccessfully && !tileShouldSkipDetail) {
      console.warn(
        `[Generate] ℹ️ Detail mesh fallback used for tile (${tile.tileX}, ${tile.tileY})`,
      );
    }
  }

  const totalTime = performance.now() - generateStartTime;
  const stampedObstacleCount = obstacleStamped.size;

  console.group(
    `[Generate] ✅ Navmesh generation complete! Total: ${totalTime.toFixed(2)}ms`,
  );
  if (needsRebuild) {
    console.log(`  📐 Bounds calculation: ${boundsTime.toFixed(2)}ms`);
    console.log(`  ✓ Rasterize geometry: ${rasterTriTime.toFixed(2)}ms`);
    console.log(`  ✓ Rasterize heightfields: ${rasterHfTime.toFixed(2)}ms`);
    console.log(`  🔍 Filter walkable surfaces: ${filterTime.toFixed(2)}ms`);
    console.log(`  📦 Compact heightfield build: ${compactBuildTime.toFixed(2)}ms`);
    if (preset === "crispStrict") {
      console.log("  ⚡ Erode walkable area: skipped");
    } else {
      console.log(`  ⚡ Erode walkable area: ${erodeTime.toFixed(2)}ms`);
    }
    console.log(`  📏 Distance field: ${distanceTime.toFixed(2)}ms`);
  } else {
    console.log("  ♻️ Reused cached static tile heightfields");
  }
  console.log(
    `  🧱 Tiles built: ${totalTilesBuilt}/${tiles.length} (grid ${tileWidth}×${tileHeight})`,
  );
  console.log(
    `  🛠️ Stamped obstacles: ${stampedObstacleCount}/${stampableObstacles.length}`,
  );
  console.log(`  🔄 PolyMesh→TilePolys: ${tilePolysTime.toFixed(2)}ms`);
  console.log(`  🧩 Detail→TileDetail: ${detailConvertTime.toFixed(2)}ms`);
  console.log(`  📌 Add tiles: ${tileAddTime.toFixed(2)}ms`);
  console.groupEnd();

  if (cacheRef) {
    cacheRef.lastNavMesh = navMesh;
    cacheRef.lastDynamicSignature = dynamicSignature;
  }

  const stats: NavMeshGenerationStats = {
    totalTime,
    reusedStatic,
    reusedNavMesh: false,
    dynamicObstacleCount: extraction.dynamicObstacles.length,
  };

  return { navMesh, stats };
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
): NavMeshGenerationResult | null {
  const extraction = extractRapierToNavcat(world, rapier);
  if (!extraction) {
    return null;
  }

  return generateSoloNavMeshFromGeometry(extraction, options);
}

