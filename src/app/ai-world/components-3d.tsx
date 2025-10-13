import React from 'react'
import { RigidBody } from '@react-three/rapier'
import { Text, PointerLockControls } from '@react-three/drei'
import { PlayerKCC } from '@/components/physics/PlayerKCC'
import { Building, Ground } from '@/lib/bunker-scene'
import { BUILDINGS } from '@/lib/bunker-world'
import type { Vec3, AgentPose } from './types'
import type { EntityId, World } from './actions'
import { GRID_CONFIG } from './config'

/* ============================= BUILDING ============================= */
// Buildings now use the shared Building component from bunker-scene
// (imported at top)

/* ============================= WORLD ITEM ============================= */

export function WorldItem({ 
  position, 
  name, 
  color 
}: { 
  id: EntityId
  position: Vec3
  name: string
  color: string 
}) {
  return (
    <RigidBody type="fixed" position={position} colliders="ball">
      <mesh castShadow>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} />
      </mesh>
      <Text
        position={[0, 0.5, 0]}
        fontSize={0.15}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </RigidBody>
  )
}

/* ============================= WORLD MACHINE ============================= */

export function WorldMachine({ 
  position, 
  name, 
  color 
}: { 
  id: EntityId
  position: Vec3
  name: string
  color: string 
}) {
  return (
    <RigidBody type="fixed" position={position} colliders="cuboid">
      <mesh castShadow>
        <boxGeometry args={[1, 1.5, 0.8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Text
        position={[0, 1.2, 0]}
        fontSize={0.2}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </RigidBody>
  )
}

/* ============================= NPC CHARACTER ============================= */

export function NpcCharacter({ 
  position, 
  name, 
  color 
}: { 
  id: EntityId
  position: Vec3
  name: string
  color: string 
}) {
  return (
    <RigidBody type="dynamic" colliders="ball" position={position} lockRotations>
      <mesh castShadow>
        <capsuleGeometry args={[0.3, 1, 8, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Text
        position={[0, 1.2, 0]}
        fontSize={0.25}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {name}
      </Text>
    </RigidBody>
  )
}

/* ============================= PLAYER CONTROLLER ============================= */
// Moved to components-player.tsx for keyboard controls

/* ============================= SCENE ============================= */

function SceneInner({ 
  world, 
  playerPoseRef, 
  playerSpawn,
  onLock, 
  onUnlock 
}: { 
  world: World
  playerPoseRef: React.MutableRefObject<AgentPose>
  playerSpawn: Vec3
  onLock: () => void
  onUnlock: () => void
}) {
  // Extract entities from world
  const agents = Array.from(world.agents.entries()).filter(([id]) => !id.startsWith('player'))
  const items = Array.from(world.items.entries())
  const machines = Array.from(world.machines.entries())
  
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} castShadow />
      <directionalLight position={[-10, 15, -10]} intensity={0.4} />
      
      <Ground />
      <gridHelper 
        args={[
          GRID_CONFIG.size, 
          GRID_CONFIG.divisions, 
          GRID_CONFIG.colorCenterLine, 
          GRID_CONFIG.colorGrid
        ]} 
        position={[0, 0.01, 0]} 
      />
      
      {/* Buildings - using proper Building component from bunker-scene */}
      <Building
        center={BUILDINGS.STORAGE.center}
        size={BUILDINGS.STORAGE.size}
        color="#3f6212"
        label="Kitchen"
        doorFace={BUILDINGS.STORAGE.doorFace}
        doorSize={BUILDINGS.STORAGE.doorSize}
        showDoor={true}
      />
      <Building
        center={BUILDINGS.BUNKER.center}
        size={BUILDINGS.BUNKER.size}
        color="#374151"
        label="Storage"
        doorFace={BUILDINGS.BUNKER.doorFace}
        doorSize={BUILDINGS.BUNKER.doorSize}
        showDoor={true}
      />
      
      {/* NPCs */}
      {agents.map(([id, agent]) => {
        const pos = world.positions.get(id)
        if (!pos) return null
        return (
          <NpcCharacter
            key={id}
            id={id}
            position={[pos.x, pos.y, pos.z ?? 0]}
            name={agent.name}
            color={agent.name === 'Alice' ? '#ec4899' : '#3b82f6'}
          />
        )
      })}
      
      {/* Items */}
      {items.map(([id, item]) => {
        const pos = world.positions.get(id)
        
        // Check if item is in any agent's inventory
        let inInventory = false
        for (const [, agentInv] of world.inventories.entries()) {
          if (agentInv.items.includes(id)) {
            inInventory = true
            break
          }
        }
        if (inInventory) return null
        
        if (!pos) return null
        const color = item.tags.includes('Mug') ? '#fbbf24' : '#10b981'
        return (
          <WorldItem
            key={id}
            id={id}
            position={[pos.x, pos.y, pos.z ?? 0]}
            name={item.name}
            color={color}
          />
        )
      })}
      
      {/* Machines */}
      {machines.map(([id, machine]) => {
        const pos = world.positions.get(id)
        if (!pos) return null
        return (
          <WorldMachine
            key={id}
            id={id}
            position={[pos.x, pos.y, pos.z ?? 0]}
            name={machine.name}
            color="#8b5cf6"
          />
        )
      })}
      
      {/* Player with physics */}
      <PlayerKCC 
        start={playerSpawn} 
        poseRef={playerPoseRef}
        eyeHeight={1.65}
        initialYaw={3/4 * Math.PI}
        initialPitch={0}
      />
      
      <PointerLockControls makeDefault onLock={onLock} onUnlock={onUnlock} selector="#aiworld-canvas" />
    </>
  )
}

export const Scene = React.memo(SceneInner)

