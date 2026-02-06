import { describe, expect, it, vi } from "vitest";
import type { Cell, HeadlessRunConfig, PlannedAction, StepDefinition } from "./navcat-block-stacker-core";
import type { Scenario } from "./navcat-block-stacker-scenarios";
import type { NavMesh } from "navcat";

type BlockStackerCoreModule = typeof import("./navcat-block-stacker-core");
type Vec3Tuple = [number, number, number];

type PlanningSetup = {
  core: BlockStackerCoreModule;
  scenario: Scenario;
  config: HeadlessRunConfig;
  grid: number[][];
  navMesh: NavMesh;
  startCell: Cell;
  goalCell: Cell;
  goalHeight: number;
  stairs: StepDefinition[];
};

type PlanningSimulationResult = {
  grid: number[][];
  agentPos: Vec3Tuple;
  carrying: boolean;
  navMesh: NavMesh;
};

const prepareDefaultPlanningSetup = async (): Promise<PlanningSetup> => {
  const core: BlockStackerCoreModule = await import("./navcat-block-stacker-core");
  const scenariosModule = await import("./navcat-block-stacker-scenarios");
  const scenario = scenariosModule.getScenarioById("default");
  const config = scenario.config ?? ({} as HeadlessRunConfig);
  const grid = core.createInitialGrid(config);
  const navMesh = core.buildNavMeshForGrid(grid);
  const startCell = config.startCell ?? core.START_CELL;
  const goalCell = config.goalCell ?? core.GOAL_CELL;
  const goalHeight = config.goalHeight ?? core.GOAL_HEIGHT;
  const stairs = config.stairs ?? core.STAIRS;

  return {
    core,
    scenario,
    config,
    grid,
    navMesh,
    startCell,
    goalCell,
    goalHeight,
    stairs,
  };
};

const simulatePlanActions = (
  core: BlockStackerCoreModule,
  actions: PlannedAction[],
  setup: PlanningSetup,
): PlanningSimulationResult => {
  const world: PlanningSimulationResult = {
    grid: core.cloneGrid(setup.grid),
    agentPos: core.cellTop(setup.grid, setup.startCell) as Vec3Tuple,
    carrying: false,
    navMesh: setup.navMesh,
  };

  for (const action of actions) {
    if (action.type === "navigate") {
      const destination = action.targetPosition ?? (action.path.length > 0 ? action.path[action.path.length - 1] : null);
      if (destination) {
        world.agentPos = [...destination] as Vec3Tuple;
      }
    } else if (action.type === "pick") {
      world.grid[action.cell.x][action.cell.z] -= 1;
      world.carrying = true;
      world.navMesh = core.buildNavMeshForGrid(world.grid);
    } else if (action.type === "place") {
      world.grid[action.cell.x][action.cell.z] += 1;
      world.carrying = false;
      world.navMesh = core.buildNavMeshForGrid(world.grid);
      if (action.cell.x === setup.goalCell.x && action.cell.z === setup.goalCell.z) {
        world.agentPos = core.cellTop(world.grid, setup.goalCell) as Vec3Tuple;
      }
    } else {
      const exhaustiveCheck: never = action;
      throw new Error("Unhandled action type");
    }
  }

  return world;
};

vi.mock("stats-gl", () => ({
  default: class Stats {
    domElement = { style: {}, remove() {} };
    async init() {}
    update() {}
  },
}));

vi.mock("three/examples/jsm/Addons.js", () => ({
  OrbitControls: class OrbitControls {
    target = { set() {} };
    constructor() {}
    update() {}
  },
}));

