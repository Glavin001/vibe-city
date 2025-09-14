'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls, useKeyboardControls, Line } from '@react-three/drei'
import { Ground, BoxMarker, Building, LabelSprite, EnhancedObject, SmallSphere, InventoryItem } from '../../lib/bunker-scene'
import { BUILDINGS, N, NODE_POS, type Vec3, type NodeId } from '../../lib/bunker-world'
import type * as React from 'react'

type Controls = 'forward' | 'backward' | 'left' | 'right' | 'run'

type AgentPose = {
  position: Vec3
  yaw: number // radians, around +Y
  pitch: number // radians, around +X
}

type WorldState = {
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

// type retained only if needed in future
// type Npc = {
//   id: string
//   name: string
//   color: string
//   pose: AgentPose
// }

type ChatMessage = {
  id: string
  npcId: string
  sender: 'me' | 'npc'
  text: string
  ts: number
}

const PLAYER_EYE_HEIGHT = 1.6
const MOVE_SPEED = 5
const RUN_SPEED = 9

const direction = new THREE.Vector3()
const upVector = new THREE.Vector3(0, 1, 0)
const camForward = new THREE.Vector3()
const camRight = new THREE.Vector3()

function Player({ poseRef, jumpOffsetRef, onLock, onUnlock, startSelector }: {
  poseRef: React.MutableRefObject<AgentPose>;
  jumpOffsetRef: React.MutableRefObject<number>;
  onLock?: () => void;
  onUnlock?: () => void;
  startSelector?: string;
}) {
  const [, get] = useKeyboardControls<Controls>()
  const camera = useThree((state) => state.camera)

  useEffect(() => {
    const spawn = NODE_POS[N.COURTYARD]
    camera.position.set(spawn[0], PLAYER_EYE_HEIGHT, spawn[2])
    camera.rotation.set(0, 0, 0)
    poseRef.current = { position: [spawn[0], PLAYER_EYE_HEIGHT, spawn[2]], yaw: 0, pitch: 0 }
  }, [camera, poseRef])

  useFrame((_, delta) => {
    const { forward, backward, left, right, run } = get()
    const speed = (run ? RUN_SPEED : MOVE_SPEED) * delta

    // Compute camera-relative directions projected onto ground (ignore pitch)
    camera.getWorldDirection(camForward)
    camForward.y = 0
    if (camForward.lengthSq() > 0) camForward.normalize()
    camRight.copy(camForward).cross(upVector).normalize()

    // Compose movement
    direction.set(0, 0, 0)
    const forwardMove = Number(forward) - Number(backward)
    const rightMove = Number(right) - Number(left)
    if (forwardMove !== 0) direction.addScaledVector(camForward, forwardMove * speed)
    if (rightMove !== 0) direction.addScaledVector(camRight, rightMove * speed)

    camera.position.add(direction)
    camera.position.y = PLAYER_EYE_HEIGHT + (jumpOffsetRef.current || 0)

    poseRef.current = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      yaw: camera.rotation.y,
      pitch: camera.rotation.x,
    }
  })
  return <PointerLockControls makeDefault onLock={onLock} onUnlock={onUnlock} selector={startSelector} />
}

function FacingArrow({ origin, yaw, length = 1.5, color = '#22d3ee' }: { origin: Vec3; yaw: number; length?: number; color?: string }) {
  const forward = useMemo(() => {
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return dir
  }, [yaw])
  const end: Vec3 = useMemo(() => [origin[0] + forward.x * length, origin[1], origin[2] + forward.z * length], [origin, forward, length])
  return <Line points={[origin, end]} color={color} lineWidth={2} dashed={false} />
}

// (Removed in-world ActionButton; replaced with DOM toolbar buttons below the canvas)

// --- NPC ACTION SYSTEM ---
type MoveAction = { type: 'move'; to: NodeId }
type JumpAction = { type: 'jump'; height?: number; durationMs?: number }
type WaveAction = { type: 'wave'; durationMs?: number }
type PickupKeyAction = { type: 'pickup_key' }
type UnlockStorageAction = { type: 'unlock_storage' }
type PickupC4Action = { type: 'pickup_c4' }
type PlaceC4Action = { type: 'place_c4' }
type DetonateAction = { type: 'detonate' }
type PickupStarAction = { type: 'pickup_star' }
type NpcAction =
  | MoveAction
  | JumpAction
  | WaveAction
  | PickupKeyAction
  | UnlockStorageAction
  | PickupC4Action
  | PlaceC4Action
  | DetonateAction
  | PickupStarAction

// NodeId type is imported from bunker-world

type NpcApi = {
  enqueuePlan: (actions: NpcAction[], opts?: { replace?: boolean }) => void
  abortAll: () => void
  getPose: () => AgentPose
  isBusy: () => boolean
  getQueue: () => NpcAction[]
  emit: (text: string) => void
  __ready?: boolean
}

const NODE_TITLES: Record<NodeId, string> = {
  [N.COURTYARD]: 'Courtyard',
  [N.TABLE]: 'Table',
  [N.STORAGE_DOOR]: 'Storage Door',
  [N.STORAGE_INT]: 'Storage Interior',
  [N.C4_TABLE]: 'C4 Table',
  [N.BUNKER_DOOR]: 'Bunker Door',
  [N.BUNKER_INT]: 'Bunker Interior',
  [N.STAR]: 'Star',
  [N.SAFE]: 'Blast Safe Zone',
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
  return Math.atan2(dx, -dz) // same convention as camera forward
}

const LOCATION_ALIASES: Record<string, NodeId> = {
  'courtyard': N.COURTYARD,
  'table': N.TABLE,
  'storage door': N.STORAGE_DOOR,
  'storage interior': N.STORAGE_INT,
  'storage': N.STORAGE_INT,
  'c4 table': N.C4_TABLE,
  'bunker door': N.BUNKER_DOOR,
  'bunker interior': N.BUNKER_INT,
  'bunker': N.BUNKER_INT,
  'star': N.STAR,
  'blast safe zone': N.SAFE,
  'safe': N.SAFE,
}

function aliasToNodeId(name: string): NodeId | null {
  const node = LOCATION_ALIASES[name.trim().toLowerCase()]
  return node ?? null
}

