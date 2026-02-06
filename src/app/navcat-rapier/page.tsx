"use client";

import { useState, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls, OrbitControls, StatsGl } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { BUILDINGS } from "@/lib/bunker-world";
import { Ground, Building } from "@/lib/bunker-scene";
import { BuildingColliders } from "@/components/physics/BuildingColliders";
import { GroundPhysics } from "@/components/physics/GroundPhysics";
import { NavMeshDebrisSpawner } from "@/components/navcat/NavMeshDebrisSpawner";
import { NavMeshCrowd } from "@/components/navcat/NavMeshCrowd";
import { useRapierNavMeshSync, type NavMeshSyncState } from "@/lib/navcat-rapier/useRapierNavMeshSync";
import { NavMeshDebugLayer } from "@/components/navcat/NavMeshDebugLayer";
import type { NavMeshPreset } from "@/lib/navcat-rapier/generate";

type Controls = "forward" | "backward" | "left" | "right" | "jump" | "run";

function Scene({
  showNavMesh,
  navMeshUpdateThrottle,
  navMeshMode,
  navMeshPreset,
  onNavMeshStateChange,
  navMeshState,
}: {
  showNavMesh: boolean;
  navMeshUpdateThrottle: number;
  navMeshMode: "auto" | "manual";
  navMeshPreset: NavMeshPreset;
  onNavMeshStateChange?: (state: NavMeshSyncState) => void;
  navMeshState: NavMeshSyncState | null;
}) {

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />
      <Physics>
        {/* Physics ground */}
        <GroundPhysics />

        {/* Building colliders (simple 4-wall boxes) */}
        <BuildingColliders config={BUILDINGS.STORAGE} />
        <BuildingColliders config={BUILDINGS.BUNKER} />

        {/* Dynamic debris that affects navmesh */}
        <NavMeshDebrisSpawner
          count={15}
          spawnArea={{ x: 40, z: 40 }}
          spawnHeight={12}
          respawnInterval={10000}
          minSize={0.4}
          maxSize={1.2}
        />

        {/* Player with kinematic character controller */}
        {/* <PlayerKCC start={spawn} /> */}

        {/* Visual ground */}
        <Ground />
        <gridHelper args={[60, 60, "#4b5563", "#374151"]} position={[0, 0.01, 0]} />

        {/* Buildings visuals */}
        <Building
          center={BUILDINGS.STORAGE.center}
          size={BUILDINGS.STORAGE.size}
          color="#3f6212"
          label="Storage"
          doorFace={BUILDINGS.STORAGE.doorFace}
          doorSize={BUILDINGS.STORAGE.doorSize}
          doorColor="#a16207"
          showDoor={true}
          opacity={1}
          debug={false}
        />
        <Building
          center={BUILDINGS.BUNKER.center}
          size={BUILDINGS.BUNKER.size}
          color="#374151"
          label="Bunker"
          doorFace={BUILDINGS.BUNKER.doorFace}
          doorSize={BUILDINGS.BUNKER.doorSize}
          doorColor="#7c2d12"
          showDoor={true}
          opacity={1}
          debug={false}
        />

        {/* Sync Rapier world to Navcat navmesh - must be inside Physics context */}
        <NavMeshSyncLayer
          showNavMesh={showNavMesh}
          navMeshUpdateThrottle={navMeshUpdateThrottle}
          mode={navMeshMode}
          preset={navMeshPreset}
          onStateChange={onNavMeshStateChange}
        />

        {/* Pathfinding crowd agents (cats) */}
        {/* <CrowdLayer navMeshState={navMeshState} /> */}
      </Physics>

      {/* Camera controls - always enabled for debugging */}
      <OrbitControls makeDefault target={[0, 0, 0]} />
      
      {/* Performance stats */}
      <StatsGl className="absolute top-4 right-4" />
    </>
  );
}

