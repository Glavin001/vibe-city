'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls, Html } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { Ground, BoxMarker, Building, EnhancedObject, SmallSphere } from '../../lib/bunker-scene'
import { BUILDINGS, N, NODE_POS, type Vec3, type NodeId, type BuildingConfig } from '../../lib/bunker-world'
import { useBunkerWorld, type WorldState as BunkerWorldState, type BoomEffect } from '../../hooks/use-bunker-world'
import { 
  COMMAND_DEFINITIONS, 
  parseCommandToActions, 
  NODE_TITLES,
  type NpcAction,
} from '../../lib/npc-commands'
import { PlayerKCC, type AgentPose } from '../../components/physics/PlayerKCC'
import { GroundPhysics } from '../../components/physics/GroundPhysics'
import { BuildingColliders } from '../../components/physics/BuildingColliders'
import { NpcAgent, type NpcApi, type WorldOps } from '../../components/npc/NpcAgent'
import { CommandHelp } from '../../components/chat/CommandHelp'
import { LocationPicker } from '../../components/chat/LocationPicker'
import { FacingArrow } from '../../components/scene/FacingArrow'

type Controls = 'forward' | 'backward' | 'left' | 'right' | 'jump' | 'run'

type ChatMessage = {
  id: string
  npcId: string
  sender: 'me' | 'npc'
  text: string
  ts: number
}

const PLAYER_EYE_HEIGHT = 1.65 // Realistic human eye height (1.8m person)

function computeDoorPromptTarget(building: BuildingConfig): Vec3 {
  const [cx, cy, cz] = building.center
  const [bw, _bh, bd] = building.size
  const [_doorW, doorH] = building.doorSize
  let center = new THREE.Vector3(cx, cy + doorH / 2, cz)
  if (building.doorFace === 'west') { 
    center = new THREE.Vector3(cx - bw / 2, cy + doorH / 2, cz)
  } else if (building.doorFace === 'east') { 
    center = new THREE.Vector3(cx + bw / 2, cy + doorH / 2, cz)
  } else if (building.doorFace === 'south') { 
    center = new THREE.Vector3(cx, cy + doorH / 2, cz + bd / 2)
  } else if (building.doorFace === 'north') { 
    center = new THREE.Vector3(cx, cy + doorH / 2, cz - bd / 2)
  }
  return [center.x, center.y, center.z]
}

function InteractionPrompt3D({ text, target, onActivate, visible = true }: { 
  text: string
  target: Vec3 | null
  onActivate?: () => void
  visible?: boolean 
}) {
  const groupRef = useRef<THREE.Group | null>(null)
  const camera = useThree((s) => s.camera)
  const cleanText = useMemo(() => (text || '').replace(/^\s*press\s*[eE]\s*to\s*/i, ''), [text])

  useEffect(() => {
    function tick() {
      if (!groupRef.current || !target || !visible) return
      const cam = camera.position
      const t = new THREE.Vector3(target[0], target[1], target[2])
      const dirToTarget = new THREE.Vector3().copy(t).sub(cam)
      const dist = dirToTarget.length() || 1
      dirToTarget.normalize()
      const nudge = Math.min(0.5, Math.max(0.18, dist * 0.06))
      const pos = new THREE.Vector3().copy(t).addScaledVector(dirToTarget, -nudge)
      pos.y += 0.2
      groupRef.current.position.copy(pos)
    }
    const id = setInterval(tick, 16)
    return () => clearInterval(id)
  }, [camera, target, visible])

  if (!visible || !target) return null
  return (
    <group ref={groupRef}>
      <Html sprite center distanceFactor={8} style={{ pointerEvents: 'auto', transform: 'translateZ(0) scale(0.78)' }}>
        <button
          type="button"
          onClick={() => onActivate?.()}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/70 text-gray-100 border border-white/10 shadow-md backdrop-blur-sm max-w-[180px] whitespace-normal"
        >
          <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-200 border border-white/10 text-[10px] leading-none">E</span>
          <span className="text-[11px] leading-tight">{cleanText || 'Interact'}</span>
        </button>
      </Html>
    </group>
  )
}

