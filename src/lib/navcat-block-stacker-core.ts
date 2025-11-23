import type { Vec3 } from "mathcat";
import { DEFAULT_QUERY_FILTER, type NavMesh, findPath } from "navcat";
import { generateTiledNavMesh } from "navcat/blocks";
import { Context, DomainBuilder, TaskStatus } from "htn-ai";

export type Cell = { x: number; z: number };

export type StepDefinition = {
  cell: Cell;
  targetHeight: number;
  label: string;
};

export type PlannedAction =
  | { type: "navigate"; path: Vec3[]; description: string; targetPosition?: Vec3 }
  | { type: "pick"; cell: Cell; worldPosition: Vec3; description: string }
  | { type: "place"; cell: Cell; worldPosition: Vec3; description: string };

export type PlannedStep = {
  supply: Cell;
  supplyTop: Vec3;
  stand: Cell;
  standTop: Vec3;
  frontier: StepDefinition;
  anchor: Cell;
  pathToStand: Vec3[];
};

export type BlockWorldSnapshot = {
  grid: number[][];
  agentPos: Vec3;
  carrying: boolean;
};

export type HeadlessRunResult = {
  reachedGoal: boolean;
  actions: PlannedAction[];
  finalGrid: number[][];
  finalAgentPos: Vec3;
  iterations: number;
};

export type HeadlessRunConfig = {
  startCell?: Cell;
  goalCell?: Cell;
  goalHeight?: number;
  stairs?: StepDefinition[];
  supplySources?: Array<{ cell: Cell; height: number }>;
  maxIterations?: number;
  initialHeights?: Array<{ cell: Cell; height: number }>;
};

export const BLOCK_SIZE = 1;
export const GRID_WIDTH = 8;
export const GRID_DEPTH = 8;

export const HALF_EXTENTS: Vec3 = [0.3, 0.6, 0.3];

export const NAV_OPTIONS = {
  cellSize: 0.2,
  cellHeight: 0.2,
  tileSizeVoxels: 32,
  tileSizeWorld: 6.4,
  walkableRadiusVoxels: 1,
  walkableRadiusWorld: 0.2,
  walkableClimbVoxels: 8,
  walkableClimbWorld: 1.6,
  walkableHeightVoxels: 8,
  walkableHeightWorld: 1.8,
  walkableSlopeAngleDegrees: 45,
  borderSize: 2,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxSimplificationError: 1.3,
  maxEdgeLength: 16,
  maxVerticesPerPoly: 6,
  detailSampleDistance: 6,
  detailSampleMaxError: 1,
} as const;

