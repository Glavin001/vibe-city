"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GUI } from "lil-gui";

import { createNavcatBlockStackerScene } from "@/lib/navcat-block-stacker";
import { SCENARIOS, getScenarioById, type ScenarioId } from "@/lib/navcat-block-stacker-scenarios";

export default function NavcatBlockStackerPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Preparing scene…");
  const [actions, setActions] = useState<Array<{ text: string; sequence: number }>>([]);
  const [plan, setPlan] = useState<{ iteration: number; actions: string[]; tasks: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionSequenceRef = useRef(0);
  const handleRef = useRef<Awaited<ReturnType<typeof createNavcatBlockStackerScene>> | null>(null);
  const guiRef = useRef<GUI | null>(null);
  const currentScenarioRef = useRef<ScenarioId>("default");
  const currentSpeedRef = useRef<number>(1.4);
  const currentShowNavMeshRef = useRef(false);
  const isRestartingRef = useRef(false);

  const restartScene = useCallback(async (scenarioId: ScenarioId, speed: number) => {
    const container = containerRef.current;
    if (!container) return;

    // Prevent multiple simultaneous restarts
    if (isRestartingRef.current) {
      console.log("[navcat-block-stacker] Already restarting, skipping...");
      return;
    }

    // Check if we're actually changing something
    if (currentScenarioRef.current === scenarioId && currentSpeedRef.current === speed && handleRef.current) {
      console.log("[navcat-block-stacker] Same scenario and speed, skipping restart");
      return;
    }

    isRestartingRef.current = true;
    currentScenarioRef.current = scenarioId;
    currentSpeedRef.current = speed;

    // Clear status first
    setStatus("Preparing scene…");
    setActions([]);
    setPlan(null);
    setError(null);
    actionSequenceRef.current = 0;

    // Dispose old scene (this will set disposed flag and clear container)
    if (handleRef.current) {
      handleRef.current.dispose();
      handleRef.current = null;
    }

    // Dispose old GUI
    if (guiRef.current) {
      guiRef.current.destroy();
      guiRef.current = null;
    }

    // Wait a bit to ensure cleanup is complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Ensure container is clean (dispose already does this, but be explicit)
    container.innerHTML = "";

    const scenario = getScenarioById(scenarioId);

    try {
      const sceneHandle = await createNavcatBlockStackerScene(
        container,
        {
          onStatus: (text) => setStatus(text),
          onAction: (text) => {
            actionSequenceRef.current += 1;
            setActions((prev) => [{ text, sequence: actionSequenceRef.current }, ...prev]);
          },
          onPlanUpdate: (info) => {
            setPlan(info);
          },
        },
        {
          config: scenario.config,
          speed,
        },
      );
      handleRef.current = sceneHandle;

      // Setup GUI
      const gui = new GUI();
      guiRef.current = gui;

      const scenarioOptions = Object.fromEntries(
        SCENARIOS.map((s) => [s.name, s.id] as const),
      ) as Record<string, ScenarioId>;
      const guiState = {
        scenario: scenarioId,
        speed,
        showNavMesh: currentShowNavMeshRef.current,
      };

      gui
        .add(guiState, "scenario", scenarioOptions)
        .name("Scenario")
        .onChange((value: ScenarioId) => {
          if (value === currentScenarioRef.current) {
            return;
          }
          const newSpeed = guiState.speed;
          void restartScene(value, newSpeed);
        });

      gui
        .add(guiState, "speed", 0.1, 10, 0.1)
        .name("Agent Speed")
        .onChange((value: number) => {
          guiState.speed = value;
          currentSpeedRef.current = value;
          if (handleRef.current) {
            handleRef.current.setSpeed(value);
          }
        });

      gui
        .add(guiState, "showNavMesh")
        .name("Show NavMesh")
        .onChange((value: boolean) => {
          guiState.showNavMesh = value;
          currentShowNavMeshRef.current = value;
          if (handleRef.current) {
            handleRef.current.setShowNavMeshHelper(value);
          }
        });

      gui.domElement.style.position = "absolute";
      gui.domElement.style.top = "1rem";
      gui.domElement.style.right = "1rem";
      gui.domElement.style.zIndex = "1000";

      sceneHandle.setShowNavMeshHelper(guiState.showNavMesh);
      isRestartingRef.current = false;
    } catch (err) {
      console.error("[navcat-block-stacker] failed", err);
      setError(err instanceof Error ? err.message : "Failed to start demo");
      isRestartingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    void restartScene("default", 1.4);

    return () => {
      if (handleRef.current) {
        handleRef.current.dispose();
        handleRef.current = null;
      }
      if (guiRef.current) {
        guiRef.current.destroy();
        guiRef.current = null;
      }
    };
  }, [restartScene]);

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute left-4 top-4 z-10 flex w-full max-w-3xl flex-col gap-4 rounded-lg bg-slate-900/70 p-4 text-sm shadow-lg">
        <div className="font-semibold text-lg">Navcat Block Stacker</div>
        <p>
          HTN planner drives the agent to collect blocks and build a staircase. Each placement rebuilds the navmesh tiles so the path to the tower gradually opens.
        </p>
        {error ? (
          <p className="pointer-events-auto text-red-400">{error}</p>
        ) : (
          <>
            <p className="text-sky-300">{status}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="pointer-events-auto rounded-md bg-slate-900/60 p-3 ring-1 ring-slate-700/50">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Completed actions</p>
                  <span className="text-[10px] text-slate-500">{actions.length}</span>
                </div>
                <ul className="max-h-60 space-y-1 overflow-y-auto pr-2">
                  {actions.length > 0 ? (
                    actions.map((action) => (
                      <li key={`${action.sequence}-${action.text}`} className="text-xs text-slate-200">
                        {action.sequence}. {action.text}
                      </li>
                    ))
                  ) : (
                    <li className="text-xs text-slate-500">No actions executed yet.</li>
                  )}
                </ul>
              </div>
              <div className="pointer-events-auto rounded-md bg-slate-900/60 p-3 ring-1 ring-slate-700/50">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-slate-400">Upcoming plan</p>
                  {plan ? <span className="text-[10px] text-slate-500">Iteration {plan.iteration}</span> : null}
                </div>
                <ul className="max-h-60 space-y-1 overflow-y-auto pr-2">
                  {plan && plan.actions.length > 0 ? (
                    plan.actions.map((text, index) => (
                      <li key={`${text}-${index}`} className="text-xs text-slate-200">
                        {index + 1}. {text}
                      </li>
                    ))
                  ) : (
                    <li className="text-xs text-slate-500">Waiting for next plan…</li>
                  )}
                </ul>
                {plan && plan.tasks.length > 0 && (
                  <p className="mt-2 text-[11px] text-slate-400">HTN tasks: {plan.tasks.join(" › ")}</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
