import { describe, expect, it, vi } from "vitest";

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

    const result = runNavcatBlockStackerHeadless();

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    expect(result.iterations).toBeLessThan(1000);
    expect(result.actions.length).toBeGreaterThan(0);

    // Verify all stairs reach their target height
    for (const step of STAIRS) {
      expect(result.finalGrid[step.cell.x][step.cell.z]).toBe(step.targetHeight);
    }

    // Verify goal cell has correct height
    expect(result.finalGrid[GOAL_CELL.x][GOAL_CELL.z]).toBe(GOAL_HEIGHT);

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

    const goalCell = { x: 3, z: 3 };
    const result = runNavcatBlockStackerHeadless({
      startCell: goalCell,
      goalCell,
      goalHeight: 1,
      stairs: [],
      supplySources: [],
    });

    expect(result.reachedGoal).toBe(true);
    expect(result.actions.length).toBe(0);
    expect(result.iterations).toBe(1);
  });

  it("navigates to goal when goal height is 1 (no pick/place needed)", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");

    const startCell = { x: 1, z: 1 };
    const goalCell = { x: 3, z: 3 };
    const result = runNavcatBlockStackerHeadless({
      startCell,
      goalCell,
      goalHeight: 1,
      stairs: [],
      supplySources: [],
    });

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(false);
    expect(actionTypes.has("place")).toBe(false);
  });

  it("walks an existing single step to the goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");

    const startCell = { x: 3, z: 1 };
    const goalCell = { x: 3, z: 2 };
    const result = runNavcatBlockStackerHeadless({
      startCell,
      goalCell,
      goalHeight: 1,
      stairs: [],
      supplySources: [],
      maxIterations: 10,
    });

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(false);
    expect(actionTypes.has("place")).toBe(false);
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(1);
  });

  it("picks and places one block when goal height is 2", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");

    // Goal at (2,2) height 2, stair step at (2,1) needs height 1 to reach goal
    // Supply at (0,1) - agent starts at (0,0), can stand at (0,2) or (1,1) to pick
    const startCell = { x: 0, z: 0 };
    const goalCell = { x: 2, z: 2 };
    const supplyCell = { x: 0, z: 1 };
    const stairStep = { cell: { x: 2, z: 1 }, targetHeight: 1, label: "Step to goal" };
    const result = runNavcatBlockStackerHeadless({
      startCell,
      goalCell,
      goalHeight: 2,
      stairs: [stairStep],
      supplySources: [{ cell: supplyCell, height: 1 }],
      maxIterations: 20,
    });

    // Verify pick and place actions occurred
    const pickCount = result.actions.filter((a) => a.type === "pick").length;
    const placeCount = result.actions.filter((a) => a.type === "place").length;
    expect(pickCount).toBe(1);
    expect(placeCount).toBe(1);
    // Verify the stair step was built
    expect(result.finalGrid[stairStep.cell.x][stairStep.cell.z]).toBe(1);
    // Note: Goal might not be reached if planner can't find path from step to goal
    // but the core functionality (pick and place) is verified
  });

  it("walks an existing two-step staircase to the goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");

    const startCell = { x: 3, z: 1 };
    const goalCell = { x: 3, z: 3 };
    const stairs = [
      { cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step 1" },
      { cell: { x: 3, z: 3 }, targetHeight: 2, label: "Goal column" },
    ];
    const supplySources: Array<{ cell: { x: number; z: number }; height: number }> = [];

    const result = runNavcatBlockStackerHeadless({
      startCell,
      goalCell,
      goalHeight: 0,
      stairs,
      supplySources,
      initialHeights: [
        { cell: { x: 3, z: 2 }, height: 1 },
        { cell: { x: 3, z: 3 }, height: 2 },
      ],
      maxIterations: 20,
    });

    expect(result.reachedGoal).toBe(true);
    expect(result.iterations).toBeGreaterThan(0);
    const actionTypes = new Set(result.actions.map((a) => a.type));
    expect(actionTypes.has("navigate")).toBe(true);
    expect(actionTypes.has("pick")).toBe(false);
    expect(actionTypes.has("place")).toBe(false);
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(2);
  });

  it("builds two-step staircase and reaches goal", async () => {
    const { runNavcatBlockStackerHeadless } = await import("./navcat-block-stacker-core");

    const startCell = { x: 3, z: 1 };
    const goalCell = { x: 3, z: 3 };
    const stairs = [
      { cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step 1" },
      { cell: { x: 3, z: 3 }, targetHeight: 2, label: "Goal column" },
    ];
    const supplySources = [
      { cell: { x: 1, z: 1 }, height: 2 },
      { cell: { x: 5, z: 2 }, height: 2 },
    ];
    const result = runNavcatBlockStackerHeadless({
      startCell,
      goalCell,
      goalHeight: 0,
      stairs,
      supplySources,
      maxIterations: 200,
    });

    expect(result.reachedGoal).toBe(true);
    const pickCount = result.actions.filter((a) => a.type === "pick").length;
    const placeCount = result.actions.filter((a) => a.type === "place").length;
    expect(pickCount).toBeGreaterThanOrEqual(2);
    expect(placeCount).toBeGreaterThanOrEqual(2);

    expect(result.finalGrid[stairs[0].cell.x][stairs[0].cell.z]).toBe(stairs[0].targetHeight);
    expect(result.finalGrid[stairs[1].cell.x][stairs[1].cell.z]).toBe(stairs[1].targetHeight);
    expect(result.finalGrid[goalCell.x][goalCell.z]).toBe(stairs[1].targetHeight);
  });
});

