/*
import { createContext, useContext, type ReactNode } from 'react';
import type { CrowdAgent } from 'recast-navigation';

export interface Entity {
  id: string;
  crowdAgent?: CrowdAgent;
}

const EntityContext = createContext<Entity | undefined>(undefined);

export const ECS = {
  useCurrentEntity: () => useContext(EntityContext),
  
  EntityProvider: ({ entity, children }: { entity: Entity; children: ReactNode }) => {
    return <EntityContext.Provider value={entity}>{children}</EntityContext.Provider>;
  },
};
*/

import type { RapierRigidBody } from '@react-three/rapier';
import { World } from 'miniplex';
import { createReactAPI } from 'miniplex-react';
import type { CrowdAgent } from 'recast-navigation';
import type * as THREE from 'three';

export type EntityType = {
  three?: THREE.Object3D;
  rigidBody?: RapierRigidBody;
  traversable?: true;
  crowdAgent?: CrowdAgent;
  followPlayer?: true;
  player?: true;
};

const world = new World<EntityType>();

export const playerQuery = world.with('player', 'rigidBody');
export const traversableQuery = world.with('traversable', 'three');
export const crowdAgentQuery = world.with('crowdAgent');
export const followersQuery = world.with('crowdAgent', 'followPlayer');

const ECS = createReactAPI(world);
const { Entity, Component } = ECS;

export { ECS, Entity, Component };
