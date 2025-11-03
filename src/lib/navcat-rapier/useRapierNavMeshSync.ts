import { useRef, useEffect, useState, useCallback } from "react";
import { useRapier, useAfterPhysicsStep } from "@react-three/rapier";
import type { NavMesh } from "navcat";
import { extractRapierToNavcat, type ExtractOptions } from "./extract";
import {
  generateSoloNavMeshFromGeometry,
  type NavMeshPreset,
  type NavMeshGenOptions,
  type NavMeshBuildCache,
} from "./generate";
import type { RapierExtractionResult } from "./extract";

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

    const totalStartTime = performance.now();
    console.log("[NavMeshSync] Starting navmesh update...");

    try {
      // Extract geometry from Rapier world
      const extractStartTime = performance.now();
      console.log("[NavMeshSync] Extracting from Rapier world...");
      // @ts-expect-error - Duplicate Rapier types from nested @dimforge/rapier3d-compat dependencies
      const extraction = extractRapierToNavcat(world, rapier, options?.extractOptions);
      const extractTime = performance.now() - extractStartTime;
      
      if (!extraction) {
        const totalTime = performance.now() - totalStartTime;
        console.log(`[NavMeshSync] Extraction returned null (${extractTime.toFixed(2)}ms), total: ${totalTime.toFixed(2)}ms`);
        // Update ref before returning
        lastUpdateTimeRef.current = now;
        setState({
          navMesh: null,
          extraction: null,
          lastUpdateTime: now,
          buildTime: totalTime,
          isUpdating: false,
        });
        isUpdatingRef.current = false;
        return;
      }
      console.log(`[NavMeshSync] Extraction complete: ${extractTime.toFixed(2)}ms`, {
        geometry: {
          positions: extraction.geometry.positions.length / 3,
          indices: extraction.geometry.indices.length / 3,
        },
        heightfields: extraction.heightfields.length,
      });

      // Generate navmesh from extraction
      const generateStartTime = performance.now();
      console.log("[NavMeshSync] Generating navmesh from extraction...");
      const genOptions: NavMeshGenOptions = options?.navMeshOptions ?? {
        preset: options?.navMeshPreset ?? "default", // Default to full-quality navmesh
      };
      const result = generateSoloNavMeshFromGeometry(extraction, {
        ...genOptions,
        cache: navMeshCacheRef.current,
      });
      const generateTime = performance.now() - generateStartTime;
      
      if (!result) {
        const totalTime = performance.now() - totalStartTime;
        console.log(`[NavMeshSync] Generation returned null (${generateTime.toFixed(2)}ms), total: ${totalTime.toFixed(2)}ms`);
        // Update ref before returning
        lastUpdateTimeRef.current = now;
        setState({
          navMesh: null,
          extraction,
          lastUpdateTime: now,
          buildTime: totalTime,
          isUpdating: false,
        });
        isUpdatingRef.current = false;
        return;
      }
      console.log(`[NavMeshSync] Generation complete: ${generateTime.toFixed(2)}ms`);

      const buildTime = performance.now() - totalStartTime;
      console.log(`[NavMeshSync] ✅ Navmesh update complete! Total: ${buildTime.toFixed(2)}ms (Extract: ${extractTime.toFixed(2)}ms, Generate: ${generateTime.toFixed(2)}ms)`);
      console.log(`[NavMeshSync] Navmesh tiles: ${Object.keys(result.navMesh.tiles).length}`);

      // Update refs BEFORE setState to prevent race conditions
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
      // Update ref even on error
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
