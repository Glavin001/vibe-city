"use client";

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { DECAL_ALPHA_TEST, DECAL_POLY_OFFSET, INDEX_BUDGET, MAX_DECALS, OPTIMIZE_EVERY, VERT_BUDGET } from "@/components/decals/constants";

interface DecalRecord {
  geometryId: number;
}

export interface DecalBatcherRef {
  addDecal: (geom: THREE.BufferGeometry) => void;
}

export function DecalBatcher(
  { onDecalCountChange }: { onDecalCountChange?: (count: number) => void },
  ref: React.ForwardedRef<DecalBatcherRef>
) {
  const batchRef = useRef<THREE.BatchedMesh | null>(null);
  const decalRingRef = useRef<DecalRecord[]>([]);
  const removedSinceOptimizeRef = useRef(0);
  const { gl } = useThree();

  const decalMaterial = useMemo(() => {
    const textureLoader = new THREE.TextureLoader();
    const bulletTex = textureLoader.load("/decals/bullet-hole.png");
    bulletTex.colorSpace = THREE.SRGBColorSpace;
    bulletTex.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());

    return new THREE.MeshStandardMaterial({
      map: bulletTex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: DECAL_POLY_OFFSET,
      alphaTest: DECAL_ALPHA_TEST,
      metalness: 0.0,
      roughness: 0.9,
    });
  }, [gl]);

  useMemo(() => {
    if (batchRef.current) return batchRef.current;

    // THREE.BatchedMesh is not in @types/three yet; cast via unknown
    const BatchCtor = (THREE as unknown as { BatchedMesh: new (maxGeometryCount: number, vertexBudget: number, indexBudget: number, material?: THREE.Material | THREE.Material[]) => THREE.BatchedMesh }).BatchedMesh;
    const batch = new BatchCtor(
      MAX_DECALS,
      VERT_BUDGET,
      INDEX_BUDGET,
      decalMaterial
    );
    batch.frustumCulled = false;
    batch.sortObjects = true;
    batchRef.current = batch;

    return batch;
  }, [decalMaterial]);

  const addDecal = useCallback(
    (geom: THREE.BufferGeometry) => {
      if (!batchRef.current) return;
      const batch = batchRef.current as unknown as {
        addGeometry: (g: THREE.BufferGeometry) => number;
        addInstance: (geoId: number) => number;
        setMatrixAt: (instId: number, m: THREE.Matrix4) => void;
        deleteGeometry: (geoId: number) => void;
        optimize: () => void;
      };
      const geoId = batch.addGeometry(geom);
      const instId = batch.addInstance(geoId);
      const identityMat = new THREE.Matrix4();
      batch.setMatrixAt(instId, identityMat);

      decalRingRef.current.push({ geometryId: geoId });

      if (decalRingRef.current.length > MAX_DECALS) {
        const oldest = decalRingRef.current.shift();
        if (oldest) {
          batch.deleteGeometry(oldest.geometryId);
          removedSinceOptimizeRef.current++;
          if (removedSinceOptimizeRef.current >= OPTIMIZE_EVERY) {
            batch.optimize();
            removedSinceOptimizeRef.current = 0;
          }
        }
      }

      onDecalCountChange?.(decalRingRef.current.length);
    },
    [onDecalCountChange]
  );

  useImperativeHandle(ref, () => ({ addDecal }), [addDecal]);

  return batchRef.current ? <primitive object={batchRef.current} /> : null;
}

export default forwardRef(DecalBatcher);

export { MAX_DECALS };