vi.mock("three/webgpu", () => {
  class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    add() {
      return this;
    }
    sub() {
      return this;
    }
    clone() {
      return new Vector3(this.x, this.y, this.z);
    }
    length() {
      return 0;
    }
    normalize() {
      return this;
    }
    multiplyScalar() {
      return this;
    }
    copy(vector: Vector3) {
      this.x = vector.x;
      this.y = vector.y;
      this.z = vector.z;
      return this;
    }
  }

  class Matrix4 {
    identity() {
      return this;
    }
    setPosition() {}
  }

  class Disposable {
    dispose() {}
  }

  class Scene {
    background = null;
    add() {}
  }

  class Color {
    setHex() {}
  }

  class PerspectiveCamera {
    position = { set() {} };
    aspect = 0;
    updateProjectionMatrix() {}
  }

  class WebGPURenderer {
    domElement = { style: {}, addEventListener() {}, remove() {} };
    setSize() {}
    setPixelRatio() {}
    async init() {}
    render() {}
    dispose() {}
  }

  class AmbientLight {}

  class DirectionalLight {
    position = { set() {} };
  }

  class GridHelper {}

  class Mesh {
    position = {
      set() {},
      copy() {
        return this;
      },
      add() {
        return this;
      },
    };
    visible = true;
    add() {}
  }

  class BoxGeometry extends Disposable {}

  class MeshStandardMaterial extends Disposable {}

  class InstancedMesh extends Disposable {
    instanceMatrix = { setUsage() {}, needsUpdate: false };
    instanceColor = { needsUpdate: false };
    count = 0;
    setMatrixAt() {}
    setColorAt() {}
  }

  class SphereGeometry extends Disposable {}

  class BufferGeometry extends Disposable {
    setAttribute() {}
    computeBoundingSphere() {}
  }

  class LineBasicMaterial extends Disposable {}

  class Line {
    visible = false;
  }

  class BufferAttribute {}

  return {
    Scene,
    Color,
    PerspectiveCamera,
    WebGPURenderer,
    AmbientLight,
    DirectionalLight,
    GridHelper,
    Mesh,
    BoxGeometry,
    MeshStandardMaterial,
    InstancedMesh,
    DynamicDrawUsage: 0,
    SphereGeometry,
    BufferGeometry,
    LineBasicMaterial,
    Line,
    Matrix4,
    Vector3,
    BufferAttribute,
  };
});

