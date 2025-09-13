'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls, useKeyboardControls, Line } from '@react-three/drei'
import { Ground, BoxMarker, Building, LabelSprite } from '../../lib/bunker-scene'
import { BUILDINGS, N, NODE_POS, type Vec3, type NodeId } from '../../lib/bunker-world'

type Controls = 'forward' | 'backward' | 'left' | 'right' | 'run'

type AgentPose = {
  position: Vec3
  yaw: number // radians, around +Y
  pitch: number // radians, around +X
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

function Player({ poseRef }: { poseRef: React.MutableRefObject<AgentPose> }) {
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
    camera.position.y = PLAYER_EYE_HEIGHT

    poseRef.current = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      yaw: camera.rotation.y,
      pitch: camera.rotation.x,
    }
  })
  return <PointerLockControls makeDefault />
}

function FacingArrow({ origin, yaw, length = 1.5, color = '#22d3ee' }: { origin: Vec3; yaw: number; length?: number; color?: string }) {
  const forward = useMemo(() => {
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return dir
  }, [yaw])
  const end: Vec3 = useMemo(() => [origin[0] + forward.x * length, origin[1], origin[2] + forward.z * length], [origin, forward, length])
  return <Line points={[origin, end]} color={color} lineWidth={2} dashed={false} />
}

// --- NPC ACTION SYSTEM ---
type MoveAction = { type: 'move'; to: NodeId }
type JumpAction = { type: 'jump'; height?: number; durationMs?: number }
type WaveAction = { type: 'wave'; durationMs?: number }
type NpcAction = MoveAction | JumpAction | WaveAction

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

function parseCommandToActions(input: string): { actions?: NpcAction[]; error?: string; isAbort?: boolean } {
  const segments = input
    .toLowerCase()
    .split(/(?:,|;|\band then\b|\bthen\b|\band\b)/g)
    .map(s => s.trim())
    .filter(Boolean)

  const actions: NpcAction[] = []
  for (const seg of segments) {
    if (/^(stop|abort|cancel)$/i.test(seg)) {
      return { isAbort: true }
    }
    let m = seg.match(/^((move|go)\s+to)\s+(.+)$/i)
    if (m) {
      const locStr = m[3].trim()
      const node = aliasToNodeId(locStr)
      if (!node) return { error: `Unknown location: ${locStr}` }
      actions.push({ type: 'move', to: node })
      continue
    }
    m = seg.match(/^jump(\s+once)?$/i)
    if (m) {
      actions.push({ type: 'jump', height: 0.8, durationMs: 600 })
      continue
    }
    m = seg.match(/^wave(\s+for\s+(\d+)(s|\s*seconds)?)?$/i)
    if (m) {
      const dur = m[2] ? Number(m[2]) * 1000 : 1500
      actions.push({ type: 'wave', durationMs: dur })
      continue
    }
    return { error: `Unknown command: "${seg}"` }
  }
  if (!actions.length) return { error: 'No commands found' }
  return { actions }
}

