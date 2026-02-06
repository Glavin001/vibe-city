import type { HeadlessRunConfig } from "./navcat-block-stacker-core";

export type ScenarioId =
  | "default"
  | "atGoal"
  | "simpleNavigate"
  | "walkStep"
  | "pickPlaceOne"
  | "walkExistingStairs"
  | "buildTwoSteps"
  | "directPlaceAdjacent";

export type Scenario = {
  id: ScenarioId;
  name: string;
  description: string;
  config: HeadlessRunConfig;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "default",
    name: "Default (Full Staircase)",
    description: "Build a 4-step staircase to reach the goal tower",
    config: {},
  },
  {
    id: "atGoal",
    name: "Already at Goal",
    description: "Agent starts at goal position",
    config: {
      startCell: { x: 3, z: 3 },
      goalCell: { x: 3, z: 3 },
      goalHeight: 1,
      stairs: [],
      supplySources: [],
    },
  },
  {
    id: "simpleNavigate",
    name: "Simple Navigation",
    description: "Navigate to goal when goal height is 1 (no pick/place needed)",
    config: {
      startCell: { x: 1, z: 1 },
      goalCell: { x: 3, z: 3 },
      goalHeight: 1,
      stairs: [],
      supplySources: [],
    },
  },
  {
    id: "walkStep",
    name: "Walk Existing Step",
    description: "Walk an existing single step to the goal",
    config: {
      startCell: { x: 3, z: 1 },
      goalCell: { x: 3, z: 2 },
      goalHeight: 1,
      stairs: [],
      supplySources: [],
      initialHeights: [{ cell: { x: 3, z: 2 }, height: 1 }],
      maxIterations: 10,
    },
  },
  {
    id: "pickPlaceOne",
    name: "Pick and Place One Block",
    description: "Goal height is 2, requires one block to be placed",
    config: {
      startCell: { x: 0, z: 0 },
      goalCell: { x: 2, z: 2 },
      goalHeight: 2,
      stairs: [{ cell: { x: 2, z: 1 }, targetHeight: 1, label: "Step to goal" }],
      supplySources: [{ cell: { x: 0, z: 1 }, height: 1 }],
      maxIterations: 20,
    },
  },
  {
    id: "walkExistingStairs",
    name: "Walk Existing Two-Step Staircase",
    description: "Walk an existing two-step staircase to the goal",
    config: {
      startCell: { x: 3, z: 1 },
      goalCell: { x: 3, z: 3 },
      goalHeight: 0,
      stairs: [
        { cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step 1" },
        { cell: { x: 3, z: 3 }, targetHeight: 2, label: "Goal column" },
      ],
      supplySources: [],
      initialHeights: [
        { cell: { x: 3, z: 2 }, height: 1 },
        { cell: { x: 3, z: 3 }, height: 2 },
      ],
      maxIterations: 20,
    },
  },
  {
    id: "buildTwoSteps",
    name: "Build Two-Step Staircase",
    description: "Build a two-step staircase and reach goal",
    config: {
      startCell: { x: 3, z: 1 },
      goalCell: { x: 3, z: 3 },
      goalHeight: 0,
      stairs: [
        { cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step 1" },
        { cell: { x: 3, z: 3 }, targetHeight: 2, label: "Goal column" },
      ],
      supplySources: [
        { cell: { x: 1, z: 1 }, height: 2 },
        { cell: { x: 5, z: 2 }, height: 2 },
      ],
      maxIterations: 200,
    },
  },
  {
    id: "directPlaceAdjacent",
    name: "Direct Place on Adjacent",
    description: "Place block directly on adjacent cell when at same height",
    config: {
      startCell: { x: 2, z: 2 },
      goalCell: { x: 3, z: 3 },
      goalHeight: 2,
      stairs: [{ cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step to goal" }],
      supplySources: [{ cell: { x: 2, z: 2 }, height: 2 }],
      initialHeights: [{ cell: { x: 2, z: 2 }, height: 1 }],
      maxIterations: 50,
    },
  },
];

export const getScenarioById = (id: ScenarioId): Scenario => {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) {
    throw new Error(`Scenario not found: ${id}`);
  }
  return scenario;
};

export const getDefaultScenario = (): Scenario => SCENARIOS[0];

