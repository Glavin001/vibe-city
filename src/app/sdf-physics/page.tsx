"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bakeTerrainWithObstaclesSdf,
  generateRandomObstacles,
  uploadSdfToWebGPU,
  SdfWorld,
  RigidBodyDesc,
  ColliderDesc,
  SdfPhysicsRenderer,
  type GpuSdf,
} from "@/lib/sdf-physics";

// ============================================================================
// Types
// ============================================================================

interface SimState {
  device: GPUDevice | null;
  gpuSdf: GpuSdf | null;
  world: SdfWorld | null;
  renderer: SdfPhysicsRenderer | null;
  animationId: number;
  lastTime: number;
}

interface SimParams {
  gravity: number;
  restitution: number;
  spawnCount: number;
  spawnHeight: number;
  spawnSpread: number;
  ballRatio: number;
  minSize: number;
  maxSize: number;
  paused: boolean;
}

// ============================================================================
// Control Panel Components
// ============================================================================

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter?: (v: number) => string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, formatter, onChange }: SliderProps) {
  const displayValue = formatter ? formatter(value) : value.toFixed(2);

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-neutral-300">{label}</span>
        <span className="font-mono text-neutral-500">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value))}
        className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
}

interface ControlPanelProps {
  params: SimParams;
  setParams: React.Dispatch<React.SetStateAction<SimParams>>;
  stats: {
    fps: number;
    bodies: number;
    balls: number;
    boxes: number;
  };
  onSpawn: () => void;
  onReset: () => void;
  onTogglePause: () => void;
  sdfVisEnabled: boolean;
  onToggleSdfVis: () => void;
}