function NpcAgent({ id, name, color, initialPos, apiRegistry }: { id: string; name: string; color: string; initialPos: Vec3; apiRegistry: React.MutableRefObject<Record<string, NpcApi>> }) {
  const groupRef = useRef<THREE.Group | null>(null)
  const poseRef = useRef<AgentPose>({ position: [...initialPos], yaw: 0, pitch: 0 })
  const wavePhaseRef = useRef<number>(0)
  const waveAmpRef = useRef<number>(0)
  const baseY = initialPos[1]
  const jumpOffsetRef = useRef<number>(0)
  const queueRef = useRef<NpcAction[]>([])
  const cancelCurrentRef = useRef<() => void>(() => {})
  const isBusyRef = useRef<boolean>(false)

  useEffect(() => {
    poseRef.current.position = [...initialPos]
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
  function execMove(to: Vec3, speed = 3): Promise<void> {
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
          apiRegistry.current[id]?.emit(`✅ Reached ${NODE_TITLES[Object.entries(N).find(([,v]) => v === (Object.keys(NODE_POS).find(k => (NODE_POS as any)[k] === to) as unknown as NodeId))?.[1] as NodeId] || 'target'}`)
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
      apiRegistry.current[id]?.emit(`▶️ Moving to ${NODE_TITLES[Object.entries(N).find(([,v]) => v === (Object.keys(NODE_POS).find(k => (NODE_POS as any)[k] === to) as unknown as NodeId))?.[1] as NodeId] || 'target'}`)
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

  const runLoop = useRef<() => Promise<void>>({} as any)
  runLoop.current = async function () {
    if (isBusyRef.current) return
    isBusyRef.current = true
    try {
      while (queueRef.current.length) {
        const maybe = queueRef.current.shift()
        if (!maybe) break
        const action = maybe
        if (action.type === 'move') {
          const to = NODE_POS[action.to]
          await execMove(to, 3)
        } else if (action.type === 'jump') {
          await execJump(action)
        } else if (action.type === 'wave') {
          await execWave(action)
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
  useFrame((_, delta) => {
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
    </group>
  )
}

// (Old NpcAvatar removed)

// PlayerPoseSync removed; handled inside Player

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
  useEffect(() => {
    const id = setInterval(() => setPlayerPose(playerPoseRef.current), 100)
    return () => clearInterval(id)
  }, [])

  // NPCs
  const [npcs] = useState([
    { id: 'npc_alex', name: 'Alex', color: '#60a5fa', pos: [NODE_POS[N.TABLE][0], 0, NODE_POS[N.TABLE][2]] as Vec3 },
    { id: 'npc_riley', name: 'Riley', color: '#f472b6', pos: [NODE_POS[N.BUNKER_DOOR][0] + 3, 0, NODE_POS[N.BUNKER_DOOR][2]] as Vec3 },
    { id: 'npc_sam', name: 'Sam', color: '#34d399', pos: [NODE_POS[N.STORAGE_DOOR][0] - 2, 0, NODE_POS[N.STORAGE_DOOR][2]] as Vec3 },
  ])
  const npcApisRef = useRef<Record<string, NpcApi>>({})

  // Chat state
  const [selectedNpcId, setSelectedNpcId] = useState<string>('npc_alex')
  const [messagesByNpc, setMessagesByNpc] = useState<Record<string, ChatMessage[]>>({
    npc_alex: [{ id: 'm1', npcId: 'npc_alex', sender: 'npc', text: 'Hey! Use WASD to move, mouse to look.', ts: Date.now() }],
    npc_riley: [{ id: 'm2', npcId: 'npc_riley', sender: 'npc', text: 'Standing by the bunker door.', ts: Date.now() }],
    npc_sam: [{ id: 'm3', npcId: 'npc_sam', sender: 'npc', text: 'Guarding storage entrance.', ts: Date.now() }],
  })
  const [draft, setDraft] = useState('')

  function sendMessage() {
    const npcId = selectedNpcId
    if (!draft.trim()) return
    const text = draft.trim()
    const msg: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'me', text, ts: Date.now() }
    setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), msg] }))
    setDraft('')
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
      }
    }
    ensureApis()
    const id = setInterval(ensureApis, 250)
    return () => clearInterval(id)
  }, [npcs])

  // Keep an orientation indicator for the player (optional, small line ahead)
  const playerIndicatorColor = '#f59e0b'

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">NPC Chat Sandbox</h1>
        <p className="text-gray-300 mb-4">First-person movement with WASD + mouse look. Press Esc to unlock pointer.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden">
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
                    doorColor="#a16207"
                    showDoor={true}
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
                    doorColor="#7c2d12"
                    showDoor={true}
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

                  {/* NPCs */}
                  {npcs.map((npc) => (
                    <NpcAgent key={npc.id} id={npc.id} name={npc.name} color={npc.color} initialPos={npc.pos} apiRegistry={npcApisRef} />
                  ))}

                  {/* Player and orientation indicator */}
                  <Player poseRef={playerPoseRef} />
                  <FacingArrow origin={[playerPose.position[0], playerPose.position[1], playerPose.position[2]]} yaw={playerPose.yaw} length={1.2} color={playerIndicatorColor} />
                </Canvas>
              </KeyboardControls>
            </div>
            <div className="mt-2 text-gray-400 text-sm">
              <span>Controls: WASD to move, Shift to run, click canvas to lock pointer.</span>
            </div>
          </div>

          {/* Chat sidebar */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 flex flex-col h-[80vh]">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <span className="text-green-400 text-sm">💬</span>
                Chat
              </h2>
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
                <div className="p-3 border-t border-gray-700 flex gap-2">
                  <input
                    className="flex-1 bg-gray-900 text-gray-100 rounded-md px-3 py-2 text-sm border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="Type a message..."
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
            <div className="px-3 py-2 border-t border-gray-700 text-xs text-gray-400">
              Player: pos [{playerPose.position.map((v) => v.toFixed(1)).join(', ')}] yaw {(playerPose.yaw * 180 / Math.PI).toFixed(0)}°
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
    </div>
  )
}


