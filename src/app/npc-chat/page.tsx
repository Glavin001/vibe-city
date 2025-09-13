'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls, useKeyboardControls, Line } from '@react-three/drei'
import { Ground, BoxMarker, Building, LabelSprite } from '../../lib/bunker-scene'
import { BUILDINGS, N, NODE_POS, type Vec3 } from '../../lib/bunker-world'

type Controls = 'forward' | 'backward' | 'left' | 'right' | 'run'

type AgentPose = {
  position: Vec3
  yaw: number // radians, around +Y
  pitch: number // radians, around +X
}

type Npc = {
  id: string
  name: string
  color: string
  pose: AgentPose
}

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

  useFrame((state, delta) => {
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

function NpcAvatar({ npc }: { npc: Npc }) {
  const { position, yaw } = npc.pose
  return (
    <group position={[position[0], position[1], position[2]]} rotation={[0, yaw, 0]}>
      <mesh castShadow position={[0, 0.9, 0]}> {/* body */}
        <capsuleGeometry args={[0.5, 1.0, 8, 16]} />
        <meshStandardMaterial color={npc.color} />
      </mesh>
      <mesh castShadow position={[0, 1.8, 0]}> {/* head */}
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color={npc.color} emissive={npc.color} emissiveIntensity={0.1} />
      </mesh>
      <LabelSprite position={[0, 2.3, 0]} text={npc.name} />
      <FacingArrow origin={[position[0], position[1] + 1.6, position[2]]} yaw={yaw} />
    </group>
  )
}

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
  const [npcs, _setNpcs] = useState<Npc[]>([
    { id: 'npc_alex', name: 'Alex', color: '#60a5fa', pose: { position: [NODE_POS[N.TABLE][0], 0, NODE_POS[N.TABLE][2]], yaw: Math.PI / 2, pitch: 0 } },
    { id: 'npc_riley', name: 'Riley', color: '#f472b6', pose: { position: [NODE_POS[N.BUNKER_DOOR][0] + 3, 0, NODE_POS[N.BUNKER_DOOR][2]], yaw: Math.PI, pitch: 0 } },
    { id: 'npc_sam', name: 'Sam', color: '#34d399', pose: { position: [NODE_POS[N.STORAGE_DOOR][0] - 2, 0, NODE_POS[N.STORAGE_DOOR][2]], yaw: -Math.PI / 2, pitch: 0 } },
  ])

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
    const msg: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'me', text: draft.trim(), ts: Date.now() }
    setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), msg] }))
    setDraft('')
    // Stubbed NPC reply
    const npc = npcs.find((n) => n.id === npcId)
    const replyText = `(${npc?.name}) Acknowledged: "${msg.text}"`
    setTimeout(() => {
      const r: ChatMessage = { id: crypto.randomUUID(), npcId, sender: 'npc', text: replyText, ts: Date.now() }
      setMessagesByNpc((prev) => ({ ...prev, [npcId]: [...(prev[npcId] || []), r] }))
    }, 500)
  }

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
                    <NpcAvatar key={npc.id} npc={npc} />
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


