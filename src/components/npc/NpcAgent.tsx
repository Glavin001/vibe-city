import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier'
import type { RapierRigidBody, RapierCollider } from '@react-three/rapier'
import { LabelSprite, InventoryItem } from '../../lib/bunker-scene'
import { NODE_POS } from '../../lib/bunker-world'
import type { Vec3, NodeId } from '../../lib/bunker-world'
import type { Inventory } from '../../lib/npc-commands'
import { NODE_TITLES } from '../../lib/npc-commands'
import { FacingArrow } from '../scene/FacingArrow'

type CharacterControllerAny = {
  enableAutostep: (maxStepHeight: number, minStepWidth: number, considerDynamicBodies: boolean) => void
  enableSnapToGround: (distance: number) => void
  setApplyImpulsesToDynamicBodies: (enabled: boolean) => void
  computeColliderMovement: (collider: RapierCollider, movement: { x: number; y: number; z: number }) => void
  computedMovement: () => { x: number; y: number; z: number }
  computedGrounded: () => boolean
}

export type AgentPose = {
  position: Vec3
  yaw: number
  pitch: number
}

export type NpcAction = 
  | { type: 'move'; to: NodeId }
  | { type: 'jump'; height?: number; durationMs?: number }
  | { type: 'wave'; durationMs?: number }
  | { type: 'pickup_key' }
  | { type: 'unlock_storage' }
  | { type: 'pickup_c4' }
  | { type: 'place_c4' }
  | { type: 'detonate' }
  | { type: 'pickup_star' }

export type NpcApi = {
  enqueuePlan: (actions: NpcAction[], opts?: { replace?: boolean }) => void
  abortAll: () => void
  getPose: () => AgentPose
  isBusy: () => boolean
  getQueue: () => NpcAction[]
  emit: (text: string) => void
  __ready?: boolean
}

export type WorldState = {
  keyOnTable: boolean
  c4Available: boolean
  starPresent: boolean
  hasKey: boolean
  hasC4: boolean
  hasStar: boolean
  storageUnlocked: boolean
  c4Placed: boolean
  bunkerBreached: boolean
}

export type WorldOps = {
  getWorld: () => WorldState
  pickupKey: (by: string, getPose: (id: string) => Vec3) => Promise<boolean>
  unlockStorage: (by: string, getPose: (id: string) => Vec3) => Promise<boolean>
  pickupC4: (by: string, getPose: (id: string) => Vec3) => Promise<boolean>
  placeC4: (by: string, getPose: (id: string) => Vec3) => Promise<boolean>
  detonate: () => Promise<boolean>
  pickupStar: (by: string, getPose: (id: string) => Vec3) => Promise<boolean>
  setNpcInventory: (id: string, next: Partial<Inventory>) => void
}

function distance2D(a: Vec3, b: Vec3) {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return Math.hypot(dx, dz)
}

function direction2D(from: Vec3, to: Vec3): [number, number] {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  const len = Math.hypot(dx, dz) || 1
  return [dx / len, dz / len]
}

function yawTowards(from: Vec3, to: Vec3): number {
  const [dx, dz] = [to[0] - from[0], to[2] - from[2]]
  return Math.atan2(dx, -dz)
}

