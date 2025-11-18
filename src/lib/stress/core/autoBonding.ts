import {
  type BondingMode,
  chunksFromBufferGeometries,
  loadStressSolver,
} from "blast-stress-solver";
import type * as THREE from "three";
import type { ScenarioBond } from "./types";

export type AutoBondingRequest = {
  enabled?: boolean;
  mode?: BondingMode;
  maxSeparation?: number;
  label?: string;
};

export type AutoBondChunkInput = {
  geometry: THREE.BufferGeometry;
  isSupport?: boolean;
  matrix?: THREE.Matrix4;
};

const MIN_AREA = 1e-8;
const DEFAULT_MODE: BondingMode = "exact";

export async function generateAutoBondsFromChunks(
  chunks: AutoBondChunkInput[],
  options?: AutoBondingRequest,
): Promise<ScenarioBond[] | null> {
  if (!chunks.length) return [];
  try {
    const chunkInputs = chunksFromBufferGeometries(
      chunks.map((chunk) => chunk.geometry),
      (_geometry, index) => {
        const source = chunks[index];
        return {
          isSupport: !!source.isSupport,
          applyMatrix: source.matrix,
          nonIndexed: true,
          cloneGeometry: true,
        };
      },
    );
    const runtime = await loadStressSolver();
    const bondDescs = runtime.createBondsFromTriangles(chunkInputs, {
      mode: options?.mode ?? DEFAULT_MODE,
      maxSeparation: options?.maxSeparation,
    });
    const bonds: ScenarioBond[] = [];
    for (const bond of bondDescs) {
      if (!bond.centroid || !bond.normal) continue;
      bonds.push({
        node0: bond.node0,
        node1: bond.node1,
        centroid: bond.centroid,
        normal: bond.normal,
        area: Math.max(bond.area ?? MIN_AREA, MIN_AREA),
      });
    }
    return bonds;
  } catch (error) {
    const label = options?.label ?? "AutoBonding";
    console.error(`[${label}] Failed to generate bonds`, error);
    return null;
  }
}