export const STAIRS: StepDefinition[] = [
  { cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step 1" },
  { cell: { x: 3, z: 3 }, targetHeight: 2, label: "Step 2" },
  { cell: { x: 3, z: 4 }, targetHeight: 3, label: "Step 3" },
  { cell: { x: 3, z: 5 }, targetHeight: 4, label: "Step 4" },
];

export const START_CELL: Cell = { x: 3, z: 1 };
export const GOAL_CELL: Cell = { x: 3, z: 6 };
export const GOAL_HEIGHT = 5;

export const SUPPLY_SOURCES = [
  { cell: { x: 1, z: 1 }, height: 3 },
  { cell: { x: 5, z: 2 }, height: 2 },
  { cell: { x: 6, z: 4 }, height: 2 },
  { cell: { x: 2, z: 6 }, height: 2 },
  { cell: { x: 4, z: 4 }, height: 3 },
];

export const SUPPLY_CELLS: Cell[] = SUPPLY_SOURCES.map((source) => source.cell);

const LOG_PREFIX = "[BlockStacker]" as const;
const log = (...args: unknown[]) => console.log(LOG_PREFIX, ...args);
const logWarn = (...args: unknown[]) => console.warn(LOG_PREFIX, ...args);
const logError = (...args: unknown[]) => console.error(LOG_PREFIX, ...args);

export class BlockWorldContext extends Context {
  grid: number[][];
  navMesh: NavMesh;
  actionQueue: PlannedAction[] = [];
  agentPos: Vec3;
  carrying: boolean;
  pendingStep: PlannedStep | null = null;
  startCell: Cell;
  goalCell: Cell;
  goalHeight: number;
  stairs: StepDefinition[];
  supplySources: Array<{ cell: Cell; height: number }>;
  constructor(snapshot: BlockWorldSnapshot, navMesh: NavMesh, config?: HeadlessRunConfig) {
    super();
    this.grid = snapshot.grid;
    this.navMesh = navMesh;
    this.agentPos = [...snapshot.agentPos] as Vec3;
    this.carrying = snapshot.carrying;
    this.startCell = config?.startCell ?? START_CELL;
    this.goalCell = config?.goalCell ?? GOAL_CELL;
    this.goalHeight = config?.goalHeight ?? GOAL_HEIGHT;
    this.stairs = config?.stairs ?? STAIRS;
    this.supplySources = config?.supplySources ?? SUPPLY_SOURCES;
    this.init();
  }
}

export const cloneGrid = (grid: number[][]): number[][] => grid.map((row) => [...row]);

export const cellKey = (cell: Cell) => `${cell.x}:${cell.z}`;

export const inBounds = (cell: Cell) =>
  cell.x >= 0 && cell.x < GRID_WIDTH && cell.z >= 0 && cell.z < GRID_DEPTH;

const ADJACENT_OFFSETS: readonly Cell[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

export const posToCell = (pos: Vec3): Cell => {
  const x = Math.floor(pos[0] / BLOCK_SIZE);
  const z = Math.floor(pos[2] / BLOCK_SIZE);
  return { x, z };
};

export const getAgentCell = (agentPos: Vec3): Cell => posToCell(agentPos);

export const getAgentHeight = (grid: number[][], agentPos: Vec3): number => {
  const cell = getAgentCell(agentPos);
  if (!inBounds(cell)) return 0;
  // Agent's height is the Y position divided by block size
  return Math.floor(agentPos[1] / BLOCK_SIZE);
};

export const canPlaceDirectlyOnAdjacent = (
  grid: number[][],
  agentPos: Vec3,
  carrying: boolean,
  frontierCell: Cell,
): boolean => {
  if (!carrying) return false;
  const agentCell = getAgentCell(agentPos);
  const agentHeight = getAgentHeight(grid, agentPos);
  const frontierHeight = grid[frontierCell.x][frontierCell.z];
  
  // Check if frontier is adjacent to agent
  const isAdjacent = ADJACENT_OFFSETS.some(
    (offset) => agentCell.x + offset.x === frontierCell.x && agentCell.z + offset.z === frontierCell.z,
  );
  
  if (!isAdjacent) return false;
  
  // Agent can place if they're at the same height or 1 block taller
  // (agent can place from same height or when standing 1 block higher)
  return agentHeight >= frontierHeight && agentHeight <= frontierHeight + 1;
};

export const cellTop = (grid: number[][], cell: Cell): Vec3 => [
  cell.x * BLOCK_SIZE + BLOCK_SIZE / 2,
  grid[cell.x][cell.z] * BLOCK_SIZE,
  cell.z * BLOCK_SIZE + BLOCK_SIZE / 2,
];

export const distance3 = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const GOAL_HORIZONTAL_TOLERANCE = BLOCK_SIZE * 0.25;
export const GOAL_VERTICAL_TOLERANCE = BLOCK_SIZE * 0.25;

export const hasAgentReachedGoal = (grid: number[][], agentPos: Vec3, goalCell: Cell): boolean => {
  const goalTop = cellTop(grid, goalCell);
  const horizontalDistance = Math.hypot(agentPos[0] - goalTop[0], agentPos[2] - goalTop[2]);
  const verticalDistance = Math.abs(agentPos[1] - goalTop[1]);
  return (
    horizontalDistance <= GOAL_HORIZONTAL_TOLERANCE &&
    verticalDistance <= GOAL_VERTICAL_TOLERANCE
  );
};

export const pathToPoints = (path: ReturnType<typeof findPath>): Vec3[] => {
  if (!path.success) return [];
  return path.path.map((p) => [p.position[0], p.position[1], p.position[2]] as Vec3);
};

export const pathLength = (points: Vec3[]): number => {
  if (points.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance3(points[i - 1], points[i]);
  }
  return length;
};

const addBox = (
  positions: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
) => {
  const baseIndex = positions.length / 3;
  const vertices: Vec3[] = [
    [x, y, z],
    [x + width, y, z],
    [x + width, y, z + depth],
    [x, y, z + depth],
    [x, y + height, z],
    [x + width, y + height, z],
    [x + width, y + height, z + depth],
    [x, y + height, z + depth],
  ];
  for (const v of vertices) {
    positions.push(v[0], v[1], v[2]);
  }
  const faceIndices = [
    [0, 1, 2, 0, 2, 3],
    [4, 6, 5, 4, 7, 6],
    [4, 5, 1, 4, 1, 0],
    [3, 2, 6, 3, 6, 7],
    [1, 5, 6, 1, 6, 2],
    [4, 0, 3, 4, 3, 7],
  ];
  for (const face of faceIndices) {
    for (const index of face) {
      indices.push(baseIndex + index);
    }
  }
};

const addCube = (
  positions: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  size: number,
) => addBox(positions, indices, x, y, z, size, size, size);

export const buildGeometryFromGrid = (grid: number[][]) => {
  const positions: number[] = [];
  const indices: number[] = [];
  const planeY = 0;
  addBox(
    positions,
    indices,
    0,
    planeY - 0.2,
    0,
    GRID_WIDTH * BLOCK_SIZE,
    0.2,
    GRID_DEPTH * BLOCK_SIZE,
  );
  for (let x = 0; x < GRID_WIDTH; x++) {
    for (let z = 0; z < GRID_DEPTH; z++) {
      const height = grid[x][z];
      for (let h = 0; h < height; h++) {
        addCube(
          positions,
          indices,
          x * BLOCK_SIZE,
          h * BLOCK_SIZE,
          z * BLOCK_SIZE,
          BLOCK_SIZE,
        );
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
};

export const buildNavMeshForGrid = (grid: number[][]): NavMesh => {
  const { positions, indices } = buildGeometryFromGrid(grid);
  const { navMesh } = generateTiledNavMesh({ positions, indices }, NAV_OPTIONS);
  return navMesh;
};

export const canReachGoal = (ctx: BlockWorldContext): { reachable: boolean; path: Vec3[] } => {
  const target = cellTop(ctx.grid, ctx.goalCell);
  const result = findPath(ctx.navMesh, ctx.agentPos, target, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
  if (!result.success || result.path.length === 0) {
    return { reachable: false, path: [] };
  }
  return { reachable: true, path: pathToPoints(result) };
};

export const getFrontierForStairs = (grid: number[][], stairs: StepDefinition[]): StepDefinition | null => {
  for (const step of stairs) {
    if (grid[step.cell.x][step.cell.z] < step.targetHeight) {
      return step;
    }
  }
  return null;
};

export const getFrontier = (grid: number[][]): StepDefinition | null => {
  return getFrontierForStairs(grid, STAIRS);
};

export const chooseSupply = (ctx: BlockWorldContext): PlannedStep | null => {
  return chooseSupplyForState({
    grid: ctx.grid,
    navMesh: ctx.navMesh,
    agentPos: ctx.agentPos,
    stairs: ctx.stairs,
    supplySources: ctx.supplySources,
    startCell: ctx.startCell,
  });
};

type SupplySelectionState = {
  grid: number[][];
  navMesh: NavMesh;
  agentPos: Vec3;
  stairs: StepDefinition[];
  supplySources: Array<{ cell: Cell; height: number }>;
  startCell: Cell;
};

const chooseSupplyForState = (state: SupplySelectionState): PlannedStep | null => {
  const { grid, navMesh, agentPos, stairs, supplySources, startCell } = state;
  const frontier = getFrontierForStairs(grid, stairs);
  if (!frontier) {
    log("chooseSupply: no frontier steps remaining");
    return null;
  }
  log("chooseSupply: evaluating frontier", {
    label: frontier.label,
    currentHeight: grid[frontier.cell.x][frontier.cell.z],
    targetHeight: frontier.targetHeight,
    agentPos,
  });
  const anchorIndex = stairs.findIndex((step) => step === frontier);
  const anchor = anchorIndex === 0 ? startCell : stairs[anchorIndex - 1].cell;
  let best: PlannedStep | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const supplyCells = supplySources.map((source) => source.cell);
  for (const cell of supplyCells) {
    const available = grid[cell.x][cell.z];
    if (available <= 0) {
      log("chooseSupply: skipping empty supply", { cell });
      continue;
    }
    const targetTop = cellTop(grid, cell);
    let bestApproach: {
      stand: Cell;
      standTop: Vec3;
      path: Vec3[];
      length: number;
    } | null = null;
    for (const offset of ADJACENT_OFFSETS) {
      const stand: Cell = { x: cell.x + offset.x, z: cell.z + offset.z };
      if (!inBounds(stand)) continue;
      const standTop = cellTop(grid, stand);
      log("chooseSupply: evaluating stand", { supply: cell, stand });
      const path = findPath(navMesh, agentPos, standTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
      if (!path.success || path.path.length === 0) {
        logWarn("chooseSupply: stand unreachable", { supply: cell, stand, agentPos });
        continue;
      }
      const points = pathToPoints(path);
      const length = pathLength(points);
      log("chooseSupply: candidate stand", {
        supply: cell,
        stand,
        pathLength: length,
        waypointCount: points.length,
      });
      if (!bestApproach || length < bestApproach.length) {
        bestApproach = { stand, standTop, path: points, length };
      }
    }
    if (!bestApproach) {
      logWarn("chooseSupply: no adjacent stand positions reachable", { supply: cell, agentPos });
      continue;
    }
    if (bestApproach.length < bestDist) {
      bestDist = bestApproach.length;
      best = {
        supply: cell,
        supplyTop: targetTop,
        stand: bestApproach.stand,
        standTop: bestApproach.standTop,
        frontier,
        anchor,
        pathToStand: bestApproach.path,
      };
    }
  }
  if (!best) {
    logWarn("chooseSupply: no reachable supplies for frontier", {
      frontier: frontier.label,
      agentPos,
    });
  } else {
    log("chooseSupply: selected supply", {
      frontier: frontier.label,
      supply: best.supply,
      stand: best.stand,
      anchor,
      distance: bestDist,
    });
  }
  return best;
};

const GLOBAL_PLAN_MAX_ITERATIONS_BASE = 16;
const GLOBAL_PLAN_MAX_ITERATIONS_PER_STEP = 8;

const computeGlobalPlanIterationLimit = (ctx: BlockWorldContext) =>
  Math.max(
    GLOBAL_PLAN_MAX_ITERATIONS_BASE,
    GLOBAL_PLAN_MAX_ITERATIONS_BASE + ctx.stairs.length * GLOBAL_PLAN_MAX_ITERATIONS_PER_STEP,
  );

const findAdjacentPlacementMove = (
  grid: number[][],
  navMesh: NavMesh,
  agentPos: Vec3,
  frontierCell: Cell,
): { path: Vec3[]; targetPos: Vec3; adjacentCell: Cell; targetHeight: number; adjacentHeight: number } | null => {
  const frontierHeight = grid[frontierCell.x][frontierCell.z];
  for (const offset of ADJACENT_OFFSETS) {
    const adjacentCell: Cell = { x: frontierCell.x + offset.x, z: frontierCell.z + offset.z };
    if (!inBounds(adjacentCell)) continue;

    const adjacentHeight = grid[adjacentCell.x][adjacentCell.z];
    const targetHeight = Math.max(adjacentHeight, frontierHeight);
    if (targetHeight > adjacentHeight + 1) continue;

    const top = cellTop(grid, adjacentCell);
    const targetPos: Vec3 = [top[0], targetHeight * BLOCK_SIZE, top[2]];
    const path = findPath(navMesh, agentPos, targetPos, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
    if (!path.success || path.path.length === 0) continue;
    if (targetHeight < frontierHeight || targetHeight > frontierHeight + 1) continue;

    return {
      path: pathToPoints(path),
      targetPos,
      adjacentCell,
      targetHeight,
      adjacentHeight,
    };
  }
  return null;
};

const planNavigateToAdjacent = (ctx: BlockWorldContext, step: PlannedStep): boolean => {
  const move = findAdjacentPlacementMove(ctx.grid, ctx.navMesh, ctx.agentPos, step.frontier.cell);
  if (!move) {
    return false;
  }

  ctx.actionQueue.push({
    type: "navigate",
    path: move.path,
    description: `Move to position adjacent to ${step.frontier.label}`,
    targetPosition: move.targetPos,
  });
  ctx.agentPos = move.targetPos;
  log("global-plan: navigate adjacent", {
    frontier: step.frontier.label,
    adjacentCell: move.adjacentCell,
    targetHeight: move.targetHeight,
    adjacentHeight: move.adjacentHeight,
    agentPos: [...ctx.agentPos],
  });
  return true;
};

const planAnchorNavigate = (ctx: BlockWorldContext, step: PlannedStep): boolean => {
  const anchorTop = cellTop(ctx.grid, step.anchor);
  if (distance3(ctx.agentPos, anchorTop) < 1e-3) {
    return true;
  }
  const path = findPath(ctx.navMesh, ctx.agentPos, anchorTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
  if (!path.success || path.path.length === 0) {
    logWarn("global-plan: anchor unreachable", {
      anchor: step.anchor,
      agentPos: [...ctx.agentPos],
      frontier: step.frontier.label,
    });
    return false;
  }
  ctx.actionQueue.push({
    type: "navigate",
    path: pathToPoints(path),
    description: `Carry block to ${step.frontier.label} staging cell`,
    targetPosition: anchorTop,
  });
  ctx.agentPos = anchorTop;
  return true;
};

export const navcatBlockDomain = (() => {
  const builder = new DomainBuilder<BlockWorldContext>("BlockStacker");
  builder.select("AchieveGoal");
  builder
    .sequence("GlobalPlanToGoal")
    .action("Plan full staircase and climb")
    .do(() => TaskStatus.Success)
    .effect("Plan global action queue", "planonly", (context: BlockWorldContext) => {
      const simGrid = cloneGrid(context.grid);
      let simNavMesh = context.navMesh;
      let simAgentPos = [...context.agentPos] as Vec3;
      let simCarrying = context.carrying;
      const plannedActions: PlannedAction[] = [];
      const iterationLimit = computeGlobalPlanIterationLimit(context);
      let success = false;

      for (let iteration = 0; iteration < iterationLimit; iteration += 1) {
        const frontier = getFrontierForStairs(simGrid, context.stairs);

        if (!frontier) {
          if (hasAgentReachedGoal(simGrid, simAgentPos, context.goalCell)) {
            success = true;
            break;
          }
          const goalTop = cellTop(simGrid, context.goalCell);
          const pathResult = findPath(simNavMesh, simAgentPos, goalTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
          if (!pathResult.success || pathResult.path.length === 0) {
            logWarn("global-plan: goal path unavailable", {
              iteration,
              agentPos: [...simAgentPos],
              goalCell: context.goalCell,
            });
            break;
          }
          const points = pathToPoints(pathResult);
          if (points.length > 0) {
            plannedActions.push({
              type: "navigate",
              description: "Climb to the tower top",
              path: points,
              targetPosition: goalTop,
            });
          }
          simAgentPos = [...goalTop];
          success = hasAgentReachedGoal(simGrid, simAgentPos, context.goalCell);
          break;
        }

        const step = chooseSupplyForState({
          grid: simGrid,
          navMesh: simNavMesh,
          agentPos: simAgentPos,
          stairs: context.stairs,
          supplySources: context.supplySources,
          startCell: context.startCell,
        });

        if (!step) {
          logWarn("global-plan: unable to select supply for frontier", {
            iteration,
            agentPos: [...simAgentPos],
          });
          break;
        }

        if (step.pathToStand.length > 0) {
          plannedActions.push({
            type: "navigate",
            path: step.pathToStand,
            description: `Walk to supply crate at (${step.supply.x}, ${step.supply.z})`,
            targetPosition: [...step.standTop],
          });
        }
        simAgentPos = [...step.standTop];

        simGrid[step.supply.x][step.supply.z] -= 1;
        simCarrying = true;
        simNavMesh = buildNavMeshForGrid(simGrid);
        plannedActions.push({
          type: "pick",
          cell: step.supply,
          worldPosition: step.supplyTop,
          description: `Pick block at (${step.supply.x}, ${step.supply.z})`,
        });

        let usedAnchor = false;
        if (!canPlaceDirectlyOnAdjacent(simGrid, simAgentPos, simCarrying, step.frontier.cell)) {
          const move = findAdjacentPlacementMove(simGrid, simNavMesh, simAgentPos, step.frontier.cell);
          if (move) {
            plannedActions.push({
              type: "navigate",
              path: move.path,
              description: `Move to position adjacent to ${step.frontier.label}`,
              targetPosition: move.targetPos,
            });
            simAgentPos = [...move.targetPos];
          } else {
            const anchorTop = cellTop(simGrid, step.anchor);
            const anchorPath = findPath(simNavMesh, simAgentPos, anchorTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
            if (!anchorPath.success || anchorPath.path.length === 0) {
              logWarn("global-plan: anchor unreachable", {
                iteration,
                anchor: step.anchor,
                agentPos: [...simAgentPos],
                frontier: step.frontier.label,
              });
              success = false;
              usedAnchor = false;
              break;
            }
            plannedActions.push({
              type: "navigate",
              path: pathToPoints(anchorPath),
              description: `Carry block to ${step.frontier.label} staging cell`,
              targetPosition: anchorTop,
            });
            simAgentPos = [...anchorTop];
            usedAnchor = true;
          }
        }

        if (canPlaceDirectlyOnAdjacent(simGrid, simAgentPos, simCarrying, step.frontier.cell)) {
          simGrid[step.frontier.cell.x][step.frontier.cell.z] += 1;
          simCarrying = false;
          simNavMesh = buildNavMeshForGrid(simGrid);
          const top = cellTop(simGrid, step.frontier.cell);
          plannedActions.push({
            type: "place",
            cell: step.frontier.cell,
            worldPosition: top,
            description: `Place block on top of ${step.frontier.label}`,
          });
        } else {
          if (!usedAnchor) {
            const anchorTop = cellTop(simGrid, step.anchor);
            const anchorPath = findPath(simNavMesh, simAgentPos, anchorTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
            if (!anchorPath.success || anchorPath.path.length === 0) {
              logWarn("global-plan: fallback anchor unreachable", {
                iteration,
                anchor: step.anchor,
                agentPos: [...simAgentPos],
                frontier: step.frontier.label,
              });
              break;
            }
            plannedActions.push({
              type: "navigate",
              path: pathToPoints(anchorPath),
              description: `Carry block to ${step.frontier.label} staging cell`,
              targetPosition: anchorTop,
            });
            simAgentPos = [...anchorTop];
          }
          simGrid[step.frontier.cell.x][step.frontier.cell.z] += 1;
          simCarrying = false;
          simNavMesh = buildNavMeshForGrid(simGrid);
          const top = cellTop(simGrid, step.frontier.cell);
          plannedActions.push({
            type: "place",
            cell: step.frontier.cell,
            worldPosition: top,
            description: `Stack block for ${step.frontier.label}`,
          });
          context.pendingStep = null;
        }
      }

      if (success) {
        context.actionQueue.push(...plannedActions);
        context.grid = simGrid;
        context.navMesh = simNavMesh;
        context.agentPos = simAgentPos;
        context.carrying = simCarrying;
      }
      context.pendingStep = null;
    })
    .end()
    .end();
  builder
    .sequence("ReachDirect")
    .condition("Goal reachable", (ctx) => {
      if (getFrontierForStairs(ctx.grid, ctx.stairs)) {
        return false;
      }
      const goalTop = cellTop(ctx.grid, ctx.goalCell);
      const { reachable, path } = canReachGoal(ctx);
      if (reachable) {
        ctx.actionQueue.push({
          type: "navigate",
          description: "Climb to the tower top",
          path,
          targetPosition: goalTop,
        });
      }
      return reachable;
    })
    .action("Direct climb available")
    .do(() => TaskStatus.Success)
    .end()
    .end();

  builder
    .sequence("ClimbCompletedSteps")
    .condition("Steps built", (ctx) => getFrontierForStairs(ctx.grid, ctx.stairs) === null)
    .action("Plan climb along completed steps")
    .do(() => TaskStatus.Success)
    .effect("Navigate steps", "planonly", (context: BlockWorldContext) => {
      const completed = context.stairs.filter((step) => context.grid[step.cell.x][step.cell.z] >= step.targetHeight);
      if (completed.length === 0) return;
      const pending: { description: string; points: Vec3[]; target: Vec3 }[] = [];
      let currentPos = [...context.agentPos] as Vec3;

      const planNavigate = (targetCell: Cell, description: string) => {
        const targetTop = cellTop(context.grid, targetCell);
        if (distance3(currentPos, targetTop) < 1e-3) {
          currentPos = targetTop;
          return true;
        }
        const pathResult = findPath(context.navMesh, currentPos, targetTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
        if (!pathResult.success || pathResult.path.length === 0) {
          logWarn("ClimbCompletedSteps: navmesh path unavailable", {
            from: [...currentPos],
            targetCell,
          });
          return false;
        }
        const points = pathToPoints(pathResult);
        pending.push({ description, points, target: targetTop });
        currentPos = [...targetTop];
        return true;
      };

      for (const step of completed) {
        const ok = planNavigate(step.cell, `Walk existing ${step.label}`);
        if (!ok) {
          pending.length = 0;
          break;
        }
      }

      if (pending.length === 0) {
        return;
      }

      const goalTop = cellTop(context.grid, context.goalCell);
      if (distance3(currentPos, goalTop) >= 1e-3) {
        const ok = planNavigate(context.goalCell, "Climb to goal top");
        if (!ok) {
          return;
        }
      }

      for (const entry of pending) {
        context.actionQueue.push({
          type: "navigate",
          description: entry.description,
          path: entry.points,
          targetPosition: entry.target,
        });
      }
      context.agentPos = [...goalTop];
    })
    .end()
    .end();

  builder
    .sequence("BuildStep")
    .condition("Need more steps", (ctx) => {
      const frontier = getFrontierForStairs(ctx.grid, ctx.stairs);
      if (!frontier) return false;
      ctx.pendingStep = chooseSupply(ctx);
      return ctx.pendingStep !== null;
    })
    .action("Navigate to supply")
    .condition("Supply chosen", (ctx) => ctx.pendingStep !== null)
    .do(() => TaskStatus.Success)
    .effect("Plan navigate to supply", "planonly", (context: BlockWorldContext) => {
      const step = context.pendingStep;
      if (!step) {
        logError("domain: missing pendingStep in navigate effect");
        return;
      }
      log("domain: enqueue navigate", {
        supply: step.supply,
        stand: step.stand,
        pathLength: step.pathToStand.length,
      });
      context.agentPos = [...step.standTop];
      context.actionQueue.push({
        type: "navigate",
        path: step.pathToStand,
        description: `Walk to supply crate at (${step.supply.x}, ${step.supply.z})`,
        targetPosition: [...step.standTop],
      });
    })
    .end()
    .action("Pick block")
    .condition("Ready to pick", (ctx) => ctx.pendingStep !== null && !ctx.carrying)
    .do(() => TaskStatus.Success)
    .effect("Plan pick block", "planonly", (context: BlockWorldContext) => {
      const step = context.pendingStep;
      if (!step) {
        logError("domain: missing pendingStep in pick effect");
        return;
      }
      const { supply } = step;
      log("domain: simulate pick", {
        supply,
        remaining: context.grid[supply.x][supply.z] - 1,
      });
      context.grid[supply.x][supply.z] -= 1;
      context.carrying = true;
      context.navMesh = buildNavMeshForGrid(context.grid);
      context.actionQueue.push({
        type: "pick",
        cell: supply,
        worldPosition: step.supplyTop,
        description: `Pick block at (${supply.x}, ${supply.z})`,
      });
    })
    .end()
    .action("Navigate to position adjacent to frontier")
    .condition("Carrying block", (ctx) => ctx.pendingStep !== null && ctx.carrying)
    .condition("Not already adjacent", (ctx) => {
      const step = ctx.pendingStep;
      if (!step) return false;
      return !canPlaceDirectlyOnAdjacent(ctx.grid, ctx.agentPos, ctx.carrying, step.frontier.cell);
    })
    .condition("Adjacent position reachable", (ctx) => {
      const step = ctx.pendingStep;
      if (!step) return false;
      const frontierCell = step.frontier.cell;
      const frontierHeight = ctx.grid[frontierCell.x][frontierCell.z];
      
      // Try to find an adjacent position where agent can place directly
      // Agent can place if they're at height >= frontierHeight and <= frontierHeight + 1
      for (const offset of ADJACENT_OFFSETS) {
        const adjacentCell: Cell = { x: frontierCell.x + offset.x, z: frontierCell.z + offset.z };
        if (!inBounds(adjacentCell)) continue;
        
        const adjacentHeight = ctx.grid[adjacentCell.x][adjacentCell.z];
        // Try standing on adjacent cell at its height
        // Agent can place if: adjacentHeight >= frontierHeight (can reach over to place)
        // OR if adjacentHeight + 1 == frontierHeight (can place from 1 block above)
        // But we can only stand on existing blocks, so we need adjacentHeight >= frontierHeight
        // OR we can try standing 1 block above the adjacent cell if that would put us at the right height
        const targetHeight = Math.max(adjacentHeight, frontierHeight);
        // Make sure target height is reasonable (not more than 1 block above adjacent)
        if (targetHeight > adjacentHeight + 1) continue;
        
        const targetTop = cellTop(ctx.grid, adjacentCell);
        const targetPos: Vec3 = [targetTop[0], targetHeight * BLOCK_SIZE, targetTop[2]];
        const path = findPath(ctx.navMesh, ctx.agentPos, targetPos, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
        if (path.success && path.path.length > 0) {
          // Verify this position would allow direct placement
          if (targetHeight >= frontierHeight && targetHeight <= frontierHeight + 1) {
            ctx.actionQueue.push({
              type: "navigate",
              path: pathToPoints(path),
              description: `Move to position adjacent to ${step.frontier.label}`,
              targetPosition: targetPos,
            });
            ctx.agentPos = targetPos;
            log("domain: navigate to adjacent position", {
              adjacentCell,
              targetHeight,
              adjacentHeight,
              frontierHeight,
              agentPos: [...ctx.agentPos],
            });
            return true;
          }
        }
      }
      return false;
    })
    .do(() => TaskStatus.Success)
    .end()
    .action("Place directly on adjacent")
    .condition("Carrying block", (ctx) => ctx.pendingStep !== null && ctx.carrying)
    .condition("Can place directly", (ctx) => {
      const step = ctx.pendingStep;
      if (!step) return false;
      const canPlace = canPlaceDirectlyOnAdjacent(ctx.grid, ctx.agentPos, ctx.carrying, step.frontier.cell);
      if (canPlace) {
        log("domain: can place directly on adjacent", {
          agentPos: [...ctx.agentPos],
          agentCell: getAgentCell(ctx.agentPos),
          frontier: step.frontier.cell,
          agentHeight: getAgentHeight(ctx.grid, ctx.agentPos),
          frontierHeight: ctx.grid[step.frontier.cell.x][step.frontier.cell.z],
        });
      }
      return canPlace;
    })
    .do(() => TaskStatus.Success)
    .effect("Plan place directly on adjacent", "planonly", (context: BlockWorldContext) => {
      const step = context.pendingStep;
      if (!step) {
        logError("domain: missing pendingStep in direct place effect");
        return;
      }
      const { frontier } = step;
      log("domain: simulate place directly on adjacent", {
        frontier: frontier.label,
        agentPos: [...context.agentPos],
        newHeight: context.grid[frontier.cell.x][frontier.cell.z] + 1,
      });
      context.grid[frontier.cell.x][frontier.cell.z] += 1;
      context.carrying = false;
      context.navMesh = buildNavMeshForGrid(context.grid);
      const top = cellTop(context.grid, frontier.cell);
      context.actionQueue.push({
        type: "place",
        cell: frontier.cell,
        worldPosition: top,
        description: `Place block on top of ${frontier.label}`,
      });
      context.pendingStep = null;
    })
    .end()
    .action("Navigate to anchor")
    .condition("Still carrying", (ctx) => ctx.pendingStep !== null && ctx.carrying)
    .condition("Not already adjacent", (ctx) => {
      const step = ctx.pendingStep;
      if (!step) return false;
      // Skip this if we can place directly
      return !canPlaceDirectlyOnAdjacent(ctx.grid, ctx.agentPos, ctx.carrying, step.frontier.cell);
    })
    .condition("Anchor reachable", (ctx) => {
      const step = ctx.pendingStep;
      if (!step) {
        logError("domain: missing pendingStep in anchor reachability");
        return false;
      }
      const anchorTop = cellTop(ctx.grid, step.anchor);
      const path = findPath(ctx.navMesh, ctx.agentPos, anchorTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
      if (!path.success || path.path.length === 0) return false;
      ctx.actionQueue.push({
        type: "navigate",
        path: pathToPoints(path),
        description: `Carry block to ${step.frontier.label} staging cell`,
        targetPosition: anchorTop,
      });
      ctx.agentPos = anchorTop;
      return true;
    })
    .do(() => TaskStatus.Success)
    .end()
    .action("Place block")
    .condition("Carrying block", (ctx) => ctx.pendingStep !== null && ctx.carrying)
    .do(() => TaskStatus.Success)
    .effect("Plan place block", "planonly", (context: BlockWorldContext) => {
      const step = context.pendingStep;
      if (!step) {
        logError("domain: missing pendingStep in place effect");
        return;
      }
      const { frontier } = step;
      log("domain: simulate place", {
        frontier: frontier.label,
        newHeight: context.grid[frontier.cell.x][frontier.cell.z] + 1,
      });
      context.grid[frontier.cell.x][frontier.cell.z] += 1;
      context.carrying = false;
      context.navMesh = buildNavMeshForGrid(context.grid);
      const top = cellTop(context.grid, frontier.cell);
      context.actionQueue.push({
        type: "place",
        cell: frontier.cell,
        worldPosition: top,
        description: `Stack block for ${frontier.label}`,
      });
    })
    .end()
    .end();

  builder.end();
  return builder.build();
})();

export const createInitialGrid = (config?: HeadlessRunConfig) => {
  const goalCell = config?.goalCell ?? GOAL_CELL;
  const goalHeight = config?.goalHeight ?? GOAL_HEIGHT;
  const supplySources = config?.supplySources ?? SUPPLY_SOURCES;
  const initialHeights = config?.initialHeights ?? [];
  const grid: number[][] = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
  grid[goalCell.x][goalCell.z] = goalHeight;
  for (const source of supplySources) {
    grid[source.cell.x][source.cell.z] = source.height;
  }
  for (const entry of initialHeights) {
    grid[entry.cell.x][entry.cell.z] = entry.height;
  }
  return grid;
};

export const runNavcatBlockStackerHeadless = (config?: HeadlessRunConfig): HeadlessRunResult => {
  const startCell = config?.startCell ?? START_CELL;
  const goalCell = config?.goalCell ?? GOAL_CELL;
  const stairs = config?.stairs ?? STAIRS;
  const maxIterations = config?.maxIterations ?? 1000;
  const initialGrid = createInitialGrid(config);
  const world: {
    grid: number[][];
    agentPos: Vec3;
    carrying: boolean;
    navMesh: NavMesh;
  } = {
    grid: initialGrid,
    agentPos: cellTop(initialGrid, startCell),
    carrying: false,
    navMesh: buildNavMeshForGrid(initialGrid),
  };

  const allActions: PlannedAction[] = [];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration += 1;
    const currentFrontier = getFrontierForStairs(world.grid, stairs);
    log("planner: iteration start", {
      iteration,
      carrying: world.carrying,
      agentPos: [...world.agentPos],
      frontier: currentFrontier ? currentFrontier.label : null,
    });

    const { reachable } = canReachGoal(
      new BlockWorldContext(
        { grid: cloneGrid(world.grid), agentPos: [...world.agentPos] as Vec3, carrying: world.carrying },
        world.navMesh,
        config,
      ),
    );

    log("planner: direct goal check", {
      iteration,
      reachable,
      distanceToGoal: distance3(world.agentPos, cellTop(world.grid, goalCell)),
    });

    const goalTop = cellTop(world.grid, goalCell);
    // Check if agent is close enough to goal (nearly centered on the goal column at the right height)
    const goalReached = currentFrontier === null && hasAgentReachedGoal(world.grid, world.agentPos, goalCell);

    if (goalReached) {
      log("planner: goal reached", { iteration });
      return {
        reachedGoal: true,
        actions: allActions,
        finalGrid: cloneGrid(world.grid),
        finalAgentPos: [...world.agentPos] as Vec3,
        iterations: iteration,
      };
    }

    const planningGrid = cloneGrid(world.grid);
    const planningContext = new BlockWorldContext(
      { grid: planningGrid, agentPos: [...world.agentPos] as Vec3, carrying: world.carrying },
      world.navMesh,
      config,
    );

    log("planner: searching for plan", { iteration });
    const planResult = navcatBlockDomain.findPlan(planningContext);

    log("planner: plan result", {
      iteration,
      actionCount: planningContext.actionQueue.length,
      pendingStep: planningContext.pendingStep,
      taskNames: planResult.plan.map((task) => task.Name ?? ""),
      status: planResult.status,
    });

    if (planningContext.actionQueue.length === 0) {
      logError("planner: no actions produced", {
        iteration,
        carrying: world.carrying,
        agentPos: [...world.agentPos],
      });
      return {
        reachedGoal: false,
        actions: allActions,
        finalGrid: cloneGrid(world.grid),
        finalAgentPos: [...world.agentPos] as Vec3,
        iterations: iteration,
      };
    }

    for (const action of planningContext.actionQueue) {
      log("planner: executing action", { iteration, action });
      allActions.push(action);

      if (action.type === "navigate") {
        const destination = action.targetPosition ?? action.path[action.path.length - 1];
        world.agentPos = [...destination] as Vec3;
        log("planner: navigate complete", {
          iteration,
          description: action.description,
          newAgentPos: [...world.agentPos],
          carrying: world.carrying,
        });
      } else if (action.type === "pick") {
        log("planner: picking block", {
          iteration,
          cell: action.cell,
          beforeHeight: world.grid[action.cell.x][action.cell.z],
        });
        world.grid[action.cell.x][action.cell.z] -= 1;
        world.carrying = true;
        world.navMesh = buildNavMeshForGrid(world.grid);
        log("planner: pick complete", {
          iteration,
          cell: action.cell,
          afterHeight: world.grid[action.cell.x][action.cell.z],
          carrying: world.carrying,
        });
      } else if (action.type === "place") {
        log("planner: placing block", {
          iteration,
          cell: action.cell,
          beforeHeight: world.grid[action.cell.x][action.cell.z],
        });
        world.grid[action.cell.x][action.cell.z] += 1;
        world.carrying = false;
        world.navMesh = buildNavMeshForGrid(world.grid);
        if (action.cell.x === goalCell.x && action.cell.z === goalCell.z) {
          world.agentPos = cellTop(world.grid, goalCell);
        }
        log("planner: place complete", {
          iteration,
          cell: action.cell,
          afterHeight: world.grid[action.cell.x][action.cell.z],
          carrying: world.carrying,
        });
      }
    }
  }

  return {
    reachedGoal: false,
    actions: allActions,
    finalGrid: cloneGrid(world.grid),
    finalAgentPos: [...world.agentPos] as Vec3,
    iterations: iteration,
  };
};