function Scene({ 
  world, 
  playerPoseRef, 
  npcInventories, 
  npcApisRef, 
  worldOps,
  boom,
  interactPrompt,
  interactTarget,
  interactHandlerRef,
  onLock,
  onUnlock,
}: {
  world: BunkerWorldState
  playerPoseRef: React.MutableRefObject<AgentPose>
  npcInventories: Record<string, { hasKey: boolean; hasC4: boolean; hasStar: boolean }>
  npcApisRef: React.MutableRefObject<Record<string, NpcApi>>
  worldOps: React.MutableRefObject<WorldOps>
  boom: BoomEffect
  interactPrompt: string
  interactTarget: Vec3 | null
  interactHandlerRef: React.MutableRefObject<() => void>
  onLock: () => void
  onUnlock: () => void
}) {
  const spawn: [number, number, number] = useMemo(() => [NODE_POS[N.COURTYARD][0], 0.9, NODE_POS[N.COURTYARD][2]], [])
  
  const npcs = useMemo(() => [
    { id: 'npc_alex', name: 'Alex', color: '#60a5fa', pos: [-3, 0, -3] as Vec3 }, // Northwest of courtyard
    { id: 'npc_riley', name: 'Riley', color: '#f472b6', pos: [3, 0, -3] as Vec3 }, // Northeast of courtyard
    { id: 'npc_sam', name: 'Sam', color: '#34d399', pos: [0, 0, 4] as Vec3 }, // South of courtyard
  ], [])

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />

      <Ground />
      <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

      {/* Buildings */}
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

      {/* Location markers */}
      <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
      <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />
      <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />
      <BoxMarker position={NODE_POS[N.STAR]} color="#6b21a8" label="Star" />
      <BoxMarker position={NODE_POS[N.SAFE]} color="#0ea5e9" label="Blast Safe Zone" />

      {/* World objects */}
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

      {/* NPCs with physics */}
      {npcs.map((npc) => (
        <NpcAgent
          key={npc.id}
          id={npc.id}
          name={npc.name}
          color={npc.color}
          initialPos={npc.pos}
          apiRegistry={npcApisRef}
          inv={{ 
            hasKey: (npcInventories[npc.id]?.hasKey) || false, 
            hasC4: (npcInventories[npc.id]?.hasC4) || false, 
            hasStar: (npcInventories[npc.id]?.hasStar) || false 
          }}
          worldOps={worldOps}
          usePhysics={true}
        />
      ))}

      {/* Player with physics */}
      <PlayerKCC 
        start={spawn} 
        poseRef={playerPoseRef} 
        eyeHeight={PLAYER_EYE_HEIGHT} 
        initialYaw={3/4 * Math.PI}
        initialPitch={0}
      />
      
      {/* Player orientation arrow */}
      <FacingArrow 
        origin={[playerPoseRef.current.position[0], playerPoseRef.current.position[1], playerPoseRef.current.position[2]]} 
        yaw={playerPoseRef.current.yaw} 
        length={1.2} 
        color="#f59e0b" 
      />

      {/* Interaction prompt */}
      <InteractionPrompt3D
        text={interactPrompt}
        target={interactTarget}
        onActivate={() => interactHandlerRef.current()}
        visible={Boolean(interactPrompt && interactTarget)}
      />

      <PointerLockControls makeDefault onLock={onLock} onUnlock={onUnlock} selector="#startPointerLockPhysics" />
    </>
  )
}