function ControlPanel({
  params,
  setParams,
  stats,
  onSpawn,
  onReset,
  onTogglePause,
  sdfVisEnabled,
  onToggleSdfVis,
}: ControlPanelProps) {
  return (
    <div className="pointer-events-auto absolute bottom-6 right-6 z-10 w-80 max-h-[85vh] overflow-y-auto rounded-xl border border-white/10 bg-black/85 p-5 text-white shadow-2xl backdrop-blur-md">
      {/* Stats Section */}
      <div className="mb-4 pb-4 border-b border-white/10">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">
          Performance
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">FPS</span>
            <span className="font-mono text-green-400">{stats.fps}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Bodies</span>
            <span className="font-mono text-blue-400">{stats.bodies.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Balls</span>
            <span className="font-mono text-cyan-400">{stats.balls.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-400">Boxes</span>
            <span className="font-mono text-orange-400">{stats.boxes.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Actions Section */}
      <div className="mb-4 pb-4 border-b border-white/10">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">
          Actions
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSpawn}
            className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium text-sm transition-colors"
          >
            Spawn Bodies
          </button>
          <button
            type="button"
            onClick={onReset}
            className="py-2 px-3 bg-orange-600/80 hover:bg-orange-500 rounded-lg font-medium text-sm transition-colors"
          >
            Reset
          </button>
        </div>
        <button
          type="button"
          onClick={onTogglePause}
          className={`w-full mt-2 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${
            params.paused
              ? "bg-green-600 hover:bg-green-500"
              : "bg-yellow-600 hover:bg-yellow-500"
          }`}
        >
          {params.paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button
          type="button"
          onClick={onToggleSdfVis}
          className={`w-full mt-2 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${
            sdfVisEnabled
              ? "bg-purple-600 hover:bg-purple-500"
              : "bg-neutral-700 hover:bg-neutral-600"
          }`}
        >
          {sdfVisEnabled ? "🔍 SDF View ON" : "🔍 SDF View OFF"}
        </button>
      </div>

      {/* Physics Section */}
      <div className="mb-4 pb-4 border-b border-white/10">
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">
          Physics
        </h3>
        <Slider
          label="Gravity"
          value={params.gravity}
          min={0}
          max={30}
          step={0.5}
          formatter={(v) => `${v.toFixed(1)} m/s²`}
          onChange={(v) => setParams((p) => ({ ...p, gravity: v }))}
        />
        <Slider
          label="Restitution (Bounce)"
          value={params.restitution}
          min={0}
          max={1}
          step={0.05}
          formatter={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => setParams((p) => ({ ...p, restitution: v }))}
        />
      </div>

      {/* Spawn Settings Section */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3">
          Spawn Settings
        </h3>
        <Slider
          label="Spawn Count"
          value={params.spawnCount}
          min={100}
          max={100000}
          step={500}
          formatter={(v) => v.toLocaleString()}
          onChange={(v) => setParams((p) => ({ ...p, spawnCount: v }))}
        />
        <Slider
          label="Spawn Height"
          value={params.spawnHeight}
          min={5}
          max={50}
          step={1}
          formatter={(v) => `${v}m`}
          onChange={(v) => setParams((p) => ({ ...p, spawnHeight: v }))}
        />
        <Slider
          label="Spawn Spread"
          value={params.spawnSpread}
          min={5}
          max={50}
          step={1}
          formatter={(v) => `${v}m`}
          onChange={(v) => setParams((p) => ({ ...p, spawnSpread: v }))}
        />
        <Slider
          label="Ball / Box Ratio"
          value={params.ballRatio}
          min={0}
          max={1}
          step={0.1}
          formatter={(v) => `${(v * 100).toFixed(0)}% balls`}
          onChange={(v) => setParams((p) => ({ ...p, ballRatio: v }))}
        />
        <Slider
          label="Min Size"
          value={params.minSize}
          min={0.1}
          max={1}
          step={0.05}
          formatter={(v) => `${v.toFixed(2)}m`}
          onChange={(v) => setParams((p) => ({ ...p, minSize: v }))}
        />
        <Slider
          label="Max Size"
          value={params.maxSize}
          min={0.2}
          max={2}
          step={0.1}
          formatter={(v) => `${v.toFixed(1)}m`}
          onChange={(v) => setParams((p) => ({ ...p, maxSize: v }))}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Main Demo Component
// ============================================================================

export default function SdfPhysicsDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simStateRef = useRef<SimState>({
    device: null,
    gpuSdf: null,
    world: null,
    renderer: null,
    animationId: 0,
    lastTime: 0,
  });

  const [params, setParams] = useState<SimParams>({
    gravity: 9.8,
    restitution: 0.3,
    spawnCount: 1000,
    spawnHeight: 20,
    spawnSpread: 15,
    ballRatio: 0.5,
    minSize: 0.2,
    maxSize: 0.6,
    paused: false,
  });

  const paramsRef = useRef(params);
  paramsRef.current = params;

  const [stats, setStats] = useState({
    fps: 0,
    bodies: 0,
    balls: 0,
    boxes: 0,
  });

  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [sdfVisEnabled, setSdfVisEnabled] = useState(false);

  // Stats tracking
  const fpsFrames = useRef<number[]>([]);

  // ============================================================================
  // Initialize WebGPU
  // ============================================================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted = true;

    async function init() {
      try {
        // Check WebGPU support
        if (!navigator.gpu) {
          throw new Error("WebGPU is not supported in this browser");
        }

        const adapter = await navigator.gpu.requestAdapter({
          powerPreference: "high-performance",
        });

        if (!adapter) {
          throw new Error("No WebGPU adapter found");
        }

        const device = await adapter.requestDevice({
          requiredFeatures: [],
          requiredLimits: {
            maxStorageBufferBindingSize: 256 * 1024 * 1024, // 256MB
            maxBufferSize: 256 * 1024 * 1024,
          },
        });

        if (!mounted) return;

        // Bake SDF for terrain with obstacles
        console.log("Baking SDF with terrain and obstacles...");
        const obstacles = generateRandomObstacles({
          count: 30,
          spread: 35,
          minSize: 2,
          maxSize: 5,
          terrainAmplitude: 3,
          terrainFrequency: 0.08,
          seed: 42,
        });
        const bakedSdf = bakeTerrainWithObstaclesSdf({
          size: 100,
          resolution: 192, // Higher resolution for smooth spheres
          terrainAmplitude: 3,
          terrainFrequency: 0.08,
          obstacles,
        });
        console.log(`SDF baked: ${bakedSdf.dim}³ with ${obstacles.length} obstacles`);

        // Upload to GPU
        const gpuSdf = uploadSdfToWebGPU(device, bakedSdf);
        console.log("SDF uploaded to GPU");

        // Create physics world
        const world = new SdfWorld(device, gpuSdf, {
          maxBodies: 100000,
          gravity: [0, -paramsRef.current.gravity, 0],
          restitution: paramsRef.current.restitution,
        });

        // Create static bodies for obstacles (visual representation)
        for (const obs of obstacles) {
          const [ox, oy, oz] = obs.position;
          const [sx, sy, sz] = obs.size;

          const rb = world.createRigidBody(
            RigidBodyDesc.fixed().setTranslation(ox, oy, oz)
          );

          if (obs.type === "sphere") {
            world.createCollider(ColliderDesc.ball(sx), rb);
          } else if (obs.type === "box") {
            world.createCollider(ColliderDesc.cuboid(sx, sy, sz), rb);
          } else if (obs.type === "cylinder") {
            // Approximate cylinder as a box for rendering
            world.createCollider(ColliderDesc.cuboid(sx, sy, sx), rb);
          }
        }
        console.log(`Created ${obstacles.length} static obstacle bodies`);

        // Set up canvas size
        const dpr = Math.min(window.devicePixelRatio, 2);
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        // Create renderer
        const renderer = new SdfPhysicsRenderer({
          canvas,
          device,
          bodyBuffer: world.getBodyBuffer(),
          maxBodies: 100000,
        });

        renderer.resize(canvas.width, canvas.height);

        // Set up SDF visualization
        // Get bounds from bakedSdf
        const sdfMin = bakedSdf.bounds.min;
        const sdfMax = bakedSdf.bounds.max;
        renderer.setupSdfVisualization(
          gpuSdf.texture,
          gpuSdf.sampler,
          gpuSdf.worldToSdf,
          [sdfMin.x, sdfMin.y, sdfMin.z],
          [sdfMax.x, sdfMax.y, sdfMax.z]
        );

        // Store state
        simStateRef.current = {
          device,
          gpuSdf,
          world,
          renderer,
          animationId: 0,
          lastTime: performance.now(),
        };

        setInitialized(true);

        // Start animation loop
        function animate(now: number) {
          const state = simStateRef.current;
          if (!state.world || !state.renderer) return;

          const dt = Math.min((now - state.lastTime) / 1000, 1 / 30);
          state.lastTime = now;

          // Update FPS
          fpsFrames.current.push(now);
          while (fpsFrames.current.length > 0 && fpsFrames.current[0] < now - 1000) {
            fpsFrames.current.shift();
          }

          // Update world params
          state.world.gravity = [0, -paramsRef.current.gravity, 0];
          state.world.restitution = paramsRef.current.restitution;

          // Step physics
          if (!paramsRef.current.paused) {
            state.world.step(dt);
          }

          // Update camera orbit
          const time = now * 0.0001;
          const radius = 40;
          const height = 20;
          state.renderer.camera.position = [
            Math.sin(time) * radius,
            height,
            Math.cos(time) * radius,
          ];

          // Render
          state.renderer.render(state.world.numBodies);

          // Update stats (throttled)
          if (Math.random() < 0.1) {
            setStats({
              fps: fpsFrames.current.length,
              bodies: state.world.numBodies,
              balls: state.world.ballCount,
              boxes: state.world.boxCount,
            });
          }

          state.animationId = requestAnimationFrame(animate);
        }

        simStateRef.current.animationId = requestAnimationFrame(animate);

        console.log("SDF Physics demo initialized");
      } catch (err) {
        console.error("Failed to initialize:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    init();

    // Handle resize
    function handleResize() {
      const canvas = canvasRef.current;
      const renderer = simStateRef.current.renderer;
      if (!canvas || !renderer) return;

      const dpr = Math.min(window.devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      renderer.resize(canvas.width, canvas.height);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);

      const state = simStateRef.current;
      if (state.animationId) {
        cancelAnimationFrame(state.animationId);
      }
      state.renderer?.dispose();
      state.world?.dispose();
    };
  }, []);

  // ============================================================================
  // Spawn Bodies
  // ============================================================================

  const spawnBodies = useCallback(() => {
    const world = simStateRef.current.world;
    if (!world) return;

    // Helper to create a random unit quaternion
    const randomQuaternion = (): [number, number, number, number] => {
      // Generate random Euler angles
      const roll = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI * 2;
      const yaw = Math.random() * Math.PI * 2;

      // Convert to quaternion
      const cy = Math.cos(yaw * 0.5);
      const sy = Math.sin(yaw * 0.5);
      const cp = Math.cos(pitch * 0.5);
      const sp = Math.sin(pitch * 0.5);
      const cr = Math.cos(roll * 0.5);
      const sr = Math.sin(roll * 0.5);

      const w = cr * cp * cy + sr * sp * sy;
      const x = sr * cp * cy - cr * sp * sy;
      const y = cr * sp * cy + sr * cp * sy;
      const z = cr * cp * sy - sr * sp * cy;

      return [x, y, z, w];
    };

    const p = paramsRef.current;
    let balls = 0;
    let boxes = 0;

    for (let i = 0; i < p.spawnCount; i++) {
      const x = (Math.random() - 0.5) * p.spawnSpread * 2;
      const y = p.spawnHeight + Math.random() * 15;
      const z = (Math.random() - 0.5) * p.spawnSpread * 2;

      // Random rotation
      const [qx, qy, qz, qw] = randomQuaternion();

      // Random angular velocity (rad/s) - moderate spin
      const angVelMagnitude = 1 + Math.random() * 4;
      const angVelX = (Math.random() - 0.5) * angVelMagnitude;
      const angVelY = (Math.random() - 0.5) * angVelMagnitude;
      const angVelZ = (Math.random() - 0.5) * angVelMagnitude;

      const rb = world.createRigidBody(
        RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setRotation(qx, qy, qz, qw)
          .setLinvel(
            (Math.random() - 0.5) * 8,
            -Math.random() * 5,
            (Math.random() - 0.5) * 8
          )
          .setAngvel(angVelX, angVelY, angVelZ)
          .setLinearDamping(0.05)
          .setAngularDamping(0.2)
      );

      const size = p.minSize + Math.random() * (p.maxSize - p.minSize);

      if (Math.random() < p.ballRatio) {
        world.createCollider(ColliderDesc.ball(size), rb);
        balls++;
      } else {
        world.createCollider(
          ColliderDesc.cuboid(
            size * (0.5 + Math.random() * 0.5),
            size * (0.5 + Math.random() * 0.5),
            size * (0.5 + Math.random() * 0.5)
          ),
          rb
        );
        boxes++;
      }
    }

    console.log(`Spawned ${balls} balls, ${boxes} boxes. Total: ${world.numBodies}`);
  }, []);

  // Track the current obstacle seed for regeneration
  const obstacleSeedRef = useRef(42);

  const resetScene = useCallback(() => {
    const state = simStateRef.current;
    if (!state.world || !state.device || !state.gpuSdf) return;

    // Clear all bodies (both dynamic and static)
    state.world.clear();

    // Generate new random seed
    obstacleSeedRef.current = Math.floor(Math.random() * 100000);

    // Generate new random obstacles
    const newObstacles = generateRandomObstacles({
      count: 30,
      spread: 35,
      minSize: 2,
      maxSize: 5,
      terrainAmplitude: 3,
      terrainFrequency: 0.08,
      seed: obstacleSeedRef.current,
    });

    // Re-bake SDF with new obstacles
    console.log("Re-baking SDF with new obstacles...");
    const bakedSdf = bakeTerrainWithObstaclesSdf({
      size: 100,
      resolution: 192,
      terrainAmplitude: 3,
      terrainFrequency: 0.08,
      obstacles: newObstacles,
    });

    // Upload new SDF to GPU
    const newGpuSdf = uploadSdfToWebGPU(state.device, bakedSdf);

    // Dispose old SDF texture
    state.gpuSdf.texture.destroy();
    state.gpuSdf = newGpuSdf;

    // Recreate physics world with new SDF
    state.world.dispose();
    state.world = new SdfWorld(state.device, newGpuSdf, {
      maxBodies: 100000,
      gravity: [0, -paramsRef.current.gravity, 0],
      restitution: paramsRef.current.restitution,
    });

    // Update renderer with new body buffer
    state.renderer?.updateBodyBuffer(state.world.getBodyBuffer());

    // Update SDF visualization bind group with new SDF
    if (state.renderer) {
      const sdfMin = bakedSdf.bounds.min;
      const sdfMax = bakedSdf.bounds.max;
      state.renderer.setupSdfVisualization(
        newGpuSdf.texture,
        newGpuSdf.sampler,
        newGpuSdf.worldToSdf,
        [sdfMin.x, sdfMin.y, sdfMin.z],
        [sdfMax.x, sdfMax.y, sdfMax.z]
      );
    }

    // Create static bodies for new obstacles (visual representation)
    for (const obs of newObstacles) {
      const [ox, oy, oz] = obs.position;
      const [sx, sy, sz] = obs.size;

      const rb = state.world.createRigidBody(
        RigidBodyDesc.fixed().setTranslation(ox, oy, oz)
      );

      if (obs.type === "sphere") {
        state.world.createCollider(ColliderDesc.ball(sx), rb);
      } else if (obs.type === "box") {
        state.world.createCollider(ColliderDesc.cuboid(sx, sy, sz), rb);
      } else if (obs.type === "cylinder") {
        state.world.createCollider(ColliderDesc.cuboid(sx, sy, sx), rb);
      }
    }

    console.log(`Reset scene with ${newObstacles.length} new obstacles (seed: ${obstacleSeedRef.current})`);
  }, []);

  const togglePause = useCallback(() => {
    setParams((p) => ({ ...p, paused: !p.paused }));
  }, []);

  const toggleSdfVisualization = useCallback(() => {
    const { renderer } = simStateRef.current;
    if (renderer) {
      const newState = !renderer.isSdfVisualizationEnabled();
      renderer.setSdfVisualizationEnabled(newState);
      setSdfVisEnabled(newState);
    }
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center">
        <div className="bg-red-900/50 border border-red-500 rounded-xl p-8 max-w-md text-center">
          <h2 className="text-2xl font-bold text-red-400 mb-4">WebGPU Error</h2>
          <p className="text-neutral-300 mb-4">{error}</p>
          <p className="text-sm text-neutral-500">
            WebGPU requires a compatible browser (Chrome 113+, Edge 113+, or Firefox Nightly with flags enabled).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-neutral-900 overflow-hidden">
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ touchAction: "none" }}
      />

      {/* Header */}
      <div className="pointer-events-none absolute left-0 top-0 p-6">
        <h1 className="text-3xl font-bold text-white drop-shadow-lg">
          WebGPU SDF Physics
        </h1>
        <p className="mt-2 max-w-lg text-sm text-neutral-400 bg-black/50 backdrop-blur-sm rounded-lg p-3 border border-white/10">
          <strong>GPU-accelerated</strong> rigid body physics with SDF collision detection.
          Bodies collide against a baked signed distance field environment.
          <br /><br />
          <span className="text-neutral-500">
            Uses WebGPU compute shaders for physics simulation and instanced rendering
            for drawing tens of thousands of bodies.
          </span>
        </p>
      </div>

      {/* Loading indicator */}
      {!initialized && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-xl">Initializing WebGPU...</div>
        </div>
      )}

      {/* Control Panel */}
      {initialized && (
        <ControlPanel
          params={params}
          setParams={setParams}
          stats={stats}
          onSpawn={spawnBodies}
          onReset={resetScene}
          onTogglePause={togglePause}
          sdfVisEnabled={sdfVisEnabled}
          onToggleSdfVis={toggleSdfVisualization}
        />
      )}

      {/* Footer */}
      <div className="pointer-events-none absolute bottom-6 left-6">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-600">
          WebGPU / Compute Shaders / SDF Collision
        </p>
      </div>
    </div>
  );
}