// Command definitions - single source of truth for all commands
type CommandCategory = 'movement' | 'action' | 'control' | 'planner'

type CommandDef = {
  id: string
  category: CommandCategory
  patterns: RegExp[]
  buttonLabel: string
  description: string
  examples: string[]
  parseAction: (match: RegExpMatchArray | null, input: string) => NpcAction | null
  quickAction?: () => NpcAction[] // For quick buttons
}

const COMMAND_DEFINITIONS: CommandDef[] = [
  // Control commands
  {
    id: 'stop',
    category: 'control',
    patterns: [/^(stop|abort|cancel)$/i],
    buttonLabel: '⏹️ Stop',
    description: 'Stop all current actions',
    examples: ['stop', 'abort', 'cancel'],
    parseAction: () => null, // Special handling in parser
  },
  // Movement commands
  {
    id: 'move',
    category: 'movement',
    patterns: [/^((move|go)\s+to)\s+(.+)$/i],
    buttonLabel: '📍 Move to...',
    description: 'Move to a specific location',
    examples: ['move to table', 'go to bunker door', 'move to storage'],
    parseAction: (match) => {
      if (!match) return null
      const locStr = match[3].trim()
      const node = aliasToNodeId(locStr)
      if (!node) return null
      return { type: 'move', to: node }
    },
  },
  {
    id: 'jump',
    category: 'movement',
    patterns: [/^jump(\s+once)?$/i],
    buttonLabel: '🟰 Jump',
    description: 'Jump in place',
    examples: ['jump', 'jump once'],
    parseAction: () => ({ type: 'jump', height: 0.8, durationMs: 600 }),
    quickAction: () => [{ type: 'jump', height: 0.8, durationMs: 600 }],
  },
  {
    id: 'wave',
    category: 'movement',
    patterns: [/^wave(\s+for\s+(\d+)(s|\s*seconds)?)?$/i],
    buttonLabel: '👋 Wave',
    description: 'Wave for a duration (default 1.5s)',
    examples: ['wave', 'wave for 3s', 'wave for 5 seconds'],
    parseAction: (match) => {
      const dur = match?.[2] ? Number(match[2]) * 1000 : 1500
      return { type: 'wave', durationMs: dur }
    },
    quickAction: () => [{ type: 'wave', durationMs: 1500 }],
  },
  // Action commands
  {
    id: 'pickup_key',
    category: 'action',
    patterns: [/^pick\s*up\s*key$/i],
    buttonLabel: '🗝️ Pick up Key',
    description: 'Pick up the key from the table',
    examples: ['pick up key', 'pickup key'],
    parseAction: () => ({ type: 'pickup_key' }),
    quickAction: () => [{ type: 'move', to: N.TABLE }, { type: 'pickup_key' }],
  },
  {
    id: 'unlock_storage',
    category: 'action',
    patterns: [/^unlock(\s*storage)?$/i],
    buttonLabel: '🔓 Unlock Storage',
    description: 'Unlock the storage door (requires key)',
    examples: ['unlock', 'unlock storage'],
    parseAction: () => ({ type: 'unlock_storage' }),
    quickAction: () => [{ type: 'move', to: N.STORAGE_DOOR }, { type: 'unlock_storage' }],
  },
  {
    id: 'pickup_c4',
    category: 'action',
    patterns: [/^pick\s*up\s*c4$/i],
    buttonLabel: '📦 Pick up C4',
    description: 'Pick up C4 explosives from storage',
    examples: ['pick up c4', 'pickup c4'],
    parseAction: () => ({ type: 'pickup_c4' }),
    quickAction: () => [{ type: 'move', to: N.C4_TABLE }, { type: 'pickup_c4' }],
  },
  {
    id: 'place_c4',
    category: 'action',
    patterns: [/^place\s*c4$/i],
    buttonLabel: '📍 Place C4',
    description: 'Place C4 at the bunker door',
    examples: ['place c4'],
    parseAction: () => ({ type: 'place_c4' }),
    quickAction: () => [{ type: 'move', to: N.BUNKER_DOOR }, { type: 'place_c4' }],
  },
  {
    id: 'detonate',
    category: 'action',
    patterns: [/^detonate$/i],
    buttonLabel: '💥 Detonate',
    description: 'Detonate the placed C4',
    examples: ['detonate'],
    parseAction: () => ({ type: 'detonate' }),
    quickAction: () => [{ type: 'move', to: N.SAFE }, { type: 'detonate' }],
  },
  {
    id: 'pickup_star',
    category: 'action',
    patterns: [/^pick\s*up\s*star$/i],
    buttonLabel: '⭐ Pick up Star',
    description: 'Pick up the star from the bunker',
    examples: ['pick up star', 'pickup star'],
    parseAction: () => ({ type: 'pickup_star' }),
    quickAction: () => [{ type: 'move', to: N.STAR }, { type: 'pickup_star' }],
  },
]

// Helper to get available locations for help text
function getLocationsList(): string {
  return Object.keys(LOCATION_ALIASES).join(', ')
}

function parseCommandToActions(input: string): { actions?: NpcAction[]; error?: string; isAbort?: boolean } {
  const segments = input
    .toLowerCase()
    .split(/(?:,|;|\band then\b|\bthen\b|\band\b)/g)
    .map(s => s.trim())
    .filter(Boolean)

  const actions: NpcAction[] = []
  
  for (const seg of segments) {
    let matched = false
    
    // Check each command definition
    for (const cmdDef of COMMAND_DEFINITIONS) {
      for (const pattern of cmdDef.patterns) {
        const match = seg.match(pattern)
        if (match) {
          // Special handling for stop/abort
          if (cmdDef.id === 'stop') {
            return { isAbort: true }
          }
          
          const action = cmdDef.parseAction(match, seg)
          if (action) {
            actions.push(action)
            matched = true
            break
          } else if (cmdDef.id === 'move') {
            // If move command failed, it's likely an unknown location
            const locStr = match[3].trim()
            return { error: `Unknown location: ${locStr}. Available locations: ${getLocationsList()}` }
          }
        }
      }
      if (matched) break
    }
    
    if (!matched) {
      return { error: `Unknown command: "${seg}". Type 'help' to see available commands.` }
    }
  }
  
  if (!actions.length) return { error: 'No commands found' }
  return { actions }
}

