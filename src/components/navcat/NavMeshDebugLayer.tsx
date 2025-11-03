"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { NavMesh } from "navcat";
import { createNavMeshTileHelper, type DebugObject } from "navcat/three";
import * as THREE from "three";

export type NavMeshDebugLayerProps = {
  navMesh: NavMesh | null;
  yOffset?: number;
  visible?: boolean;
};

export function NavMeshDebugLayer({
  navMesh,
  yOffset = 0.05,
  visible = true,
}: NavMeshDebugLayerProps) {
  const scene = useThree((s) => s.scene);
  const tileHelpersRef = useRef<Map<string, DebugObject>>(new Map());
  const lastTileIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!navMesh) {
      // Remove all helpers when navmesh is null
      for (const helper of tileHelpersRef.current.values()) {
        scene.remove(helper.object);
        helper.dispose();
      }
      tileHelpersRef.current.clear();
      lastTileIdsRef.current.clear();
      return;
    }

    // Collect current tile IDs
    const currentTileIds = new Set<string>();
    for (const tileId in navMesh.tiles) {
      currentTileIds.add(tileId);
    }

    // Remove helpers for tiles that no longer exist
    for (const [tileId, helper] of tileHelpersRef.current.entries()) {
      if (!currentTileIds.has(tileId)) {
        scene.remove(helper.object);
        helper.dispose();
        tileHelpersRef.current.delete(tileId);
      }
    }

    // Add/update helpers for existing tiles
    for (const tileId in navMesh.tiles) {
      const tile = navMesh.tiles[tileId];

      if (!tileHelpersRef.current.has(tileId)) {
        // Create new helper
        const helper = createNavMeshTileHelper(tile);
        helper.object.position.y += yOffset;
        helper.object.visible = visible;
        scene.add(helper.object);
        tileHelpersRef.current.set(tileId, helper);
      } else {
        // Update visibility of existing helper
        const helper = tileHelpersRef.current.get(tileId);
        if (helper) {
          helper.object.visible = visible;
        }
      }
    }

    lastTileIdsRef.current = currentTileIds;

    // Cleanup on unmount
    return () => {
      for (const helper of tileHelpersRef.current.values()) {
        scene.remove(helper.object);
        helper.dispose();
      }
      tileHelpersRef.current.clear();
    };
  }, [navMesh, scene, yOffset, visible]);

  // Update visibility when prop changes
  useEffect(() => {
    for (const helper of tileHelpersRef.current.values()) {
      helper.object.visible = visible;
    }
  }, [visible]);

  return null; // This component doesn't render anything directly
}
