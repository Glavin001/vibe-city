import type { NavMesh, NavMeshQuery, Crowd } from 'recast-navigation';
import { create } from 'zustand';
import type { DynamicTiledNavMesh } from './dynamic-tiled-navmesh';

export type NavigationState = {
  dynamicTiledNavMesh?: DynamicTiledNavMesh;
  navMesh?: NavMesh;
  navMeshQuery?: NavMeshQuery;
  navMeshData?: NavMeshData;
  crowd?: Crowd;
};

export const useNavigation = create<NavigationState>(() => ({
  dynamicTiledNavMesh: undefined,
  navMesh: undefined,
  navMeshQuery: undefined,
  navMeshData: undefined,
  crowd: undefined,
}));

// Types for our cache and nav mesh data
export interface NavMeshData {
  positions: Float32Array;
  indices: Uint32Array;
}