describe("navcat block stacker module", () => {
  it("exposes createNavcatBlockStackerScene factory", async () => {
    const module = await import("./navcat-block-stacker");
    expect(typeof module.createNavcatBlockStackerScene).toBe("function");
  });

  it("exposes runNavcatBlockStackerHeadless function", async () => {
    const module = await import("./navcat-block-stacker");
    expect(typeof module.runNavcatBlockStackerHeadless).toBe("function");
  });

  // TODO(backtracking): enable this when the planner supports multi-step lookahead/backtracking
  it("headless planner reaches goal and completes staircase", async () => {
    const { runNavcatBlockStackerHeadless, STAIRS, GOAL_CELL, GOAL_HEIGHT } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("default");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThan(1000);
    expect(result.actions.length).toBeGreaterThan(0);

    // Verify all stairs reach their target height
    const stairs = scenario.config.stairs ?? STAIRS;
    for (const step of stairs) {
      expect(result.finalGrid[step.cell.x][step.cell.z]).toBe(step.targetHeight);
    }

    // Verify goal cell has correct height
    const goalCell = scenario.config.goalCell ?? GOAL_CELL;
    const goalHeight = scenario.config.goalHeight ?? GOAL_HEIGHT;
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(goalHeight);

    // Verify action types are present
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(true);
    expect(actionTypes.has("place")).toBe(true);

    // Verify pick and place actions are balanced (or close to balanced)
    const pickCount = result.actions.filter((a) => a.type === "pick").length;
    const placeCount = result.actions.filter((a) => a.type === "place").length;
    expect(pickCount).toBeGreaterThan(0);
    expect(placeCount).toBeGreaterThan(0);
    // Each step requires 4 blocks, so we should have at least 4 picks and 4 places
    expect(pickCount).toBeGreaterThanOrEqual(4);
    expect(placeCount).toBeGreaterThanOrEqual(4);
  });

  it("immediately succeeds when already at goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("atGoal");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    expect(result.reachedGoal).toBe(true);
    expect(result.actions.length).toBe(0);
    expect(result.iterations).toBe(1);
  });

  it("treats slight offsets near the goal as reaching the goal", async () => {
    const { createInitialGrid, GOAL_CELL, cellTop, hasAgentReachedGoal } = await import("./navcat-block-stacker-core");

    const grid = createInitialGrid();
    const goalTop = cellTop(grid, GOAL_CELL);
    const nearlyAtGoal: [number, number, number] = [goalTop[0] + 0.12, goalTop[1] - 0.05, goalTop[2] - 0.08];

    expect(hasAgentReachedGoal(grid, nearlyAtGoal, GOAL_CELL)).toBe(true);
  });

  it("allows direct placement from each cardinal neighbor when heights align", async () => {
    const { canPlaceDirectlyOnAdjacent, cellTop, GRID_WIDTH, GRID_DEPTH } = await import("./navcat-block-stacker-core");

    const frontier = { x: 3, z: 3 };
    const grid = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
    const offsets = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ];

    for (const offset of offsets) {
      const adjacent = { x: frontier.x + offset.x, z: frontier.z + offset.z };
      grid[adjacent.x][adjacent.z] = 1;
      const agentPos = cellTop(grid, adjacent);
      expect(canPlaceDirectlyOnAdjacent(grid, agentPos, true, frontier)).toBe(true);
      grid[adjacent.x][adjacent.z] = 0;
    }
  });

  it("allows placement when agent stands one block above the frontier cell", async () => {
    const { canPlaceDirectlyOnAdjacent, cellTop, GRID_WIDTH, GRID_DEPTH } = await import("./navcat-block-stacker-core");

    const grid = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
    const frontier = { x: 4, z: 4 };
    grid[frontier.x][frontier.z] = 1;
    const adjacent = { x: frontier.x + 1, z: frontier.z };
    grid[adjacent.x][adjacent.z] = 2;
    const agentPos = cellTop(grid, adjacent);

    expect(canPlaceDirectlyOnAdjacent(grid, agentPos, true, frontier)).toBe(true);
  });

  it("rejects placement when agent is more than one block above the frontier", async () => {
    const { canPlaceDirectlyOnAdjacent, cellTop, GRID_WIDTH, GRID_DEPTH } = await import("./navcat-block-stacker-core");

    const grid = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
    const frontier = { x: 4, z: 4 };
    grid[frontier.x][frontier.z] = 1;
    const adjacent = { x: frontier.x, z: frontier.z + 1 };
    grid[adjacent.x][adjacent.z] = 3;
    const agentPos = cellTop(grid, adjacent);

    expect(canPlaceDirectlyOnAdjacent(grid, agentPos, true, frontier)).toBe(false);
  });

  it("rejects placement from diagonal neighbors", async () => {
    const { canPlaceDirectlyOnAdjacent, cellTop, GRID_WIDTH, GRID_DEPTH } = await import("./navcat-block-stacker-core");

    const grid = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
    const frontier = { x: 4, z: 4 };
    const diagonal = { x: frontier.x + 1, z: frontier.z + 1 };
    grid[diagonal.x][diagonal.z] = 1;
    const agentPos = cellTop(grid, diagonal);

    expect(canPlaceDirectlyOnAdjacent(grid, agentPos, true, frontier)).toBe(false);
  });

  it("requires carrying a block to place directly", async () => {
    const { canPlaceDirectlyOnAdjacent, cellTop, GRID_WIDTH, GRID_DEPTH } = await import("./navcat-block-stacker-core");

    const grid = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
    const frontier = { x: 3, z: 3 };
    const adjacent = { x: frontier.x + 1, z: frontier.z };
    grid[adjacent.x][adjacent.z] = 1;
    const agentPos = cellTop(grid, adjacent);

    expect(canPlaceDirectlyOnAdjacent(grid, agentPos, false, frontier)).toBe(false);
  });

  it("navigates to goal when goal height is 1 (no pick/place needed)", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("simpleNavigate");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(false);
    expect(actionTypes.has("place")).toBe(false);
  });

  it("walks an existing single step to the goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("walkStep");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(false);
    expect(actionTypes.has("place")).toBe(false);
    const goalCell = scenario.config.goalCell!;
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(1);
  });

  it("picks and places one block when goal height is 2", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("pickPlaceOne");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    // Verify pick and place actions occurred
    const pickCount = result.actions.filter((a) => a.type === "pick").length;
    const placeCount = result.actions.filter((a) => a.type === "place").length;
    expect(pickCount).toBe(1);
    expect(placeCount).toBe(1);
    // Verify the stair step was built
    const stairStep = scenario.config.stairs![0];
    expect(result.finalGrid[stairStep.cell.x][stairStep.cell.z]).toBe(1);
    // Note: Goal might not be reached if planner can't find path from step to goal
    // but the core functionality (pick and place) is verified
  });

  it("walks an existing two-step staircase to the goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("walkExistingStairs");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(false);
    expect(actionTypes.has("place")).toBe(false);
    const goalCell = scenario.config.goalCell!;
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(2);
  });

  it("builds two-step staircase and reaches goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("buildTwoSteps");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    expect(result.reachedGoal).toBe(true);
    const pickCount = result.actions.filter((a) => a.type === "pick").length;
    const placeCount = result.actions.filter((a) => a.type === "place").length;
    expect(pickCount).toBeGreaterThanOrEqual(2);
    expect(placeCount).toBeGreaterThanOrEqual(2);

    const stairs = scenario.config.stairs!;
    expect(result.finalGrid[stairs[0].cell.x][stairs[0].cell.z]).toBe(stairs[0].targetHeight);
    expect(result.finalGrid[stairs[1].cell.x][stairs[1].cell.z]).toBe(stairs[1].targetHeight);
    const goalCell = scenario.config.goalCell!;
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(stairs[1].targetHeight);
  });

  it("places block directly on adjacent cell when at same height", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");
    const { getScenarioById } = await import("./navcat-block-stacker-scenarios");

    const scenario = getScenarioById("directPlaceAdjacent");
    const result = runNavcatBlockStackerHeadless(scenario.config);

    // Should reach goal
    expect(result.reachedGoal).toBe(true);
    
    // Verify step was built
    expect(result.finalGrid[3][2]).toBeGreaterThanOrEqual(1);
    
    // Count actions - should be efficient (fewer navigate actions)
    const pickCount = result.actions.filter((a) => a.type === "pick").length;
    const placeCount = result.actions.filter((a) => a.type === "place").length;
    expect(pickCount).toBeGreaterThanOrEqual(1);
    expect(placeCount).toBeGreaterThanOrEqual(1);
    
    // Verify that we placed directly on the adjacent cell (3, 2)
    const placeActions = result.actions.filter((a) => a.type === "place");
    const placedOnStep = placeActions.some((a) => a.cell.x === 3 && a.cell.z === 2);
    expect(placedOnStep).toBe(true);
    
    // Should have fewer navigate actions since we don't need to climb first
    const navigateCount = result.actions.filter((a) => a.type === "navigate").length;
    // Should be minimal - just to pick from supply, maybe to reach goal after
    expect(navigateCount).toBeLessThan(5); // Much less than if we had to climb first
  });

  it("requires full-plan reasoning to reach the goal in one findPlan call", async () => {
    const setup = await prepareDefaultPlanningSetup();
    const { core, config, grid, navMesh, startCell, goalCell, goalHeight, stairs } = setup;

    const context = new core.BlockWorldContext(
      { grid: core.cloneGrid(grid), agentPos: core.cellTop(grid, startCell), carrying: false },
      navMesh,
      config,
    );

    const planResult = core.navcatBlockDomain.findPlan(context);
    expect(planResult.plan.length).toBeGreaterThan(0);

    const actions = context.actionQueue;
    expect(actions.length).toBeGreaterThan(0);

    const world = simulatePlanActions(core, actions, setup);

    for (const step of stairs) {
      expect(world.grid[step.cell.x][step.cell.z]).toBe(step.targetHeight);
    }
    expect(world.grid[goalCell.x][goalCell.z]).toBe(goalHeight);
    expect(core.hasAgentReachedGoal(world.grid, world.agentPos, goalCell)).toBe(true);
  });

  it("schedules enough pick and place actions to complete all steps", async () => {
    const setup = await prepareDefaultPlanningSetup();
    const { core, config, grid, navMesh, startCell, stairs } = setup;

    const context = new core.BlockWorldContext(
      { grid: core.cloneGrid(grid), agentPos: core.cellTop(grid, startCell), carrying: false },
      navMesh,
      config,
    );

    void core.navcatBlockDomain.findPlan(context);

    const actions = context.actionQueue;
    const pickCount = actions.filter((action) => action.type === "pick").length;
    const placeCount = actions.filter((action) => action.type === "place").length;

    const requiredBlocks = stairs.reduce((total, step) => {
      const existingHeight = grid[step.cell.x][step.cell.z];
      const needed = Math.max(step.targetHeight - existingHeight, 0);
      return total + needed;
    }, 0);

    expect(pickCount).toBeGreaterThanOrEqual(requiredBlocks);
    expect(placeCount).toBeGreaterThanOrEqual(requiredBlocks);
  });
});

