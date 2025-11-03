import { useRef, useEffect, useState, useCallback } from "react";
import { useRapier, useAfterPhysicsStep } from "@react-three/rapier";
import type { NavMesh } from "navcat";
import {
  extractRapierToNavcat,
  type ExtractOptions,
  type RapierExtractionCache,
} from "./extract";
import {
  generateSoloNavMeshFromGeometry,
  type NavMeshPreset,
  type NavMeshGenOptions,
  type NavMeshBuildCache,
  type NavMeshGenerationResult,
} from "./generate";
import type { RapierExtractionResult } from "./extract";
import type RapierType from "@dimforge/rapier3d-compat";
import type {
  NavMeshWorkerOptions,
  NavMeshWorkerRequest,
  NavMeshWorkerResponse,
} from "./navmesh.worker.types";

export type NavMeshSyncState = {
  navMesh: NavMesh | null;
  extraction: RapierExtractionResult | null;
  lastUpdateTime: number;
  buildTime: number;
  isUpdating: boolean;
  refreshNavMesh?: () => void; // Manual refresh function (only available in manual mode)
};

export type NavMeshSyncMode = "auto" | "manual";

const DEFAULT_UPDATE_THROTTLE_MS = 1500; // Update navmesh at most every 500ms

export function useRapierNavMeshSync(options?: {
  updateThrottleMs?: number;
  enabled?: boolean;
  extractOptions?: ExtractOptions;
  navMeshPreset?: NavMeshPreset;
  navMeshOptions?: NavMeshGenOptions; // Full generation options (overrides preset)
  mode?: NavMeshSyncMode; // "auto" (automatic updates) or "manual" (button-triggered)
}): NavMeshSyncState {
  const { world, rapier } = useRapier();
  const updateThrottle = options?.updateThrottleMs ?? DEFAULT_UPDATE_THROTTLE_MS;
  const enabled = options?.enabled ?? true;
  const mode = options?.mode ?? "manual"; // Default to manual mode

  const [state, setState] = useState<NavMeshSyncState>({
    navMesh: null,
    extraction: null,
    lastUpdateTime: 0,
    buildTime: 0,
    isUpdating: false,
  });

  const lastUpdateTimeRef = useRef(0);
  const isUpdatingRef = useRef(false);
  const callbackInvokeCountRef = useRef(0);
  const lastLogTimeRef = useRef(0);
  const navMeshCacheRef = useRef<NavMeshBuildCache>({});
  const extractionCacheRef = useRef<RapierExtractionCache>({});
  const workerRef = useRef<Worker | null>(null);
  const workerRequestIdRef = useRef(0);
  const workerResolversRef = useRef(
    new Map<
      number,
      {
        resolve: (value: NavMeshGenerationResult | null) => void;
        reject: (error: Error) => void;
      }
    >(),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let terminated = false;

    try {
      const worker = new Worker(new URL("./navmesh.worker.ts", import.meta.url), {
        type: "module",
      });

      const handleMessage = (event: MessageEvent<NavMeshWorkerResponse>) => {
        const data = event.data;
        if (!data) {
          return;
        }

        const resolver = workerResolversRef.current.get(data.id);
        if (!resolver) {
          console.warn(`[NavMeshSync] ⚠️ Received worker response for unknown request ${data.id}`);
          return;
        }

        workerResolversRef.current.delete(data.id);

        if (data.type === "result") {
          resolver.resolve(data.result ?? null);
          return;
        }

        const error = new Error(data.message);
        if (data.stack) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            (error as { stack?: string }).stack = data.stack;
          } catch {
            // Ignore if stack is readonly in this environment
          }
        }
        resolver.reject(error);
      };

      const handleError = (event: ErrorEvent) => {
        console.error("[NavMeshSync] ❌ Navmesh worker error", event.error ?? event.message);
        event.preventDefault();

        workerResolversRef.current.forEach(({ reject }) => {
          reject(event.error instanceof Error ? event.error : new Error(event.message));
        });
        workerResolversRef.current.clear();
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleError);
      workerRef.current = worker;

      return () => {
        if (terminated) {
          return;
        }
        terminated = true;
        worker.removeEventListener("message", handleMessage);
        worker.removeEventListener("error", handleError);
        workerResolversRef.current.forEach(({ reject }) => {
          reject(new Error("Navmesh worker terminated"));
        });
        workerResolversRef.current.clear();
        worker.terminate();
        workerRef.current = null;
      };
    } catch (error) {
      console.warn("[NavMeshSync] ⚠️ Failed to initialize navmesh worker", error);
      workerRef.current = null;
    }

    return () => {
      if (terminated) {
        return;
      }
      terminated = true;
      workerResolversRef.current.forEach(({ reject }) => {
        reject(new Error("Navmesh worker cleanup"));
      });
      workerResolversRef.current.clear();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const updateNavMesh = useCallback((force = false) => {
    if (!world || !rapier || !enabled) {
      console.log("[NavMeshSync] ⚠️ Cannot update: world, rapier, or enabled missing", {
        hasWorld: !!world,
        hasRapier: !!rapier,
        enabled,
      });
      return;
    }

    if (isUpdatingRef.current) {
      console.log("[NavMeshSync] ⏸️ Update already in progress, skipping...");
      return;
    }

    const now = performance.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
    
    // Skip throttle check if force=true (manual mode) or in manual mode
    if (mode === "auto" && !force) {
      if (timeSinceLastUpdate < updateThrottle) {
        // Only log throttling every 100ms to avoid spam
        if (timeSinceLastUpdate < 100 || Math.random() < 0.01) {
          console.log(`[NavMeshSync] ⏸️ Throttled: ${timeSinceLastUpdate.toFixed(0)}ms < ${updateThrottle}ms`);
        }
        return;
      }
      console.log(`[NavMeshSync] ✅ Throttle passed: ${timeSinceLastUpdate.toFixed(0)}ms >= ${updateThrottle}ms, proceeding...`);
    } else if (mode === "manual") {
      console.log(`[NavMeshSync] 🔄 Manual refresh triggered...`);
    }

    isUpdatingRef.current = true;
    setState((prev) => ({ ...prev, isUpdating: true }));

    const runUpdate = async () => {
      const totalStartTime = performance.now();
      console.log("[NavMeshSync] Starting navmesh update...");

      try {
        const extractStartTime = performance.now();
        console.log("[NavMeshSync] Extracting from Rapier world...");
        const extractionOptions: ExtractOptions = {
          ...options?.extractOptions,
          cache: extractionCacheRef.current,
        };

        const rapierModule = rapier as unknown as typeof RapierType;
        const rapierWorld = world as unknown as RapierType.World;
        const extraction = extractRapierToNavcat(
          rapierWorld,
          rapierModule,
          extractionOptions,
        );
        const extractTime = performance.now() - extractStartTime;

        if (!extraction) {
          const totalTime = performance.now() - totalStartTime;
          console.log(
            `[NavMeshSync] Extraction returned null (${extractTime.toFixed(2)}ms), total: ${totalTime.toFixed(2)}ms`,
          );
          lastUpdateTimeRef.current = now;
          setState({
            navMesh: null,
            extraction: null,
            lastUpdateTime: now,
            buildTime: totalTime,
            isUpdating: false,
          });
          return;
        }
        console.log(`[NavMeshSync] Extraction complete: ${extractTime.toFixed(2)}ms`, {
          geometry: {
            positions: extraction.geometry.positions.length / 3,
            indices: extraction.geometry.indices.length / 3,
          },
          heightfields: extraction.heightfields.length,
        });

        const generateStartTime = performance.now();
        console.log("[NavMeshSync] Generating navmesh from extraction...");
        const baseGenOptions: NavMeshGenOptions = options?.navMeshOptions
          ? { ...options.navMeshOptions }
          : { preset: options?.navMeshPreset ?? "default" };

        const fallbackOptions: NavMeshGenOptions = {
          ...baseGenOptions,
          cache: baseGenOptions.cache ?? navMeshCacheRef.current,
        };
        const { cache: _unusedCache, ...workerOptionsRest } = fallbackOptions;
        const workerOptions = workerOptionsRest as NavMeshWorkerOptions;

        const executeGeneration = async (): Promise<NavMeshGenerationResult | null> => {
          const worker = workerRef.current;
          const externalCache = options?.navMeshOptions?.cache;

          if (!worker || externalCache) {
            if (externalCache && worker) {
              console.log("[NavMeshSync] ℹ️ External navmesh cache provided, using main thread generation");
            }
            return generateSoloNavMeshFromGeometry(extraction, fallbackOptions);
          }

          const requestId = ++workerRequestIdRef.current;
          const message: NavMeshWorkerRequest = {
            id: requestId,
            type: "build",
            extraction,
            options: workerOptions,
          };

          return new Promise<NavMeshGenerationResult | null>((resolve, reject) => {
            workerResolversRef.current.set(requestId, { resolve, reject });
            try {
              worker.postMessage(message);
            } catch (postError) {
              workerResolversRef.current.delete(requestId);
              reject(postError instanceof Error ? postError : new Error(String(postError)));
            }
          }).catch((workerError) => {
            console.error("[NavMeshSync] ❌ Worker generation failed, falling back to main thread", workerError);
            return generateSoloNavMeshFromGeometry(extraction, fallbackOptions);
          });
        };

        const result = await executeGeneration();
        const generateTime = performance.now() - generateStartTime;

        if (!result) {
          const totalTime = performance.now() - totalStartTime;
          console.log(
            `[NavMeshSync] Generation returned null (${generateTime.toFixed(2)}ms), total: ${totalTime.toFixed(2)}ms`,
          );
          lastUpdateTimeRef.current = now;
          setState({
            navMesh: null,
            extraction,
            lastUpdateTime: now,
            buildTime: totalTime,
            isUpdating: false,
          });
          return;
        }
        console.log(`[NavMeshSync] Generation complete: ${generateTime.toFixed(2)}ms`);

        if (extraction.usedStaticCache) {
          console.log("[NavMeshSync] ♻️ Reused cached static extraction");
        }

        if (result.stats.reusedNavMesh) {
          console.log("[NavMeshSync] ♻️ Reused cached navmesh (dynamic obstacles unchanged)");
        }

        const buildTime = performance.now() - totalStartTime;
        console.log(
          `[NavMeshSync] ✅ Navmesh update complete! Total: ${buildTime.toFixed(2)}ms (Extract: ${extractTime.toFixed(2)}ms, Generate: ${generateTime.toFixed(2)}ms)`,
        );
        console.log(`[NavMeshSync] Navmesh tiles: ${Object.keys(result.navMesh.tiles).length}`);

        lastUpdateTimeRef.current = now;

        setState({
          navMesh: result.navMesh,
          extraction,
          lastUpdateTime: now,
          buildTime,
          isUpdating: false,
        });
      } catch (error) {
        const totalTime = performance.now() - totalStartTime;
        console.error(`[NavMeshSync] ❌ Failed to update navmesh (${totalTime.toFixed(2)}ms):`, error);
        lastUpdateTimeRef.current = now;
        setState((prev) => ({
          ...prev,
          lastUpdateTime: now,
          buildTime: totalTime,
          isUpdating: false,
        }));
      } finally {
        isUpdatingRef.current = false;
      }
    };

    void runUpdate();
  }, [world, rapier, updateThrottle, enabled, mode, options?.extractOptions, options?.navMeshPreset, options?.navMeshOptions]);

  // Manual refresh function (only used in manual mode)
  const refreshNavMesh = useCallback(() => {
    updateNavMesh(true); // Force update, skip throttle
  }, [updateNavMesh]);

  // Initial extraction on mount (only in auto mode)
  useEffect(() => {
    if (world && rapier && enabled && mode === "auto") {
      updateNavMesh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, rapier, enabled, mode, updateNavMesh]); // Only run on mount/world change

  // Update after physics step (throttled) - only in auto mode
  useAfterPhysicsStep(() => {
    if (mode === "manual") {
      return; // Skip automatic updates in manual mode
    }
    
    callbackInvokeCountRef.current++;
    
    // Log callback invocation rate every second to detect spam
    const now = performance.now();
    if (now - lastLogTimeRef.current > 1000) {
      console.log(`[NavMeshSync] 📊 Callback invoked ${callbackInvokeCountRef.current} times in last second`);
      callbackInvokeCountRef.current = 0;
      lastLogTimeRef.current = now;
    }
    
    if (enabled) {
      updateNavMesh();
    }
  });

  return {
    ...state,
    refreshNavMesh: mode === "manual" ? refreshNavMesh : undefined,
  };
}