export function NpcAgent({ 
  id, 
  name, 
  color, 
  initialPos, 
  apiRegistry, 
  inv, 
  worldOps,
  usePhysics = false,
}: {
  id: string
  name: string
  color: string
  initialPos: Vec3
  apiRegistry: React.MutableRefObject<Record<string, NpcApi>>
  inv: Inventory
  worldOps: React.MutableRefObject<WorldOps>
  usePhysics?: boolean
}) {
  const groupRef = useRef<THREE.Group | null>(null)
  const rigidBodyRef = useRef<RapierRigidBody | null>(null)
  const colliderRef = useRef<RapierCollider | null>(null)
  const poseRef = useRef<AgentPose>({ position: [...initialPos] as Vec3, yaw: 0, pitch: 0 })
  const wavePhaseRef = useRef<number>(0)
  const waveAmpRef = useRef<number>(0)
  const baseY = initialPos[1]
  const jumpOffsetRef = useRef<number>(0)
  const queueRef = useRef<NpcAction[]>([])
  const cancelCurrentRef = useRef<() => void>(() => {})
  const isBusyRef = useRef<boolean>(false)

  const { world, rapier } = useRapier()
  const characterController = useRef<CharacterControllerAny | null>(null)

  // Init Rapier controller if using physics
  useEffect(() => {
    if (!usePhysics || !rapier || !world) return
    const ctrl = (world as unknown as { createCharacterController: (sn: number) => CharacterControllerAny }).createCharacterController(0.1)
    ctrl.enableAutostep(0.7, 0.3, true)
    ctrl.enableSnapToGround(0.1)
    ctrl.setApplyImpulsesToDynamicBodies(true)
    characterController.current = ctrl
    return () => {
      if (characterController.current) {
        (world as unknown as { removeCharacterController: (c: CharacterControllerAny) => void }).removeCharacterController(characterController.current)
        characterController.current = null
      }
    }
  }, [usePhysics, rapier, world])

  // Initialize position
  useEffect(() => {
    poseRef.current.position = [...initialPos] as Vec3
    if (usePhysics && rigidBodyRef.current) {
      rigidBodyRef.current.setNextKinematicTranslation({ x: initialPos[0], y: initialPos[1] + 1.5, z: initialPos[2] })
    }
  }, [initialPos, usePhysics])

  // Register API for this NPC
  useEffect(() => {
    apiRegistry.current[id] = {
      enqueuePlan: (actions: NpcAction[], opts?: { replace?: boolean }) => {
        if (opts?.replace) {
          try { cancelCurrentRef.current() } catch {}
          queueRef.current = []
        }
        queueRef.current.push(...actions)
      },
      abortAll: () => {
        try { cancelCurrentRef.current() } catch {}
        queueRef.current = []
      },
      getPose: () => poseRef.current,
      isBusy: () => isBusyRef.current,
      getQueue: () => queueRef.current.slice(),
      emit: () => {},
      __ready: true,
    }
    return () => { delete apiRegistry.current[id] }
  }, [apiRegistry, id])

  // Action executors
  function execMoveNoPhysics(to: Vec3, speed = 3, toNodeId?: NodeId): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    const epsilon = 0.05
    return new Promise((resolve) => {
      let last = performance.now()
      function step(now: number) {
        if (cancelled) return resolve()
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        const cur = poseRef.current.position
        const dist = distance2D(cur, to)
        if (dist <= epsilon) {
          poseRef.current.position = [to[0], baseY, to[2]]
          apiRegistry.current[id]?.emit(`✅ Reached ${toNodeId ? NODE_TITLES[toNodeId] : 'target'}`)
          resolve(); return
        }
        const [dx, dz] = direction2D(cur, to)
        const stepLen = Math.min(dist, speed * dt)
        poseRef.current.position = [cur[0] + dx * stepLen, baseY, cur[2] + dz * stepLen]
        poseRef.current.yaw = yawTowards(cur, to)
        requestAnimationFrame(step)
      }
      apiRegistry.current[id]?.emit(`▶️ Moving to ${toNodeId ? NODE_TITLES[toNodeId] : 'target'}`)
      requestAnimationFrame(step)
    })
  }

  function execMovePhysics(to: Vec3, speed = 3, toNodeId?: NodeId): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    const epsilon = 0.15
    return new Promise((resolve) => {
      let last = performance.now()
      function step(now: number) {
        if (cancelled) return resolve()
        
        const body = rigidBodyRef.current
        const collider = colliderRef.current
        const ctrl = characterController.current
        if (!body || !collider || !ctrl) {
          requestAnimationFrame(step)
          return
        }

        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        
        const cur = poseRef.current.position
        const dist = distance2D(cur, to)
        
        if (dist <= epsilon) {
          poseRef.current.position = [to[0], cur[1], to[2]]
          apiRegistry.current[id]?.emit(`✅ Reached ${toNodeId ? NODE_TITLES[toNodeId] : 'target'}`)
          resolve()
          return
        }
        
        const [dx, dz] = direction2D(cur, to)
        const movement = { x: dx * speed * dt, y: -0.5 * dt, z: dz * speed * dt }
        
        ctrl.computeColliderMovement(collider, movement)
        const translation = body.translation()
        const move = ctrl.computedMovement()
        
        const next = new THREE.Vector3(translation.x + move.x, translation.y + move.y, translation.z + move.z)
        body.setNextKinematicTranslation(next)
        
        poseRef.current.position = [next.x, next.y - 0.9 + baseY, next.z]
        poseRef.current.yaw = yawTowards(cur, to)
        
        requestAnimationFrame(step)
      }
      apiRegistry.current[id]?.emit(`▶️ Moving to ${toNodeId ? NODE_TITLES[toNodeId] : 'target'}`)
      requestAnimationFrame(step)
    })
  }

  function execMove(to: Vec3, speed = 3, toNodeId?: NodeId): Promise<void> {
    if (usePhysics) {
      return execMovePhysics(to, speed, toNodeId)
    }
    return execMoveNoPhysics(to, speed, toNodeId)
  }

  function execJump({ height = 0.8, durationMs = 600 }: { height?: number; durationMs?: number }): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    const start = performance.now()
    return new Promise((resolve) => {
      apiRegistry.current[id]?.emit(`🟰 Jumping`)
      function tick() {
        if (cancelled) return resolve()
        const now = performance.now()
        const p = Math.min(1, (now - start) / durationMs)
        jumpOffsetRef.current = Math.sin(p * Math.PI) * height
        if (p >= 1) {
          jumpOffsetRef.current = 0
          apiRegistry.current[id]?.emit(`✅ Finished jump`)
          resolve()
        } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  function execWave({ durationMs = 1500 }: { durationMs?: number }): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    const start = performance.now()
    waveAmpRef.current = 0.4
    return new Promise((resolve) => {
      apiRegistry.current[id]?.emit(`👋 Waving`)
      function tick() {
        if (cancelled) { waveAmpRef.current = 0; return resolve() }
        const now = performance.now()
        const p = Math.min(1, (now - start) / durationMs)
        wavePhaseRef.current = p * Math.PI * 2
        if (p >= 1) { waveAmpRef.current = 0; apiRegistry.current[id]?.emit(`✅ Finished wave`); resolve() }
        else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  async function execPickupKey(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`🗝️ Picking up key`)
    const ok = await worldOps.current.pickupKey(id, () => poseRef.current.position)
    if (ok && !cancelled) {
      worldOps.current.setNpcInventory(id, { hasKey: true })
      apiRegistry.current[id]?.emit(`✅ Key acquired`)
    } else if (!ok) {
      apiRegistry.current[id]?.emit(`⚠️ Cannot pick up key`)
    }
  }

  async function execUnlockStorage(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`🔓 Unlocking storage`)
    const ok = await worldOps.current.unlockStorage(id, () => poseRef.current.position)
    if (ok && !cancelled) apiRegistry.current[id]?.emit(`✅ Storage unlocked`)
    else apiRegistry.current[id]?.emit(`⚠️ Cannot unlock storage`)
  }

  async function execPickupC4(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`📦 Picking up C4`)
    const ok = await worldOps.current.pickupC4(id, () => poseRef.current.position)
    if (ok && !cancelled) {
      worldOps.current.setNpcInventory(id, { hasC4: true })
      apiRegistry.current[id]?.emit(`✅ C4 acquired`)
    } else apiRegistry.current[id]?.emit(`⚠️ Cannot pick up C4`)
  }

  async function execPlaceC4(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`📍 Placing C4 at bunker door`)
    const ok = await worldOps.current.placeC4(id, () => poseRef.current.position)
    if (ok && !cancelled) {
      worldOps.current.setNpcInventory(id, { hasC4: false })
      apiRegistry.current[id]?.emit(`✅ C4 placed`)
    } else apiRegistry.current[id]?.emit(`⚠️ Cannot place C4`)
  }

  async function execDetonate(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`💥 Detonating`) 
    const ok = await worldOps.current.detonate()
    if (ok && !cancelled) apiRegistry.current[id]?.emit(`✅ Bunker breached`) 
    else apiRegistry.current[id]?.emit(`⚠️ Cannot detonate`)
  }

  async function execPickupStar(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`⭐ Picking up star`)
    const ok = await worldOps.current.pickupStar(id, () => poseRef.current.position)
    if (ok && !cancelled) {
      worldOps.current.setNpcInventory(id, { hasStar: true })
      apiRegistry.current[id]?.emit(`✅ Star acquired`)
    } else apiRegistry.current[id]?.emit(`⚠️ Cannot pick up star`)
  }

  const runLoop = useRef<() => Promise<void>>(() => Promise.resolve())
  runLoop.current = async () => {
    if (isBusyRef.current) return
    isBusyRef.current = true
    try {
      while (queueRef.current.length) {
        const maybe = queueRef.current.shift()
        if (!maybe) break
        const action = maybe
        if (action.type === 'move') {
          const to = NODE_POS[action.to]
          await execMove(to, 3, action.to)
        } else if (action.type === 'jump') {
          await execJump(action)
        } else if (action.type === 'wave') {
          await execWave(action)
        } else if (action.type === 'pickup_key') {
          await execPickupKey()
        } else if (action.type === 'unlock_storage') {
          await execUnlockStorage()
        } else if (action.type === 'pickup_c4') {
          await execPickupC4()
        } else if (action.type === 'place_c4') {
          await execPlaceC4()
        } else if (action.type === 'detonate') {
          await execDetonate()
        } else if (action.type === 'pickup_star') {
          await execPickupStar()
        }
      }
    } finally {
      isBusyRef.current = false
    }
  }

  // Kick runner when queue changes
  useEffect(() => {
    const id = setInterval(() => { if (queueRef.current.length && !isBusyRef.current) void runLoop.current() }, 50)
    return () => clearInterval(id)
  }, [])

  // Render & animate
  useFrame(() => {
    if (usePhysics) {
      // Update group position from rigid body (capsule center at 0.9m when feet touch ground)
      const body = rigidBodyRef.current
      if (body && groupRef.current) {
        const translation = body.translation()
        groupRef.current.position.set(translation.x, translation.y - 0.9 + baseY + jumpOffsetRef.current, translation.z)
        const waveOffset = Math.sin(wavePhaseRef.current) * waveAmpRef.current
        groupRef.current.rotation.set(0, poseRef.current.yaw + waveOffset, 0)
      }
    } else {
      // Update group position from pose
      if (!groupRef.current) return
      const p = poseRef.current
      groupRef.current.position.set(p.position[0], baseY + jumpOffsetRef.current, p.position[2])
      const waveOffset = Math.sin(wavePhaseRef.current) * waveAmpRef.current
      groupRef.current.rotation.set(0, p.yaw + waveOffset, 0)
    }
  })

  const labelPos: Vec3 = [0, 2.2, 0] // Label above 1.8m tall agent
  
  const agentContent = (
    <>
      {/* Body capsule: 1.8m tall human (radius=0.3m, height=1.2m) */}
      <mesh castShadow position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.3, 1.2, 8, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Head sphere at top */}
      <mesh castShadow position={[0, 1.65, 0]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} />
      </mesh>
      <LabelSprite position={labelPos} text={name} />
      <FacingArrow origin={[poseRef.current.position[0], baseY + 1.65, poseRef.current.position[2]]} yaw={poseRef.current.yaw} />
      {inv.hasKey && (<InventoryItem agentPos={[poseRef.current.position[0], baseY, poseRef.current.position[2]]} type="key" color="#fbbf24" index={0} />)}
      {inv.hasC4 && (<InventoryItem agentPos={[poseRef.current.position[0], baseY, poseRef.current.position[2]]} type="c4" color="#ef4444" index={1} />)}
      {inv.hasStar && (<InventoryItem agentPos={[poseRef.current.position[0], baseY, poseRef.current.position[2]]} type="star" color="#fde68a" index={2} />)}
    </>
  )

  if (usePhysics) {
    return (
      <>
        <RigidBody 
          ref={rigidBodyRef} 
          type="kinematicPosition" 
          colliders={false} 
          enabledRotations={[false, false, false]} 
          position={[initialPos[0], initialPos[1] + 0.9, initialPos[2]]}
        >
          {/* Physics capsule: 1.8m tall human (halfHeight=0.6m, radius=0.3m) */}
          <CapsuleCollider ref={colliderRef} args={[0.6, 0.3]} />
        </RigidBody>
        <group ref={groupRef}>
          {agentContent}
        </group>
      </>
    )
  }

  return (
    <group ref={groupRef}>
      {agentContent}
    </group>
  )
}