export default function NpcChatPhysicsPage() {
  const controlsMap = useMemo(() => (
    [
      { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
      { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
      { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
      { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
      { name: 'jump', keys: ['Space'] },
      { name: 'run', keys: ['Shift'] },
    ] as { name: Controls; keys: string[] }[]
  ), [])

  // World state
  const { world, boom, playerInv, npcInventories, setNpcInventory, worldOps } = useBunkerWorld()

  // Player pose
  const [playerPose, setPlayerPose] = useState<AgentPose>({ 
    position: [NODE_POS[N.COURTYARD][0], PLAYER_EYE_HEIGHT, NODE_POS[N.COURTYARD][2]], 
    yaw: 3/4 * Math.PI, 
    pitch: 0 
  })
  const playerPoseRef = useRef<AgentPose>(playerPose)
  const [isLocked, setIsLocked] = useState<boolean>(false)
  
  useEffect(() => {
    const id = setInterval(() => setPlayerPose({...playerPoseRef.current}), 100)
    return () => clearInterval(id)
  }, [])

  // NPCs
  const npcApisRef = useRef<Record<string, NpcApi>>({})

  // Chat state
  const [selectedNpcId, setSelectedNpcId] = useState<string>('npc_alex')
  const [messagesByNpc, setMessagesByNpc] = useState<Record<string, ChatMessage[]>>({
    npc_alex: [{ id: 'm1', npcId: 'npc_alex', sender: 'npc', text: 'Hey! Use WASD to move, mouse to look. Type "help" for commands. Now with physics!', ts: Date.now() }],
    npc_riley: [{ id: 'm2', npcId: 'npc_riley', sender: 'npc', text: 'Standing by the bunker door. Try walking into walls!', ts: Date.now() }],
    npc_sam: [{ id: 'm3', npcId: 'npc_sam', sender: 'npc', text: 'Guarding storage entrance with physics.', ts: Date.now() }],
  })
  const [draft, setDraft] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [showLocationPicker, setShowLocationPicker] = useState(false)

  // Helper for distance checks
  const distTo = useCallback((pos: Vec3) => {
    const p = playerPoseRef.current.position
    const dx = p[0] - pos[0]
    const dz = p[2] - pos[2]
    return Math.hypot(dx, dz)
  }, [])

  // Player action helpers
  const [interactPrompt, setInteractPrompt] = useState<string>('')
  const [interactTarget, setInteractTarget] = useState<Vec3 | null>(null)
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
        setInteractTarget([NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]])
        interactHandlerRef.current = () => { 
          void worldOps.current.pickupKey('player', () => playerPoseRef.current.position) 
        }
        return
      }
      if (pUnlock) {
        setInteractPrompt('Press E to Unlock Storage')
        setInteractTarget(computeDoorPromptTarget(BUILDINGS.STORAGE))
        interactHandlerRef.current = () => { 
          void worldOps.current.unlockStorage('player', () => playerPoseRef.current.position) 
        }
        return
      }
      if (pC4) {
        setInteractPrompt('Press E to Pick up C4')
        setInteractTarget([NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]])
        interactHandlerRef.current = () => { 
          void worldOps.current.pickupC4('player', () => playerPoseRef.current.position) 
        }
        return
      }
      if (pPlace) {
        setInteractPrompt('Press E to Place C4')
        setInteractTarget(computeDoorPromptTarget(BUILDINGS.BUNKER))
        interactHandlerRef.current = () => { 
          void worldOps.current.placeC4('player', () => playerPoseRef.current.position) 
        }
        return
      }
      if (pStar) {
        setInteractPrompt('Press E to Pick up Star')
        setInteractTarget([NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]])
        interactHandlerRef.current = () => { 
          void worldOps.current.pickupStar('player', () => playerPoseRef.current.position) 
        }
        return
      }
      setInteractPrompt('')
      setInteractTarget(null)
      interactHandlerRef.current = () => {}
    }, 120)
    return () => clearInterval(id)
  }, [world, playerInv, distTo, worldOps])

  // Keyboard bindings for player actions
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'e' || e.key === 'E') {
        interactHandlerRef.current()
      } else if (e.key === 'x' || e.key === 'X') {
        void worldOps.current.detonate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [worldOps])

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
    const npcApi = npcApisRef.current[npcId]
    if (npcApi) {
      npcApi.enqueuePlan(actions, { replace: true })
    }
  }

  // Wire NPC API emits into chat log
  const npcs = useMemo(() => [
    { id: 'npc_alex', name: 'Alex', color: '#60a5fa' },
    { id: 'npc_riley', name: 'Riley', color: '#f472b6' },
    { id: 'npc_sam', name: 'Sam', color: '#34d399' },
  ], [])
  
  useEffect(() => {
    const ensureApis = () => {
      for (const npc of npcs) {
        if (!npcApisRef.current[npc.id]) {
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
          setNpcInventory(npc.id, { hasKey: false, hasC4: false, hasStar: false })
        }
      }
    }
    ensureApis()
    const id = setInterval(ensureApis, 250)
    return () => clearInterval(id)
  }, [npcs, npcInventories, setNpcInventory])

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">NPC Chat with Physics</h1>
        <p className="text-gray-300 mb-4">First-person movement with Rapier physics. NPCs also use character controllers and collide with walls!</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden relative">
              <KeyboardControls map={controlsMap}>
                <Canvas shadows camera={{ fov: 75 }}>
                  <Physics>
                    <GroundPhysics />
                    <BuildingColliders config={BUILDINGS.STORAGE} />
                    <BuildingColliders config={BUILDINGS.BUNKER} />
                    <Scene
                      world={world}
                      playerPoseRef={playerPoseRef}
                      npcInventories={npcInventories}
                      npcApisRef={npcApisRef}
                      worldOps={worldOps}
                      boom={boom}
                      interactPrompt={interactPrompt}
                      interactTarget={interactTarget}
                      interactHandlerRef={interactHandlerRef}
                      onLock={() => setIsLocked(true)}
                      onUnlock={() => setIsLocked(false)}
                    />
                  </Physics>
                </Canvas>
              </KeyboardControls>
              <div id="startPointerLockPhysics" className="absolute inset-0 select-none cursor-pointer" style={{ display: isLocked ? 'none' : 'block' }} title="Click to start (Esc to unlock)">
                <div className="pointer-events-none absolute bottom-3 right-3 text-[11px] bg-gray-900/40 text-gray-200 px-2 py-1 rounded">
                  Click to start · Esc to unlock
                </div>
              </div>
            </div>
            <div className="mt-2 text-gray-400 text-sm">
              Controls: WASD move, Shift run, Space jump, E interact, X detonate. Walk into walls to feel the physics!
            </div>
          </div>

          {/* Chat sidebar */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 flex flex-col h-[80vh]">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <span className="text-green-400 text-sm">💬</span>
                Chat
              </h2>
              <div className="flex items-center gap-3 text-xs text-gray-300">
                <span className="hidden sm:inline">Inventory:</span>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${playerInv.hasKey ? 'bg-amber-600/30 text-amber-300' : 'bg-gray-700 text-gray-400'}`}>🔑</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${playerInv.hasC4 ? 'bg-red-600/30 text-red-300' : 'bg-gray-700 text-gray-400'}`}>💣</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${playerInv.hasStar ? 'bg-yellow-600/30 text-yellow-300' : 'bg-gray-700 text-gray-400'}`}>⭐</span>
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
                      placeholder="Type a command or use quick actions..."
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
              Player: pos [{playerPose.position.map((v) => v.toFixed(1)).join(', ')}] | Storage {world.storageUnlocked ? 'Unlocked' : 'Locked'} | Bunker {world.bunkerBreached ? 'Breached' : 'Sealed'}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <a href="/" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
        </div>
      </div>
      
      {showHelp && <CommandHelp onClose={() => setShowHelp(false)} />}
      
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