function NavMeshSyncLayer({
  showNavMesh,
  navMeshUpdateThrottle,
  mode,
  preset,
  onStateChange,
}: {
  showNavMesh: boolean;
  navMeshUpdateThrottle: number;
  mode: "auto" | "manual";
  preset: NavMeshPreset;
  onStateChange?: (state: NavMeshSyncState) => void;
}) {
  // Sync Rapier world to Navcat navmesh
  const navMeshState = useRapierNavMeshSync({
    updateThrottleMs: navMeshUpdateThrottle,
    enabled: true,
    mode,
    navMeshPreset: preset,
  });

  // Notify parent of state changes - use refs to track actual changes to avoid infinite loops
  const prevNavMeshRef = useRef(navMeshState.navMesh);
  const prevIsUpdatingRef = useRef(navMeshState.isUpdating);
  const prevRefreshFnRef = useRef(navMeshState.refreshNavMesh);
  const hasNotifiedRef = useRef(false);
  
  // Extract stable references
  const currentNavMesh = navMeshState.navMesh;
  const currentIsUpdating = navMeshState.isUpdating;
  const currentRefreshFn = navMeshState.refreshNavMesh;
  
  useEffect(() => {
    const navMeshChanged = currentNavMesh !== prevNavMeshRef.current;
    const isUpdatingChanged = currentIsUpdating !== prevIsUpdatingRef.current;
    const refreshFnChanged = currentRefreshFn !== prevRefreshFnRef.current;
    
    // Always notify on first mount
    if (!hasNotifiedRef.current || navMeshChanged || isUpdatingChanged || refreshFnChanged) {
      prevNavMeshRef.current = currentNavMesh;
      prevIsUpdatingRef.current = currentIsUpdating;
      prevRefreshFnRef.current = currentRefreshFn;
      
      if (onStateChange) {
        if (!hasNotifiedRef.current) {
          console.log("[NavMeshSyncLayer] Initial state notification");
        } else {
          console.log("[NavMeshSyncLayer] State changed, notifying parent", {
            navMeshChanged,
            isUpdatingChanged,
            refreshFnChanged,
          });
        }
        onStateChange(navMeshState);
        hasNotifiedRef.current = true;
      }
    }
  }, [currentNavMesh, currentIsUpdating, currentRefreshFn, navMeshState, onStateChange]);

  return <NavMeshDebugLayer navMesh={navMeshState.navMesh} visible={showNavMesh} />;
}

function CrowdLayer({ navMeshState }: { navMeshState: NavMeshSyncState | null }) {
  const [target, setTarget] = useState<[number, number, number] | null>(null);

  if (!navMeshState?.navMesh) {
    return null;
  }

  return (
    <>
      <NavMeshCrowd 
        navMesh={navMeshState.navMesh} 
        agentCount={3}
        onTargetSet={(pos) => setTarget([pos[0], pos[1], pos[2]])}
      />
      {/* Visualize target */}
      {target && (
        <mesh position={target}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color="#ffff00" emissive="#ffff00" emissiveIntensity={0.5} />
        </mesh>
      )}
    </>
  );
}

