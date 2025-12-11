import type { ScenarioDesc } from "@/lib/stress/core/types";
import {
  type FragmentInfo,
  buildWallFragments,
  buildFloorFragments,
  buildColumnFragments,
  addFoundationFragments,
  buildScenarioFromFragments,
} from "./fractureUtils";

type FracturedTowerOptions = {
  /** Width of the tower footprint (X dimension) */
  width?: number;
  /** Depth of the tower footprint (Z dimension) */
  depth?: number;
  /** Total height of the tower (Y dimension) */
  height?: number;
  /** Thickness of each wall */
  thickness?: number;
  /** Thickness of floor plates */
  floorThickness?: number;
  /** Size of interior columns (square cross-section) */
  columnSize?: number;
  /** Number of fracture pieces per wall section (per floor) */
  fragmentCountPerWall?: number;
  /** Number of fracture pieces per floor plate */
  fragmentCountPerFloor?: number;
  /** Number of fracture pieces per column section */
  fragmentCountPerColumn?: number;
  /** Total mass of the structure */
  deckMass?: number;
};

/**
 * Builds a multi-floor tower structure from fractured walls, floor plates, and interior columns.
 * Similar to buildTowerScenario but uses three-pinata fracturing for each component.
 * 
 * Structure matches the frame tower design:
 * - 4 outer shell walls per floor section
 * - Floor plates at 0%, 33%, 66%, and top
 * - 4 interior columns at 25%/75% positions
 * - Roof plate at top
 */
export function buildFracturedTowerScenario({
  width = 6.8,
  depth = 6.8,
  height = 24.3,
  thickness = 0.28,
  floorThickness = 0.22,
  columnSize = 0.5,
  fragmentCountPerWall = 15,
  fragmentCountPerFloor = 10,
  fragmentCountPerColumn = 6,
  deckMass = 280_000,
}: FracturedTowerOptions = {}): ScenarioDesc {
  // Foundation dimensions
  const foundationHeight = Math.min(0.08, height * 0.01);
  const groundClearance = Math.max(0.001, foundationHeight * 0.05);
  const foundationClearance = Math.max(0.001, foundationHeight * 0.05);
  const baseY = groundClearance + foundationHeight + foundationClearance;

  // Calculate floor heights to match buildTowerScenario pattern:
  // Floors at 0%, 33%, 66%, and near top
  const floorHeights: number[] = [
    baseY,                              // Ground floor (0%)
    baseY + height * 0.33,              // First floor (33%)
    baseY + height * 0.66,              // Second floor (66%)
    baseY + height - floorThickness,    // Top floor (near top)
  ];

  // Calculate wall positions (walls form the perimeter of the tower)
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;

  // Interior column positions at 25% and 75% (matching buildTowerScenario)
  const columnPositions = [
    { x: -halfWidth * 0.5, z: -halfDepth * 0.5 },
    { x: -halfWidth * 0.5, z: halfDepth * 0.5 },
    { x: halfWidth * 0.5, z: -halfDepth * 0.5 },
    { x: halfWidth * 0.5, z: halfDepth * 0.5 },
  ];

  // All fragments from all walls, floors, and columns
  const allFragments: FragmentInfo[] = [];

  // Build walls for each floor section
  // Each wall section spans from one floor to the next
  for (let floorIdx = 0; floorIdx < floorHeights.length - 1; floorIdx += 1) {
    const floorBottomY = floorHeights[floorIdx] + floorThickness * 0.5;
    const floorTopY = floorHeights[floorIdx + 1] - floorThickness * 0.5;
    const wallHeight = floorTopY - floorBottomY;
    
    if (wallHeight <= 0.1) continue; // Skip if floor spacing is too small

    const wallLiftY = floorBottomY;

    // Front wall (at z = -halfDepth, spans X)
    const frontWallFrags = buildWallFragments(
      width,
      wallHeight,
      thickness,
      fragmentCountPerWall,
      0, // centerX
      -halfDepth + thickness * 0.5, // centerZ (inset by half thickness)
      0, // no rotation
      wallLiftY,
    );
    allFragments.push(...frontWallFrags);

    // Back wall (at z = +halfDepth, spans X)
    const backWallFrags = buildWallFragments(
      width,
      wallHeight,
      thickness,
      fragmentCountPerWall,
      0, // centerX
      halfDepth - thickness * 0.5, // centerZ (inset by half thickness)
      0, // no rotation
      wallLiftY,
    );
    allFragments.push(...backWallFrags);

    // Side wall span (fit between front/back walls)
    const sideWallSpan = depth - thickness * 2;

    // Left wall (at x = -halfWidth, spans Z)
    const leftWallFrags = buildWallFragments(
      sideWallSpan,
      wallHeight,
      thickness,
      fragmentCountPerWall,
      -halfWidth + thickness * 0.5, // centerX (inset by half thickness)
      0, // centerZ
      Math.PI * 0.5, // 90 degree rotation
      wallLiftY,
    );
    allFragments.push(...leftWallFrags);

    // Right wall (at x = +halfWidth, spans Z)
    const rightWallFrags = buildWallFragments(
      sideWallSpan,
      wallHeight,
      thickness,
      fragmentCountPerWall,
      halfWidth - thickness * 0.5, // centerX (inset by half thickness)
      0, // centerZ
      Math.PI * 0.5, // 90 degree rotation
      wallLiftY,
    );
    allFragments.push(...rightWallFrags);

    // Build interior columns for this floor section
    for (const colPos of columnPositions) {
      const columnFrags = buildColumnFragments(
        columnSize,
        columnSize,
        wallHeight,
        fragmentCountPerColumn,
        colPos.x,
        wallLiftY,
        colPos.z,
      );
      allFragments.push(...columnFrags);
    }
  }

  // Build floor plates (except ground floor which is handled by foundation)
  // Floor plates span the interior of the walls
  const floorSpanX = width - thickness * 2;
  const floorSpanZ = depth - thickness * 2;

  for (let floorIdx = 1; floorIdx < floorHeights.length; floorIdx += 1) {
    const floorY = floorHeights[floorIdx];
    
    const floorFrags = buildFloorFragments(
      floorSpanX,
      floorSpanZ,
      floorThickness,
      fragmentCountPerFloor,
      0, // centerX
      floorY, // centerY
      0, // centerZ
    );
    allFragments.push(...floorFrags);
  }

  // Add a roof plate at the top
  const roofY = baseY + height;
  const roofFrags = buildFloorFragments(
    width, // Roof covers the full width including walls
    depth,
    floorThickness,
    fragmentCountPerFloor,
    0, // centerX
    roofY, // centerY at top of tower
    0, // centerZ
  );
  allFragments.push(...roofFrags);

  // Add rectangular foundation under the tower footprint
  addFoundationFragments(
    allFragments,
    width,
    depth,
    foundationHeight,
    groundClearance,
  );

  // Build the scenario from all fragments
  return buildScenarioFromFragments(
    allFragments,
    { width, depth, height },
    deckMass,
    {
      thickness,
      floorThickness,
      columnSize,
      floorCount: floorHeights.length,
      fragmentCountPerWall,
      fragmentCountPerFloor,
      fragmentCountPerColumn,
    },
  );
}
