import Stats from "stats-gl";
import type { Vec3 } from "mathcat";
import type { NavMesh } from "navcat";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import * as THREE from "three/webgpu";
import {
  BlockWorldContext,
  BLOCK_SIZE,
  GRID_WIDTH,
  GRID_DEPTH,
  cellKey,
  cellTop,
  cloneGrid,
  createInitialGrid,
  distance3,
  getFrontier,
  canReachGoal,
  buildNavMeshForGrid,
  navcatBlockDomain,
  START_CELL,
  STAIRS,
  GOAL_CELL,
  runNavcatBlockStackerHeadless,
  type HeadlessRunConfig,
  hasAgentReachedGoal,
} from "./navcat-block-stacker-core";

export type BlockStackerCallbacks = {
  onStatus?: (status: string) => void;
  onAction?: (action: string) => void;
};

export type BlockStackerOptions = {
  config?: HeadlessRunConfig;
  speed?: number;
};

export type BlockStackerHandle = {
  dispose: () => void;
  setSpeed: (speed: number) => void;
  setConfig: (config: HeadlessRunConfig) => void;
};

export { runNavcatBlockStackerHeadless };

type WorldState = {
  grid: number[][];
  agentPos: Vec3;
  carrying: boolean;
  navMesh: NavMesh;
};

const rebuildWorldNavMesh = (world: WorldState) => {
  world.navMesh = buildNavMeshForGrid(world.grid);
};

const LOG_PREFIX = "[BlockStacker]" as const;
const log = (...args: unknown[]) => console.log(LOG_PREFIX, ...args);
const logWarn = (...args: unknown[]) => console.warn(LOG_PREFIX, ...args);
const logError = (...args: unknown[]) => console.error(LOG_PREFIX, ...args);

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
  speed: number,
) => {
  if (path.length <= 1) {
    onUpdatePath([]);
    return;
  }
  onUpdatePath(path);
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
  options: BlockStackerOptions = {},
): Promise<BlockStackerHandle> => {
  const config = options.config ?? {};
  let speed = options.speed ?? 1.4;
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

  const startCell = config.startCell ?? START_CELL;
  const stairs = config.stairs ?? STAIRS;
  const goalCell = config.goalCell ?? GOAL_CELL;
  const walkwayKeys = new Set<string>([cellKey(startCell), ...stairs.map((step) => cellKey(step.cell))]);
  const initialGrid = createInitialGrid(config);
  const world: WorldState = {
    grid: initialGrid,
    agentPos: cellTop(initialGrid, startCell),
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
    let iteration = 0;
    while (!disposed) {
      iteration += 1;
      const currentFrontier = getFrontier(world.grid);
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
      if (reachable && hasAgentReachedGoal(world.grid, world.agentPos, goalCell)) {
        log("planner: goal reached", { iteration });
        callbacks.onStatus?.("Agent reached the tower top!");
        carriedBlock.visible = false;
        break;
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
        callbacks.onStatus?.("Planner failed to find a plan.");
        break;
      }
      for (const action of planningContext.actionQueue) {
        if (disposed) return;
        log("planner: executing action", { iteration, action });
        callbacks.onAction?.(action.description);
        callbacks.onStatus?.(action.description);
        if (action.type === "navigate") {
          await animatePath(agent, carriedBlock, action.path, world, onUpdatePath, speed);
          if (world.carrying) {
            carriedBlock.visible = true;
            carriedBlock.position.copy(agent.position).add(new THREE.Vector3(0, 0.6, 0));
          }
          log("planner: navigate complete", {
            iteration,
            description: action.description,
            newAgentPos: [...world.agentPos],
            carrying: world.carrying,
          });
        } else if (action.type === "pick") {
          const beforeHeight = world.grid[action.cell.x][action.cell.z];
          log("planner: picking block", {
            iteration,
            cell: action.cell,
            beforeHeight,
          });
          world.grid[action.cell.x][action.cell.z] -= 1;
          world.carrying = true;
          carriedBlock.visible = true;
          carriedBlock.position.copy(agent.position).add(new THREE.Vector3(0, 0.6, 0));
          updateInstancedBlocks(blocksMesh, world.grid, walkwayKeys);
          rebuildWorldNavMesh(world);
          await wait(400);
          log("planner: pick complete", {
            iteration,
            cell: action.cell,
            afterHeight: world.grid[action.cell.x][action.cell.z],
            carrying: world.carrying,
          });
        } else if (action.type === "place") {
          const beforeHeight = world.grid[action.cell.x][action.cell.z];
          log("planner: placing block", {
            iteration,
            cell: action.cell,
            beforeHeight,
          });
          world.grid[action.cell.x][action.cell.z] += 1;
          world.carrying = false;
          carriedBlock.visible = false;
          updateInstancedBlocks(blocksMesh, world.grid, walkwayKeys);
          rebuildWorldNavMesh(world);
          await wait(400);
          log("planner: place complete", {
            iteration,
            cell: action.cell,
            afterHeight: world.grid[action.cell.x][action.cell.z],
            carrying: world.carrying,
          });
        }
      }
    }
  };

  void runPlanner();

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      window.removeEventListener("resize", resize);
      pathGeometry.dispose();
      pathMaterial.dispose();
      blocksMesh.dispose();
      blockGeometry.dispose();
      blockMaterial.dispose();
      renderer.dispose();
      if (stats) {
        stats.domElement.remove();
      }
      container.innerHTML = "";
    },
    setSpeed: (newSpeed: number) => {
      speed = Math.max(0.1, Math.min(10, newSpeed));
    },
    setConfig: (_newConfig: HeadlessRunConfig) => {
      // Note: This would require restarting the planner, which is complex
      // For now, this is a placeholder that could trigger a restart
      logWarn("setConfig: Changing config requires restarting the scene");
    },
  };
};