export default function NavcatRapierPage() {
  const [showNavMesh, setShowNavMesh] = useState(true);
  const [navMeshUpdateThrottle, setNavMeshUpdateThrottle] = useState(2000);
  const [navMeshMode, setNavMeshMode] = useState<"auto" | "manual">("manual");
  const [navMeshPreset, setNavMeshPreset] = useState<NavMeshPreset>("default");
  const [navMeshState, setNavMeshState] = useState<NavMeshSyncState | null>(null);

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-black text-white">
      <KeyboardControls
        map={[
          { name: "forward" as Controls, keys: ["ArrowUp", "w", "W"] },
          { name: "backward" as Controls, keys: ["ArrowDown", "s", "S"] },
          { name: "left" as Controls, keys: ["ArrowLeft", "a", "A"] },
          { name: "right" as Controls, keys: ["ArrowRight", "d", "D"] },
          { name: "jump" as Controls, keys: ["Space"] },
          { name: "run" as Controls, keys: ["Shift"] },
        ]}
      >
        <Canvas shadows camera={{ fov: 75, position: [24, 18, 28] }}>
          <Scene
            showNavMesh={showNavMesh}
            navMeshUpdateThrottle={navMeshUpdateThrottle}
            navMeshMode={navMeshMode}
            navMeshPreset={navMeshPreset}
            onNavMeshStateChange={setNavMeshState}
            navMeshState={navMeshState}
          />
          {/* <PointerLockControls
            makeDefault={isLocked}
            onLock={() => setIsLocked(true)}
            onUnlock={() => setIsLocked(false)}
            selector="#startPointerLockNavcatRapier"
          /> */}
        </Canvas>
      </KeyboardControls>

      {/* <div
        id="startPointerLockNavcatRapier"
        className="absolute inset-0 select-none cursor-pointer"
        style={{ display: isLocked ? "none" : "block" }}
        title="Click to start (Esc to unlock)"
      >
        <div className="pointer-events-none absolute bottom-3 right-3 text-[11px] bg-gray-900/40 text-gray-200 px-2 py-1 rounded">
          Click to start · Esc to unlock
        </div>
      </div> */}

      {/* HUD */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-sm space-y-3 rounded-lg bg-black/70 p-4 text-sm leading-relaxed shadow-lg">
        <h1 className="text-lg font-semibold">Navcat × Rapier Live Navmesh</h1>
        <p>
          Real-time navmesh generation from Rapier physics colliders. Buildings and debris are automatically extracted and
          converted to walkable surfaces and obstacles.
        </p>
        <p>
          Click anywhere on the ground to set a target for the pathfinding agents (cats). The 3 colorful agents will pathfind around obstacles and debris.
        </p>
        <div className="pointer-events-auto space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showNavMesh}
              onChange={(e) => setShowNavMesh(e.target.checked)}
              className="cursor-pointer"
            />
            <span>Show Navmesh</span>
          </label>
          <div className="flex items-center gap-2">
            <label htmlFor="navmesh-mode" className="text-xs">Mode:</label>
            <select
              id="navmesh-mode"
              value={navMeshMode}
              onChange={(e) => setNavMeshMode(e.target.value as "auto" | "manual")}
              className="flex-1 cursor-pointer bg-gray-800 text-white px-2 py-1 rounded text-xs"
            >
              <option value="manual">Manual</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="navmesh-preset" className="text-xs">Preset:</label>
            <select
              id="navmesh-preset"
              value={navMeshPreset}
              onChange={(e) => {
                setNavMeshPreset(e.target.value as NavMeshPreset);
              }}
              className="flex-1 cursor-pointer bg-gray-800 text-white px-2 py-1 rounded text-xs"
            >
            <option value="default">Default</option>
            <option value="fast">Fast (skip detail)</option>
              <option value="crisp">Crisp</option>
              <option value="crispStrict">Crisp Strict</option>
            </select>
          </div>
          {navMeshMode === "manual" && (
            <button
              type="button"
              onClick={() => {
                console.log("[UI] Refresh button clicked", {
                  hasNavMeshState: !!navMeshState,
                  hasRefreshFn: !!navMeshState?.refreshNavMesh,
                  isUpdating: navMeshState?.isUpdating,
                });
                if (navMeshState?.refreshNavMesh) {
                  navMeshState.refreshNavMesh();
                } else {
                  console.error("[UI] ❌ refreshNavMesh function not available!");
                }
              }}
              disabled={navMeshState?.isUpdating}
              className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded text-sm font-medium"
            >
              {navMeshState?.isUpdating ? "Updating..." : "🔄 Refresh Navmesh"}
            </button>
          )}
          {navMeshMode === "auto" && (
            <div className="flex items-center gap-2">
              <label htmlFor="update-rate" className="text-xs">Update Rate (ms):</label>
              <input
                id="update-rate"
                type="range"
                min="100"
                max="2000"
                step="100"
                value={navMeshUpdateThrottle}
                onChange={(e) => setNavMeshUpdateThrottle(Number(e.target.value))}
                className="flex-1 cursor-pointer"
              />
              <span className="text-xs w-12 text-right">{navMeshUpdateThrottle}ms</span>
            </div>
          )}
          {navMeshState && (
            <div className="text-xs text-gray-400 space-y-1">
              <div>Last update: {navMeshState.buildTime > 0 ? `${navMeshState.buildTime.toFixed(2)}ms` : "Never"}</div>
              {navMeshState.lastUpdateTime > 0 && (
                <div>
                  {new Date(navMeshState.lastUpdateTime).toLocaleTimeString()}
                </div>
              )}
              <div>Navmesh: {navMeshState.navMesh ? "✅ Loaded" : "❌ None"}</div>
              <div>RefreshFn: {navMeshState.refreshNavMesh ? "✅ Available" : "❌ Missing"}</div>
            </div>
          )}
          {!navMeshState && (
            <div className="text-xs text-red-400">
              ⚠️ NavMeshState not initialized yet
            </div>
          )}
        </div>
        <div className="absolute left-3 bottom-3 text-gray-300 text-xs bg-gray-900/60 rounded px-2 py-1 pointer-events-none">
          Click ground to set target · Debris affects navmesh
        </div>
      </div>

      <div className="pointer-events-auto absolute bottom-4 right-4 z-10">
        <a
          href="/"
          className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium uppercase tracking-wide text-white shadow hover:bg-blue-600"
        >
          ← Back to Home
        </a>
      </div>
    </div>
  );
}