type Inventory = { hasKey: boolean; hasC4: boolean; hasStar: boolean }

function NpcAgent({ id, name, color, initialPos, apiRegistry, inv, worldOps }: {
  id: string;
  name: string;
  color: string;
  initialPos: Vec3;
  apiRegistry: React.MutableRefObject<Record<string, NpcApi>>;
  inv: Inventory;
  worldOps: React.MutableRefObject<{
    getWorld: () => WorldState;
    pickupKey: (by: string) => Promise<boolean>;
    unlockStorage: (by: string) => Promise<boolean>;
    pickupC4: (by: string) => Promise<boolean>;
    placeC4: (by: string) => Promise<boolean>;
    detonate: () => Promise<boolean>;
    pickupStar: (by: string) => Promise<boolean>;
    setNpcInventory: (id: string, next: Partial<Inventory>) => void;
  }>;
}): React.ReactElement {
  const groupRef = useRef<THREE.Group | null>(null)
  const poseRef = useRef<AgentPose>({ position: [...initialPos] as Vec3, yaw: 0, pitch: 0 })
  const wavePhaseRef = useRef<number>(0)
  const waveAmpRef = useRef<number>(0)
  const baseY = initialPos[1]
  const jumpOffsetRef = useRef<number>(0)
  const queueRef = useRef<NpcAction[]>([])
  const cancelCurrentRef = useRef<() => void>(() => {})
  const isBusyRef = useRef<boolean>(false)

  useEffect(() => {
    poseRef.current.position = [...initialPos] as Vec3
  }, [initialPos])

  // Register API for this NPC
  useEffect(() => {
    apiRegistry.current[id] = {
      enqueuePlan: (actions: NpcAction[], opts?: { replace?: boolean }) => {
        console.log('enqueuePlan', actions, opts)
        if (opts?.replace) {
          // Abort and replace queue
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
  function execMove(to: Vec3, speed = 3, toNodeId?: NodeId): Promise<void> {
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
        // Emit periodic progress
        // apiRegistry.current[id]?.emit(`… Moving ${(dist).toFixed(1)}m left`)
        requestAnimationFrame(step)
      }
      apiRegistry.current[id]?.emit(`▶️ Moving to ${toNodeId ? NODE_TITLES[toNodeId] : 'target'}`)
      requestAnimationFrame(step)
    })
  }

  function execJump({ height = 0.8, durationMs = 600 }: JumpAction): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    const start = performance.now()
    return new Promise((resolve) => {
      apiRegistry.current[id]?.emit(`🟰 Jumping`)
      function tick() {
        if (cancelled) return resolve()
        const now = performance.now()
        const p = Math.min(1, (now - start) / durationMs)
        // simple up/down parabola
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

  function execWave({ durationMs = 1500 }: WaveAction): Promise<void> {
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
    const ok = await worldOps.current.pickupKey(id)
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
    const ok = await worldOps.current.unlockStorage(id)
    if (ok && !cancelled) apiRegistry.current[id]?.emit(`✅ Storage unlocked`)
    else apiRegistry.current[id]?.emit(`⚠️ Cannot unlock storage`)
  }

  async function execPickupC4(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`📦 Picking up C4`)
    const ok = await worldOps.current.pickupC4(id)
    if (ok && !cancelled) {
      worldOps.current.setNpcInventory(id, { hasC4: true })
      apiRegistry.current[id]?.emit(`✅ C4 acquired`)
    } else apiRegistry.current[id]?.emit(`⚠️ Cannot pick up C4`)
  }

  async function execPlaceC4(): Promise<void> {
    let cancelled = false
    cancelCurrentRef.current = () => { cancelled = true }
    apiRegistry.current[id]?.emit(`📍 Placing C4 at bunker door`)
    const ok = await worldOps.current.placeC4(id)
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
    const ok = await worldOps.current.pickupStar(id)
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
    if (!groupRef.current) return
    const p = poseRef.current
    groupRef.current.position.set(p.position[0], baseY + jumpOffsetRef.current, p.position[2])
    const waveOffset = Math.sin(wavePhaseRef.current) * waveAmpRef.current
    groupRef.current.rotation.set(0, p.yaw + waveOffset, 0)
  })

  const labelPos: Vec3 = [0, 2.3, 0]

  return (
    <group ref={groupRef}>
      <mesh castShadow position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.5, 1.0, 8, 16]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh castShadow position={[0, 1.8, 0]}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} />
      </mesh>
      <LabelSprite position={labelPos} text={name} />
      <FacingArrow origin={[poseRef.current.position[0], baseY + 1.6, poseRef.current.position[2]]} yaw={poseRef.current.yaw} />
      {inv.hasKey && (<InventoryItem agentPos={[poseRef.current.position[0], baseY, poseRef.current.position[2]]} type="key" color="#fbbf24" index={0} />)}
      {inv.hasC4 && (<InventoryItem agentPos={[poseRef.current.position[0], baseY, poseRef.current.position[2]]} type="c4" color="#ef4444" index={1} />)}
      {inv.hasStar && (<InventoryItem agentPos={[poseRef.current.position[0], baseY, poseRef.current.position[2]]} type="star" color="#fde68a" index={2} />)}
    </group>
  )
}

// (Old NpcAvatar removed)

// PlayerPoseSync removed; handled inside Player

// Help component that generates documentation from command definitions
function CommandHelp({ onClose }: { onClose: () => void }) {
  const categories = {
    control: { title: '🎛️ Control Commands', items: [] as CommandDef[] },
    movement: { title: '🚶 Movement Commands', items: [] as CommandDef[] },
    action: { title: '⚡ Action Commands', items: [] as CommandDef[] },
    planner: { title: '🤖 AI Planner', items: [] as CommandDef[] },
  }
  
  // Group commands by category
  COMMAND_DEFINITIONS.forEach(cmd => {
    if (categories[cmd.category]) {
      categories[cmd.category].items.push(cmd)
    }
  })
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">📖 Command Reference</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          {/* General syntax info */}
          <div className="mb-6 p-4 bg-gray-700/50 rounded-lg">
            <h3 className="text-sm font-semibold text-cyan-400 mb-2">💡 Tips</h3>
            <ul className="text-sm text-gray-300 space-y-1">
              <li>• Chain commands with commas, semicolons, "and", or "then"</li>
              <li>• Example: <code className="bg-gray-900 px-1 rounded">move to table, pick up key, then go to storage door</code></li>
              <li>• Available locations: <code className="bg-gray-900 px-1 rounded">{getLocationsList()}</code></li>
              <li>• Use the AI planner: <code className="bg-gray-900 px-1 rounded">plan get star</code> to auto-generate action sequences</li>
            </ul>
          </div>
          
          {/* Command categories */}
          {Object.entries(categories).map(([key, cat]) => (
            cat.items.length > 0 && (
              <div key={key} className="mb-6">
                <h3 className="text-sm font-semibold text-white mb-3">{cat.title}</h3>
                <div className="space-y-3">
                  {cat.items.map(cmd => (
                    <div key={cmd.id} className="bg-gray-700/30 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-1">
                        <h4 className="text-sm font-medium text-white">{cmd.buttonLabel}</h4>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{cmd.description}</p>
                      <div className="flex flex-wrap gap-2">
                        {cmd.examples.map((ex) => (
                          <code key={ex} className="text-xs bg-gray-900 px-2 py-1 rounded text-cyan-300">
                            {ex}
                          </code>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
          
          {/* Special commands */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-white mb-3">🤖 AI Planner</h3>
            <div className="bg-gray-700/30 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-2">Automatically plan complex sequences</p>
              <div className="flex flex-wrap gap-2">
                <code className="text-xs bg-gray-900 px-2 py-1 rounded text-cyan-300">plan get star</code>
                <code className="text-xs bg-gray-900 px-2 py-1 rounded text-cyan-300">has star</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Location picker component for move commands
function LocationPicker({ onSelect, onClose }: { onSelect: (location: NodeId) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">📍 Select Location</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2">
          {Object.entries(NODE_TITLES).map(([nodeId, title]) => (
            <button
              key={nodeId}
              className="text-sm px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-left"
              onClick={() => {
                onSelect(nodeId as NodeId)
                onClose()
              }}
              type="button"
            >
              {title}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function NpcChatPage() {
  const controlsMap = useMemo(() => (
    [
      { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
      { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
      { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
      { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
      { name: 'run', keys: ['Shift'] },
    ] as { name: Controls; keys: string[] }[]
  ), [])

  // Player pose state
  const [playerPose, setPlayerPose] = useState<AgentPose>({ position: [0, PLAYER_EYE_HEIGHT, 0], yaw: 0, pitch: 0 })
  const playerPoseRef = useRef<AgentPose>(playerPose)
  const playerJumpOffsetRef = useRef<number>(0)
  const playerWave = useRef<{ amp: number; phase: number }>({ amp: 0, phase: 0 })
  const [isLocked, setIsLocked] = useState<boolean>(false)
  useEffect(() => {
    const id = setInterval(() => setPlayerPose(playerPoseRef.current), 100)
    return () => clearInterval(id)
  }, [])
  // no-op placeholder removed

  // NPCs
  const [npcs] = useState([
    { id: 'npc_alex', name: 'Alex', color: '#60a5fa', pos: [NODE_POS[N.TABLE][0], 0, NODE_POS[N.TABLE][2]] as Vec3 },
    { id: 'npc_riley', name: 'Riley', color: '#f472b6', pos: [NODE_POS[N.BUNKER_DOOR][0] + 3, 0, NODE_POS[N.BUNKER_DOOR][2]] as Vec3 },
    { id: 'npc_sam', name: 'Sam', color: '#34d399', pos: [NODE_POS[N.STORAGE_DOOR][0] - 2, 0, NODE_POS[N.STORAGE_DOOR][2]] as Vec3 },
  ])
  const npcApisRef = useRef<Record<string, NpcApi>>({})
  const [npcInventories, setNpcInventories] = useState<Record<string, { hasKey: boolean; hasC4: boolean; hasStar: boolean }>>({})
  const npcInventoriesRef = useRef(npcInventories)
  useEffect(() => { npcInventoriesRef.current = npcInventories }, [npcInventories])
  function setNpcInventory(id: string, next: Partial<{ hasKey: boolean; hasC4: boolean; hasStar: boolean }>) {
    setNpcInventories((prev) => {
      const existing = prev[id] || { hasKey: false, hasC4: false, hasStar: false }
      const merged = { ...existing, ...next }
      return { ...prev, [id]: merged }
    })
  }

  // Chat state
  const [selectedNpcId, setSelectedNpcId] = useState<string>('npc_alex')
  const [messagesByNpc, setMessagesByNpc] = useState<Record<string, ChatMessage[]>>({
    npc_alex: [{ id: 'm1', npcId: 'npc_alex', sender: 'npc', text: 'Hey! Use WASD to move, mouse to look. Type "help" for commands.', ts: Date.now() }],
    npc_riley: [{ id: 'm2', npcId: 'npc_riley', sender: 'npc', text: 'Standing by the bunker door.', ts: Date.now() }],
    npc_sam: [{ id: 'm3', npcId: 'npc_sam', sender: 'npc', text: 'Guarding storage entrance.', ts: Date.now() }],
  })
  const [draft, setDraft] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showLocationPicker, setShowLocationPicker] = useState(false)

  // Shared world state
  const [world, setWorld] = useState<WorldState>({
    keyOnTable: true,
    c4Available: true,
    starPresent: true,
    hasKey: false,
    hasC4: false,
    hasStar: false,
    storageUnlocked: false,
    c4Placed: false,
    bunkerBreached: false,
  })
  const worldRef = useRef(world)
  useEffect(() => { worldRef.current = world }, [world])
  const [boom, setBoom] = useState<{ at?: Vec3; t?: number }>({})
  // Player inventory separate from world flags
  const [playerInv, setPlayerInv] = useState<{ hasKey: boolean; hasC4: boolean; hasStar: boolean }>({ hasKey: false, hasC4: false, hasStar: false })
  const playerInvRef = useRef(playerInv)
  useEffect(() => { playerInvRef.current = playerInv }, [playerInv])

  // Helpers
  const distTo = useCallback((pos: Vec3) => {
    const p = playerPoseRef.current.position
    const dx = p[0] - pos[0]
    const dz = p[2] - pos[2]
    return Math.hypot(dx, dz)
  }, [])

  // Shared world operations (used by NPCs and player)
  const worldOps = useRef({
    getWorld: () => world,
    pickupKey: async (by: string) => {
      // Must be near table and key available
      const pos = by === 'player' ? playerPoseRef.current.position : (npcApisRef.current[by]?.getPose().position || [0, 0, 0])
      const near = distance2D(pos, NODE_POS[N.TABLE]) <= 1.6
      if (!world.keyOnTable || !near) return false
      setWorld((w) => ({ ...w, keyOnTable: false }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasKey: true }))
      return true
    },
    unlockStorage: async (by: string) => {
      const pos = by === 'player' ? playerPoseRef.current.position : (npcApisRef.current[by]?.getPose().position || [0, 0, 0])
      const near = distance2D(pos, NODE_POS[N.STORAGE_DOOR]) <= 1.8
      const hasKey = by === 'player' ? playerInvRef.current.hasKey : (npcInventoriesRef.current[by]?.hasKey === true)
      if (worldRef.current.storageUnlocked || !hasKey || !near) return false
      await new Promise((r) => setTimeout(r, 150))
      setWorld((w) => ({ ...w, storageUnlocked: true }))
      return true
    },
    pickupC4: async (by: string) => {
      const pos = by === 'player' ? playerPoseRef.current.position : (npcApisRef.current[by]?.getPose().position || [0, 0, 0])
      const near = distance2D(pos, NODE_POS[N.C4_TABLE]) <= 1.6
      if (!worldRef.current.c4Available || !near) return false
      setWorld((w) => ({ ...w, c4Available: false }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasC4: true }))
      return true
    },
    placeC4: async (by: string) => {
      const pos = by === 'player' ? playerPoseRef.current.position : (npcApisRef.current[by]?.getPose().position || [0, 0, 0])
      const near = distance2D(pos, NODE_POS[N.BUNKER_DOOR]) <= 1.8
      const hasC4 = by === 'player' ? playerInvRef.current.hasC4 : (npcInventoriesRef.current[by]?.hasC4 === true)
      if (worldRef.current.c4Placed || worldRef.current.bunkerBreached || !hasC4 || !near) return false
      setWorld((w) => ({ ...w, c4Placed: true }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasC4: false }))
      return true
    },
    detonate: async () => {
      if (!worldRef.current.c4Placed || worldRef.current.bunkerBreached) return false
      setBoom({ at: [NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.6, NODE_POS[N.BUNKER_DOOR][2]], t: performance.now() })
      await new Promise((r) => setTimeout(r, 380))
      setBoom({})
      setWorld((w) => ({ ...w, bunkerBreached: true, c4Placed: false }))
      return true
    },
    pickupStar: async (by: string) => {
      const pos = by === 'player' ? playerPoseRef.current.position : (npcApisRef.current[by]?.getPose().position || [0, 0, 0])
      const near = distance2D(pos, NODE_POS[N.STAR]) <= 1.6
      if (!world.starPresent || !near) return false
      setWorld((w) => ({ ...w, starPresent: false }))
      if (by === 'player') setPlayerInv((i) => ({ ...i, hasStar: true }))
      return true
    },
    setNpcInventory: setNpcInventory,
  })

  // Player action helpers
  const [interactPrompt, setInteractPrompt] = useState<string>('')
  const interactHandlerRef = useRef<() => void>(() => {})
  useEffect(() => {
    const id = setInterval(() => {
      const near = (node: NodeId, r: number) => distTo(NODE_POS[node]) <= r
      const pKey = world.keyOnTable && near(N.TABLE, 1.7)
      const pUnlock = !world.storageUnlocked && playerInv.hasKey && near(N.STORAGE_DOOR, 1.9)
      const pC4 = world.c4Available && near(N.C4_TABLE, 1.7)
      const pPlace = !world.bunkerBreached && !world.c4Placed && playerInv.hasC4 && near(N.BUNKER_DOOR, 1.9)
      const pStar = world.starPresent && near(N.STAR, 1.7)
      if (pKey) {
        setInteractPrompt('Press E to Pick up Key')
        interactHandlerRef.current = () => { void worldOps.current.pickupKey('player') }
        return
      }
      if (pUnlock) {
        setInteractPrompt('Press E to Unlock Storage')
        interactHandlerRef.current = () => { void worldOps.current.unlockStorage('player') }
        return
      }
      if (pC4) {
        setInteractPrompt('Press E to Pick up C4')
        interactHandlerRef.current = () => { void worldOps.current.pickupC4('player') }
        return
      }
      if (pPlace) {
        setInteractPrompt('Press E to Place C4')
        interactHandlerRef.current = () => { void worldOps.current.placeC4('player') }
        return
      }
      if (pStar) {
        setInteractPrompt('Press E to Pick up Star')
        interactHandlerRef.current = () => { void worldOps.current.pickupStar('player') }
        return
      }
      setInteractPrompt('')
      interactHandlerRef.current = () => {}
    }, 120)
    return () => clearInterval(id)
  }, [world, playerInv, distTo])

  // Keyboard bindings for player actions
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'e' || e.key === 'E') {
        interactHandlerRef.current()
      } else if (e.key === ' ') {
        // jump
        if (playerJumpOffsetRef.current > 0) return
        const start = performance.now()
        const dur = 600
        function tick() {
          const p = Math.min(1, (performance.now() - start) / dur)
          playerJumpOffsetRef.current = Math.sin(p * Math.PI) * 0.9
          if (p < 1) requestAnimationFrame(tick)
          else playerJumpOffsetRef.current = 0
        }
        requestAnimationFrame(tick)
      } else if (e.key === 'g' || e.key === 'G') {
        // wave
        playerWave.current.amp = 0.4
        const start = performance.now()
        const dur = 1200
        function tick() {
          const p = Math.min(1, (performance.now() - start) / dur)
          playerWave.current.phase = p * Math.PI * 2
          if (p < 1) requestAnimationFrame(tick)
          else playerWave.current.amp = 0
        }
        requestAnimationFrame(tick)
      } else if (e.key === 'x' || e.key === 'X') {
        void worldOps.current.detonate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function sendMessage() {
    const npcId = selectedNpcId
    if (!draft.trim()) return
    const text = draft.trim()
    const msg: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'me', text, ts: Date.now() }
    setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), msg] }))
    setDraft('')
    
    // Handle help command
    if (text.toLowerCase() === 'help') {
      setShowHelp(true)
      return
    }
    
    // Planner shortcuts
    const lc = text.toLowerCase()
    if (/^(plan\s*)?(get\s*)?star|has\s*star/.test(lc)) {
      // plan to get star
      const worker = new Worker('/workers/planner.worker.js', { type: 'module' })
      const requestPayload = { initial: { storageUnlocked: world.storageUnlocked, bunkerBreached: world.bunkerBreached }, goal: { hasStar: true } }
      const steps: string[] = await new Promise((resolve, reject) => {
        worker.onmessage = (ev) => {
          const { type, result, steps } = ev.data || {}
          if (type === 'result') resolve((result && Array.isArray(result.plan)) ? result.plan : (steps || []))
          else if (type === 'error') reject(new Error(ev.data?.message || 'planner error'))
          worker.terminate()
        }
        worker.postMessage({ type: 'planRequest', request: requestPayload, enableDebug: false })
      })
      const actions = steps.map((s): NpcAction | null => {
        const [op, arg] = s.split(' ')
        if (op === 'MOVE') return { type: 'move', to: arg as NodeId }
        if (op === 'PICKUP_KEY') return { type: 'pickup_key' }
        if (op === 'UNLOCK_STORAGE') return { type: 'unlock_storage' }
        if (op === 'PICKUP_C4') return { type: 'pickup_c4' }
        if (op === 'PLACE_C4') return { type: 'place_c4' }
        if (op === 'DETONATE') return { type: 'detonate' }
        if (op === 'PICKUP_STAR') return { type: 'pickup_star' }
        return null
      }).filter(Boolean)
      const planSummary = (actions as NpcAction[]).map((a) => a.type === 'move' ? `MOVE→${a.to}` : a.type.toUpperCase()).join(', ')
      const ack: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'npc', text: `✅ Plan accepted: ${planSummary}` , ts: Date.now() }
      setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), ack] }))
      const npcApi = npcApisRef.current[npcId]
      if (npcApi) npcApi.enqueuePlan(actions as NpcAction[], { replace: true })
      return
    }

    // Parse command → actions
    const parsed = parseCommandToActions(text)
    if (parsed.isAbort) {
      npcApisRef.current[npcId]?.abortAll()
      const r: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'npc', text: `⏹️ Aborted current plan`, ts: Date.now() }
      setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), r] }))
      return
    }
    if (parsed.error) {
      const r: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'npc', text: `❓ ${parsed.error}`, ts: Date.now() }
      setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), r] }))
      return
    }
    const actions = parsed.actions || []
    const planSummary = actions.map(a => a.type === 'move' ? `MOVE→${Object.entries(N).find(([,v]) => v === a.to)?.[0] || 'node'}` : a.type.toUpperCase()).join(', ')
    const ack: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'npc', text: `✅ Plan accepted: ${planSummary}`, ts: Date.now() }
    setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), ack] }))
    // Enqueue plan (replace current)
    console.log('enqueuePlan before', actions, { replace: true }, ack)
    const npcApi = npcApisRef.current[npcId]
    if (npcApi) {
      npcApi.enqueuePlan(actions, { replace: true });
    } else {
      console.error('enqueuePlan error - API not found', actions, { replace: true }, ack)
    }
  }

  // Wire NPC API emits into chat log (status/progress) and ensure API exists before usage
  useEffect(() => {
    const ensureApis = () => {
      for (const npc of npcs) {
        if (!npcApisRef.current[npc.id]) {
          // Initialize a no-op API until the agent mounts
          npcApisRef.current[npc.id] = {
            enqueuePlan: () => {},
            abortAll: () => {},
            getPose: () => ({ position: [0, 0, 0], yaw: 0, pitch: 0 }),
            isBusy: () => false,
            getQueue: () => [],
            emit: () => {},
          }
        }
        npcApisRef.current[npc.id].emit = (line: string) => {
          setMessagesByNpc((prev) => ({
            ...prev,
            [npc.id]: [...(prev[npc.id] || []), { id: crypto.randomUUID(), npcId: npc.id, sender: 'npc', text: line, ts: Date.now() }],
          }))
        }
        if (!npcInventories[npc.id]) {
          setNpcInventories((prev) => ({ ...prev, [npc.id]: { hasKey: false, hasC4: false, hasStar: false } }))
        }
      }
    }
    ensureApis()
    const id = setInterval(ensureApis, 250)
    return () => clearInterval(id)
  }, [npcs, npcInventories])

  // Keep an orientation indicator for the player (optional, small line ahead)
  const playerIndicatorColor = '#f59e0b'

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">NPC Chat Sandbox</h1>
        <p className="text-gray-300 mb-4">First-person movement with WASD + mouse look. Press Esc to unlock pointer.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden relative">
              <KeyboardControls map={controlsMap}>
                <Canvas shadows camera={{ fov: 75 }}>
                  <ambientLight intensity={0.6} />
                  <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />

                  <Ground />
                  <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

                  {/* Buildings and world markers (reused) */}
                  <Building
                    center={BUILDINGS.STORAGE.center}
                    size={BUILDINGS.STORAGE.size}
                    color="#3f6212"
                    label="Storage"
                    doorFace={BUILDINGS.STORAGE.doorFace}
                    doorSize={BUILDINGS.STORAGE.doorSize}
                    doorColor={world.storageUnlocked ? '#16a34a' : '#a16207'}
                    showDoor={!world.storageUnlocked}
                    opacity={1}
                    debug={false}
                  />
                  <Building
                    center={BUILDINGS.BUNKER.center}
                    size={BUILDINGS.BUNKER.size}
                    color="#374151"
                    label="Bunker"
                    doorFace={BUILDINGS.BUNKER.doorFace}
                    doorSize={BUILDINGS.BUNKER.doorSize}
                    doorColor={world.bunkerBreached ? '#16a34a' : '#7c2d12'}
                    showDoor={!world.bunkerBreached}
                    opacity={1}
                    debug={false}
                  />

                  <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
                  <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />
                  <BoxMarker position={NODE_POS[N.STORAGE_DOOR]} color="#a16207" label="Storage Door" />
                  <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />
                  <BoxMarker position={NODE_POS[N.BUNKER_DOOR]} color="#7c2d12" label="Bunker Door" />
                  <BoxMarker position={NODE_POS[N.STAR]} color="#6b21a8" label="Star" />
                  <BoxMarker position={NODE_POS[N.SAFE]} color="#0ea5e9" label="Blast Safe Zone" />

                  {/* Objects in world */}
                  <EnhancedObject position={[NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]]} color="#fbbf24" type="key" visible={world.keyOnTable} />
                  <EnhancedObject position={[NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]]} color="#ef4444" type="c4" visible={world.c4Available} />
                  <SmallSphere position={[NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.4, NODE_POS[N.BUNKER_DOOR][2]]} color="#ef4444" visible={world.c4Placed} size={0.3} />
                  <EnhancedObject position={[NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]]} color="#fde68a" type="star" visible={world.starPresent} />

                  {/* Explosion VFX */}
                  {boom.at && (
                    <mesh position={boom.at}>
                      <sphereGeometry args={[0.5, 16, 16]} />
                      <meshStandardMaterial color="#f97316" emissive="#dc2626" emissiveIntensity={1.2} transparent opacity={0.7} />
                    </mesh>
                  )}

                  {/* NPCs */}
                  {npcs.map((npc) => (
                    <NpcAgent
                      key={npc.id}
                      id={npc.id}
                      name={npc.name}
                      color={npc.color}
                      initialPos={npc.pos}
                      apiRegistry={npcApisRef}
                      inv={{ hasKey: (npcInventories[npc.id]?.hasKey) || false, hasC4: (npcInventories[npc.id]?.hasC4) || false, hasStar: (npcInventories[npc.id]?.hasStar) || false }}
                      worldOps={worldOps}
                    />
                  ))}

                  {/* Player and orientation indicator */}
                  <Player
                    poseRef={playerPoseRef}
                    jumpOffsetRef={playerJumpOffsetRef}
                    onLock={() => setIsLocked(true)}
                    onUnlock={() => setIsLocked(false)}
                    startSelector="#startPointerLock"
                  />
                  <FacingArrow origin={[playerPose.position[0], playerPose.position[1], playerPose.position[2]]} yaw={playerPose.yaw} length={1.2} color={playerIndicatorColor} />

                  {/* Player inventory */}
                  {playerInv.hasKey && (<InventoryItem agentPos={[playerPose.position[0], 0, playerPose.position[2]]} type="key" color="#fbbf24" index={0} />)}
                  {playerInv.hasC4 && (<InventoryItem agentPos={[playerPose.position[0], 0, playerPose.position[2]]} type="c4" color="#ef4444" index={1} />)}
                  {playerInv.hasStar && (<InventoryItem agentPos={[playerPose.position[0], 0, playerPose.position[2]]} type="star" color="#fde68a" index={2} />)}

                  {/* No in-world action buttons */}
                </Canvas>
              </KeyboardControls>
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center select-none" style={{ display: isLocked ? 'none' : 'flex' }}>
                <button id="startPointerLock" type="button" className="px-6 py-3 text-base rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  Click to Start
                </button>
              </div>
            </div>
            <div className="mt-2 text-gray-400 text-sm flex items-center gap-3 justify-between">
              <span>Controls: WASD move, Shift run, Space jump, G wave, E interact, X detonate.</span>
              <div className="flex items-center gap-2">
                <button type="button" className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" onClick={() => void worldOps.current.pickupKey('player')}>Pick Key</button>
                <button type="button" className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" onClick={() => void worldOps.current.unlockStorage('player')}>Unlock Storage</button>
                <button type="button" className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" onClick={() => void worldOps.current.pickupC4('player')}>Pick C4</button>
                <button type="button" className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" onClick={() => void worldOps.current.placeC4('player')}>Place C4</button>
                <button type="button" className="px-2 py-1 text-xs rounded bg-rose-700 hover:bg-rose-600 text-white" onClick={() => void worldOps.current.detonate()}>Detonate</button>
                <button type="button" className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" onClick={() => void worldOps.current.pickupStar('player')}>Pick Star</button>
              </div>
            </div>
            {interactPrompt && (
              <div className="mt-2 text-emerald-300 text-sm">{interactPrompt}</div>
            )}
          </div>

          {/* Chat sidebar */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 flex flex-col h-[80vh]">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <span className="text-green-400 text-sm">💬</span>
                Chat
              </h2>
              {/* Inventory summary */}
              <div className="flex items-center gap-3 text-xs text-gray-300">
                <span className="hidden sm:inline">Inventory:</span>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${playerInv.hasKey ? 'bg-amber-600/30 text-amber-300' : 'bg-gray-700 text-gray-400'}`}>🔑 Key</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${playerInv.hasC4 ? 'bg-red-600/30 text-red-300' : 'bg-gray-700 text-gray-400'}`}>💣 C4</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${playerInv.hasStar ? 'bg-yellow-600/30 text-yellow-300' : 'bg-gray-700 text-gray-400'}`}>⭐ Star</span>
                </div>
              </div>
            </div>
            <div className="flex-1 flex overflow-hidden">
              <div className="w-40 border-r border-gray-700 overflow-y-auto">
                {npcs.map((n) => (
                  <button
                    key={n.id}
                    className={`w-full text-left px-3 py-2 text-sm ${selectedNpcId === n.id ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-750'}`}
                    onClick={() => setSelectedNpcId(n.id)}
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: n.color }} />
                      <span className="truncate">{n.name}</span>
                    </div>
                    {/* NPC inventory badges */}
                    <div className="mt-1 flex items-center gap-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ (npcInventories[n.id]?.hasKey) ? 'bg-amber-600/30 text-amber-300' : 'bg-gray-700 text-gray-500'}`}>🔑</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ (npcInventories[n.id]?.hasC4) ? 'bg-red-600/30 text-red-300' : 'bg-gray-700 text-gray-500'}`}>💣</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${ (npcInventories[n.id]?.hasStar) ? 'bg-yellow-600/30 text-yellow-300' : 'bg-gray-700 text-gray-500'}`}>⭐</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex-1 flex flex-col">
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {(messagesByNpc[selectedNpcId] || []).map((m) => (
                    <div key={m.id} className={`max-w-[80%] ${m.sender === 'me' ? 'ml-auto text-right' : ''}`}>
                      <div className={`inline-block px-3 py-2 rounded-lg text-sm ${m.sender === 'me' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-100'}`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-700">
                  {/* Quick action buttons */}
                  <div className="p-2 flex flex-wrap gap-1 border-b border-gray-700">
                    {COMMAND_DEFINITIONS
                      .filter(cmd => cmd.quickAction || cmd.id === 'move')
                      .sort((a, b) => (a.id === 'move' ? -1 : b.id === 'move' ? 1 : 0))
                      .map(cmd => (
                      <button
                        key={cmd.id}
                        className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
                        onClick={() => {
                          if (cmd.id === 'move') {
                            setShowLocationPicker(true)
                          } else if (cmd.quickAction) {
                            const actions = cmd.quickAction()
                            const planSummary = actions.map(a => 
                              a.type === 'move' ? `MOVE→${Object.entries(N).find(([,v]) => v === a.to)?.[0] || 'node'}` : a.type.toUpperCase()
                            ).join(', ')
                            const msg: ChatMessage = { 
                              id: crypto.randomUUID(), 
                              npcId: selectedNpcId, 
                              sender: 'me', 
                              text: cmd.examples[0], 
                              ts: Date.now() 
                            }
                            setMessagesByNpc((prev) => ({ 
                              ...prev, 
                              [selectedNpcId]: [...(prev[selectedNpcId] || []), msg] 
                            }))
                            const ack: ChatMessage = { 
                              id: crypto.randomUUID(), 
                              npcId: selectedNpcId, 
                              sender: 'npc', 
                              text: `✅ Plan accepted: ${planSummary}`, 
                              ts: Date.now() 
                            }
                            setMessagesByNpc((prev) => ({ 
                              ...prev, 
                              [selectedNpcId]: [...(prev[selectedNpcId] || []), ack] 
                            }))
                            npcApisRef.current[selectedNpcId]?.enqueuePlan(actions, { replace: true })
                          }
                        }}
                        type="button"
                      >
                        {cmd.buttonLabel}
                      </button>
                    ))}
                    <button
                      className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
                      onClick={() => {
                        npcApisRef.current[selectedNpcId]?.abortAll()
                        const r: ChatMessage = { 
                          id: crypto.randomUUID(), 
                          npcId: selectedNpcId, 
                          sender: 'npc', 
                          text: `⏹️ Aborted current plan`, 
                          ts: Date.now() 
                        }
                        setMessagesByNpc((prev) => ({ 
                          ...prev, 
                          [selectedNpcId]: [...(prev[selectedNpcId] || []), r] 
                        }))
                      }}
                      type="button"
                    >
                      ⏹️ Stop
                    </button>
                    <button
                      className="text-xs px-2 py-1 bg-purple-700 hover:bg-purple-600 text-gray-200 rounded ml-auto"
                      onClick={() => setShowHelp(true)}
                      type="button"
                    >
                      📖 Help
                    </button>
                  </div>
                  <div className="p-3 flex gap-2">
                    <input
                      className="flex-1 bg-gray-900 text-gray-100 rounded-md px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      placeholder="Type a message or click quick actions above..."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendMessage() }}
                    />
                    <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-2 rounded-md" onClick={sendMessage} type="button">
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-3 py-2 border-t border-gray-700 text-xs text-gray-400">
              Player: pos [{playerPose.position.map((v) => v.toFixed(1)).join(', ')}] yaw {(playerPose.yaw * 180 / Math.PI).toFixed(0)}° | Inv: key {String(playerInv.hasKey)} c4 {String(playerInv.hasC4)} star {String(playerInv.hasStar)} | Storage {world.storageUnlocked ? 'Unlocked' : 'Locked'} | Bunker {world.bunkerBreached ? 'Breached' : 'Sealed'}
            </div>
            <div className="px-3 pb-2 text-xs text-gray-500">
              Tip: You can later compute each NPC's camera from their pose (position + yaw/pitch) to render their POV.
            </div>
          </div>
        </div>

        <div className="mt-4">
          <a href="/" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
        </div>
      </div>
      
      {/* Help dialog */}
      {showHelp && <CommandHelp onClose={() => setShowHelp(false)} />}
      
      {/* Location picker */}
      {showLocationPicker && (
        <LocationPicker
          onSelect={(location) => {
            const actions = [{ type: 'move' as const, to: location }]
            const msg: ChatMessage = { 
              id: crypto.randomUUID(), 
              npcId: selectedNpcId, 
              sender: 'me', 
              text: `move to ${NODE_TITLES[location].toLowerCase()}`, 
              ts: Date.now() 
            }
            setMessagesByNpc((prev) => ({ 
              ...prev, 
              [selectedNpcId]: [...(prev[selectedNpcId] || []), msg] 
            }))
            const ack: ChatMessage = { 
              id: crypto.randomUUID(), 
              npcId: selectedNpcId, 
              sender: 'npc', 
              text: `✅ Plan accepted: MOVE→${Object.entries(N).find(([,v]) => v === location)?.[0] || 'node'}`, 
              ts: Date.now() 
            }
            setMessagesByNpc((prev) => ({ 
              ...prev, 
              [selectedNpcId]: [...(prev[selectedNpcId] || []), ack] 
            }))
            npcApisRef.current[selectedNpcId]?.enqueuePlan(actions, { replace: true })
          }}
          onClose={() => setShowLocationPicker(false)}
        />
      )}
    </div>
  )
}


