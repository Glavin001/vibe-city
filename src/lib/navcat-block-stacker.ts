import Stats from "stats-gl";
import type { Vec3 } from "mathcat";
import { DEFAULT_QUERY_FILTER, type NavMesh, findPath } from "navcat";
import { generateTiledNavMesh } from "navcat/blocks";
import { Context, DomainBuilder, TaskStatus } from "htn-ai";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import * as THREE from "three/webgpu";

export type BlockStackerCallbacks = {
  onStatus?: (status: string) => void;
  onAction?: (action: string) => void;
};

export type BlockStackerHandle = {
  dispose: () => void;
};

const BLOCK_SIZE = 1;
const GRID_WIDTH = 8;
const GRID_DEPTH = 8;

const HALF_EXTENTS: Vec3 = [0.3, 0.6, 0.3];

const NAV_OPTIONS = {
  cellSize: 0.2,
  cellHeight: 0.2,
  tileSizeVoxels: 32,
  tileSizeWorld: 6.4,
  walkableRadiusVoxels: 2,
  walkableRadiusWorld: 0.4,
  walkableClimbVoxels: 5,
  walkableClimbWorld: 1,
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

type Cell = { x: number; z: number };

type StepDefinition = {
  cell: Cell;
  targetHeight: number;
  label: string;
};

const STAIRS: StepDefinition[] = [
  { cell: { x: 3, z: 2 }, targetHeight: 1, label: "Step 1" },
  { cell: { x: 3, z: 3 }, targetHeight: 2, label: "Step 2" },
  { cell: { x: 3, z: 4 }, targetHeight: 3, label: "Step 3" },
  { cell: { x: 3, z: 5 }, targetHeight: 4, label: "Step 4" },
];

const START_CELL: Cell = { x: 3, z: 1 };
const GOAL_CELL: Cell = { x: 3, z: 6 };
const GOAL_HEIGHT = 5;

const SUPPLY_SOURCES = [
  { cell: { x: 1, z: 1 }, height: 3 },
  { cell: { x: 5, z: 2 }, height: 2 },
  { cell: { x: 6, z: 4 }, height: 2 },
  { cell: { x: 2, z: 6 }, height: 2 },
  { cell: { x: 4, z: 4 }, height: 3 },
];

const SUPPLY_CELLS: Cell[] = SUPPLY_SOURCES.map((source) => source.cell);

type PlannedAction =
  | { type: "navigate"; path: Vec3[]; description: string }
  | { type: "pick"; cell: Cell; worldPosition: Vec3; description: string }
  | { type: "place"; cell: Cell; worldPosition: Vec3; description: string };

type PlannedStep = {
  supply: Cell;
  supplyTop: Vec3;
  frontier: StepDefinition;
  anchor: Cell;
  pathToSupply: Vec3[];
};

type BlockWorldSnapshot = {
  grid: number[][];
  agentPos: Vec3;
  carrying: boolean;
};

class BlockWorldContext extends Context {
  grid: number[][];
  navMesh: NavMesh;
  actionQueue: PlannedAction[] = [];
  agentPos: Vec3;
  carrying: boolean;
  pendingStep: PlannedStep | null = null;
  constructor(snapshot: BlockWorldSnapshot, navMesh: NavMesh) {
    super();
    this.grid = snapshot.grid;
    this.navMesh = navMesh;
    this.agentPos = [...snapshot.agentPos] as Vec3;
    this.carrying = snapshot.carrying;
    this.init();
  }
}

const cloneGrid = (grid: number[][]): number[][] => grid.map((row) => [...row]);

const cellKey = (cell: Cell) => `${cell.x}:${cell.z}`;

const cellTop = (grid: number[][], cell: Cell): Vec3 => [
  cell.x * BLOCK_SIZE + BLOCK_SIZE / 2,
  grid[cell.x][cell.z] * BLOCK_SIZE,
  cell.z * BLOCK_SIZE + BLOCK_SIZE / 2,
];

const distance3 = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const pathToPoints = (path: ReturnType<typeof findPath>): Vec3[] => {
  if (!path.success) return [];
  return path.path.map((p) => [p.position[0], p.position[1], p.position[2]] as Vec3);
};

const pathLength = (points: Vec3[]): number => {
  if (points.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance3(points[i - 1], points[i]);
  }
  return length;
};

const addCube = (
  positions: number[],
  indices: number[],
  x: number,
  y: number,
  z: number,
  size: number,
) => {
  const baseIndex = positions.length / 3;
  const vertices: Vec3[] = [
    [x, y, z],
    [x + size, y, z],
    [x + size, y, z + size],
    [x, y, z + size],
    [x, y + size, z],
    [x + size, y + size, z],
    [x + size, y + size, z + size],
    [x, y + size, z + size],
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

const buildGeometryFromGrid = (grid: number[][]) => {
  const positions: number[] = [];
  const indices: number[] = [];
  const planeY = 0;
  addCube(positions, indices, 0, planeY - 0.1, 0, GRID_WIDTH * BLOCK_SIZE);
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

const buildNavMeshForGrid = (grid: number[][]): NavMesh => {
  const { positions, indices } = buildGeometryFromGrid(grid);
  const { navMesh } = generateTiledNavMesh({ positions, indices }, NAV_OPTIONS);
  return navMesh;
};

const canReachGoal = (ctx: BlockWorldContext): { reachable: boolean; path: Vec3[] } => {
  const target = cellTop(ctx.grid, GOAL_CELL);
  const result = findPath(ctx.navMesh, ctx.agentPos, target, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
  if (!result.success || result.path.length === 0) {
    return { reachable: false, path: [] };
  }
  return { reachable: true, path: pathToPoints(result) };
};

const getFrontier = (grid: number[][]): StepDefinition | null => {
  for (const step of STAIRS) {
    if (grid[step.cell.x][step.cell.z] < step.targetHeight) {
      return step;
    }
  }
  return null;
};

const chooseSupply = (ctx: BlockWorldContext): PlannedStep | null => {
  const frontier = getFrontier(ctx.grid);
  if (!frontier) {
    return null;
  }
  const anchorIndex = STAIRS.findIndex((step) => step === frontier);
  const anchor = anchorIndex === 0 ? START_CELL : STAIRS[anchorIndex - 1].cell;
  let best: PlannedStep | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cell of SUPPLY_CELLS) {
    if (ctx.grid[cell.x][cell.z] <= 0) continue;
    const target = cellTop(ctx.grid, cell);
    const path = findPath(ctx.navMesh, ctx.agentPos, target, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
    if (!path.success || path.path.length === 0) continue;
    const points = pathToPoints(path);
    const length = pathLength(points);
    if (length < bestDist) {
      bestDist = length;
      best = {
        supply: cell,
        supplyTop: target,
        frontier,
        anchor,
        pathToSupply: points,
      };
    }
  }
  return best;
};

const navcatBlockDomain = (() => {
  const builder = new DomainBuilder<BlockWorldContext>("BlockStacker");
  builder.select("AchieveGoal");
  builder
    .sequence("ReachDirect")
    .condition("Goal reachable", (ctx) => {
      const { reachable, path } = canReachGoal(ctx);
      if (reachable) {
        ctx.actionQueue.push({
          type: "navigate",
          description: "Climb to the tower top",
          path,
        });
      }
      return reachable;
    })
    .do(() => TaskStatus.Success)
    .end();

  builder
    .sequence("BuildStep")
    .condition("Need more steps", (ctx) => {
      const frontier = getFrontier(ctx.grid);
      if (!frontier) return false;
      ctx.pendingStep = chooseSupply(ctx);
      return ctx.pendingStep !== null;
    })
    .action("Navigate to supply")
    .condition("Supply chosen", (ctx) => ctx.pendingStep !== null)
    .do((ctx) => {
      const step = ctx.pendingStep!;
      ctx.agentPos = [...step.supplyTop];
      ctx.actionQueue.push({
        type: "navigate",
        path: step.pathToSupply,
        description: `Walk to supply crate at (${step.supply.x}, ${step.supply.z})`,
      });
      return TaskStatus.Success;
    })
    .end()
    .action("Pick block")
    .condition("Ready to pick", (ctx) => ctx.pendingStep !== null && !ctx.carrying)
    .do((ctx) => {
      const step = ctx.pendingStep!;
      const { supply } = step;
      ctx.grid[supply.x][supply.z] -= 1;
      ctx.carrying = true;
      ctx.navMesh = buildNavMeshForGrid(ctx.grid);
      ctx.actionQueue.push({
        type: "pick",
        cell: supply,
        worldPosition: step.supplyTop,
        description: `Pick block at (${supply.x}, ${supply.z})`,
      });
      return TaskStatus.Success;
    })
    .end()
    .action("Navigate to anchor")
    .condition("Still carrying", (ctx) => ctx.pendingStep !== null && ctx.carrying)
    .condition("Anchor reachable", (ctx) => {
      const step = ctx.pendingStep!;
      const anchorTop = cellTop(ctx.grid, step.anchor);
      const path = findPath(ctx.navMesh, ctx.agentPos, anchorTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
      if (!path.success || path.path.length === 0) return false;
      ctx.actionQueue.push({
        type: "navigate",
        path: pathToPoints(path),
        description: `Carry block to ${step.frontier.label} staging cell`,
      });
      ctx.agentPos = anchorTop;
      return true;
    })
    .do(() => TaskStatus.Success)
    .end()
    .action("Place block")
    .condition("Carrying block", (ctx) => ctx.pendingStep !== null && ctx.carrying)
    .do((ctx) => {
      const step = ctx.pendingStep!;
      const { frontier } = step;
      ctx.grid[frontier.cell.x][frontier.cell.z] += 1;
      ctx.carrying = false;
      ctx.navMesh = buildNavMeshForGrid(ctx.grid);
      const top = cellTop(ctx.grid, frontier.cell);
      ctx.actionQueue.push({
        type: "place",
        cell: frontier.cell,
        worldPosition: top,
        description: `Stack block for ${frontier.label}`,
      });
      return TaskStatus.Success;
    })
    .end()
    .action("Climb new block")
    .condition("Frontier reachable", (ctx) => {
      const step = ctx.pendingStep!;
      const targetTop = cellTop(ctx.grid, step.frontier.cell);
      const path = findPath(ctx.navMesh, ctx.agentPos, targetTop, HALF_EXTENTS, DEFAULT_QUERY_FILTER);
      if (!path.success || path.path.length === 0) return false;
      ctx.actionQueue.push({
        type: "navigate",
        path: pathToPoints(path),
        description: `Climb onto ${step.frontier.label}`,
      });
      ctx.agentPos = targetTop;
      ctx.pendingStep = null;
      return true;
    })
    .do(() => TaskStatus.Success)
    .end()
    .end();

  builder.end();
  return builder.build();
})();

const createInitialGrid = () => {
  const grid: number[][] = Array.from({ length: GRID_WIDTH }, () => Array(GRID_DEPTH).fill(0));
  grid[GOAL_CELL.x][GOAL_CELL.z] = GOAL_HEIGHT;
  for (const source of SUPPLY_SOURCES) {
    grid[source.cell.x][source.cell.z] = source.height;
  }
  return grid;
};

type WorldState = {
  grid: number[][];
  agentPos: Vec3;
  carrying: boolean;
  navMesh: NavMesh;
};

const rebuildWorldNavMesh = (world: WorldState) => {
  world.navMesh = buildNavMeshForGrid(world.grid);
};

const updateInstancedBlocks = (
  mesh: THREE.InstancedMesh,
  grid: number[][],
  walkwayKeys: Set<string>,
) => {
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let index = 0;
  for (let x = 0; x < GRID_WIDTH; x++) {
    for (let z = 0; z < GRID_DEPTH; z++) {
      const height = grid[x][z];
      for (let h = 0; h < height; h++) {
        matrix.identity();
        matrix.setPosition(x * BLOCK_SIZE + BLOCK_SIZE / 2, h * BLOCK_SIZE + BLOCK_SIZE / 2, z * BLOCK_SIZE + BLOCK_SIZE / 2);
        mesh.setMatrixAt(index, matrix);
        const key = `${x}:${z}`;
        if (key === cellKey(GOAL_CELL)) {
          color.setHex(0xffd166);
        } else if (walkwayKeys.has(key)) {
          color.setHex(0x4f46e5);
        } else {
          color.setHex(0x6b7280);
        }
        mesh.setColorAt(index, color);
        index++;
      }
    }
  }
  mesh.count = index;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
};

const animatePath = async (
  agent: THREE.Mesh,
  carried: THREE.Mesh,
  path: Vec3[],
  world: WorldState,
  onUpdatePath: (points: Vec3[]) => void,
) => {
  if (path.length <= 1) {
    onUpdatePath([]);
    return;
  }
  onUpdatePath(path);
  const speed = 1.4;
  const agentOffset = new THREE.Vector3(0, 0.3, 0);
  const carriedOffset = new THREE.Vector3(0, 0.6, 0);
  await new Promise<void>((resolve) => {
    let segmentIndex = 0;
    const current = new THREE.Vector3(...path[0]);
    let next = new THREE.Vector3(...path[1]);
    let previousTime: number | undefined;
    const step = (time: number) => {
      if (previousTime === undefined) {
        previousTime = time;
        agent.position.copy(current).add(agentOffset);
        carried.position.copy(agent.position).add(carriedOffset);
        requestAnimationFrame(step);
        return;
      }
      const deltaSeconds = (time - previousTime) / 1000;
      previousTime = time;
      let distanceToTravel = speed * deltaSeconds;
      while (distanceToTravel > 0) {
        const remaining = next.clone().sub(current);
        const remainingLength = remaining.length();
        if (remainingLength <= 1e-4) {
          segmentIndex++;
          if (segmentIndex >= path.length - 1) {
            current.copy(next);
            agent.position.copy(current).add(agentOffset);
            carried.position.copy(agent.position).add(carriedOffset);
            onUpdatePath([]);
            resolve();
            return;
          }
          current.copy(next);
          next = new THREE.Vector3(...path[segmentIndex + 1]);
          continue;
        }
        const move = Math.min(distanceToTravel, remainingLength);
        const direction = remaining.normalize();
        current.add(direction.multiplyScalar(move));
        distanceToTravel -= move;
      }
      agent.position.copy(current).add(agentOffset);
      carried.position.copy(agent.position).add(carriedOffset);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  world.agentPos = [...path[path.length - 1]] as Vec3;
  onUpdatePath([]);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createNavcatBlockStackerScene = async (
  container: HTMLElement,
  callbacks: BlockStackerCallbacks = {},
): Promise<BlockStackerHandle> => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(10, 12, 10);
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  await renderer.init();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(3, 0, 3);
  controls.update();

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const dir = new THREE.DirectionalLight(0xfff3e0, 0.8);
  dir.position.set(8, 12, 6);
  scene.add(ambient, dir);

  const gridHelper = new THREE.GridHelper(GRID_WIDTH * BLOCK_SIZE, GRID_WIDTH, 0x1f2937, 0x1f2937);
  scene.add(gridHelper);

  const plane = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_WIDTH * BLOCK_SIZE, 0.2, GRID_DEPTH * BLOCK_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 }),
  );
  plane.position.set(GRID_WIDTH * BLOCK_SIZE / 2 - 0.5, -0.1, GRID_DEPTH * BLOCK_SIZE / 2 - 0.5);
  plane.receiveShadow = true;
  scene.add(plane);

  const blockGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  const blockMaterial = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
  const maxBlocks = GRID_WIDTH * GRID_DEPTH * 6;
  const blocksMesh = new THREE.InstancedMesh(blockGeometry, blockMaterial, maxBlocks);
  blocksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(blocksMesh);

  const agent = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0f172a, emissiveIntensity: 0.4 }),
  );
  scene.add(agent);

  const carriedBlock = new THREE.Mesh(blockGeometry, new THREE.MeshStandardMaterial({ color: 0xf97316 }));
  carriedBlock.visible = false;
  scene.add(carriedBlock);

  const pathGeometry = new THREE.BufferGeometry();
  const pathMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
  const pathLine = new THREE.Line(pathGeometry, pathMaterial);
  pathLine.visible = false;
  scene.add(pathLine);

  const stats = new Stats({ trackGPU: true, logsPerSecond: 10 });
  try {
    await stats.init(renderer);
    stats.domElement.style.position = "absolute";
    stats.domElement.style.top = "0.5rem";
    stats.domElement.style.left = "0.5rem";
    stats.domElement.style.zIndex = "10";
    stats.domElement.style.pointerEvents = "none";
    container.appendChild(stats.domElement);
  } catch (err) {
    console.warn("Stats init failed", err);
  }

  const walkwayKeys = new Set<string>([cellKey(START_CELL), ...STAIRS.map((step) => cellKey(step.cell))]);
  const initialGrid = createInitialGrid();
  const world: WorldState = {
    grid: initialGrid,
    agentPos: cellTop(initialGrid, START_CELL),
    carrying: false,
    navMesh: buildNavMeshForGrid(initialGrid),
  };
  updateInstancedBlocks(blocksMesh, world.grid, walkwayKeys);
  agent.position.set(world.agentPos[0], world.agentPos[1] + 0.3, world.agentPos[2]);

  const resize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener("resize", resize);

  let disposed = false;
  const onUpdatePath = (points: Vec3[]) => {
    if (points.length < 2) {
      pathLine.visible = false;
      return;
    }
    const flat = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      flat[i * 3 + 0] = points[i][0];
      flat[i * 3 + 1] = points[i][1] + 0.01;
      flat[i * 3 + 2] = points[i][2];
    }
    pathGeometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    pathGeometry.computeBoundingSphere();
    pathLine.visible = true;
  };

  const tick = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    stats.update();
    requestAnimationFrame(tick);
  };
  tick();

  const runPlanner = async () => {
    callbacks.onStatus?.("Planning staircase...");
    while (!disposed) {
      const { reachable } = canReachGoal(
        new BlockWorldContext(
          { grid: cloneGrid(world.grid), agentPos: [...world.agentPos] as Vec3, carrying: world.carrying },
          world.navMesh,
        ),
      );
      if (reachable && distance3(world.agentPos, cellTop(world.grid, GOAL_CELL)) < 0.1) {
        callbacks.onStatus?.("Agent reached the tower top!");
        carriedBlock.visible = false;
        break;
      }
      const planningGrid = cloneGrid(world.grid);
      const planningContext = new BlockWorldContext(
        { grid: planningGrid, agentPos: [...world.agentPos] as Vec3, carrying: world.carrying },
        world.navMesh,
      );
      navcatBlockDomain.findPlan(planningContext);
      if (planningContext.actionQueue.length === 0) {
        callbacks.onStatus?.("Planner failed to find a plan.");
        break;
      }
      for (const action of planningContext.actionQueue) {
        if (disposed) return;
        callbacks.onAction?.(action.description);
        callbacks.onStatus?.(action.description);
        if (action.type === "navigate") {
          await animatePath(agent, carriedBlock, action.path, world, onUpdatePath);
          if (world.carrying) {
            carriedBlock.visible = true;
            carriedBlock.position.copy(agent.position).add(new THREE.Vector3(0, 0.6, 0));
          }
        } else if (action.type === "pick") {
          world.grid[action.cell.x][action.cell.z] -= 1;
          world.carrying = true;
          carriedBlock.visible = true;
          carriedBlock.position.copy(agent.position).add(new THREE.Vector3(0, 0.6, 0));
          updateInstancedBlocks(blocksMesh, world.grid, walkwayKeys);
          rebuildWorldNavMesh(world);
          await wait(400);
        } else if (action.type === "place") {
          world.grid[action.cell.x][action.cell.z] += 1;
          world.carrying = false;
          carriedBlock.visible = false;
          updateInstancedBlocks(blocksMesh, world.grid, walkwayKeys);
          rebuildWorldNavMesh(world);
          await wait(400);
        }
      }
    }
  };

  void runPlanner();

  return {
    dispose: () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      renderer.dispose();
      blocksMesh.dispose();
      pathGeometry.dispose();
      pathMaterial.dispose();
      blockGeometry.dispose();
      blockMaterial.dispose();
      stats?.dispose();
      container.innerHTML = "";
    },
  };
};
