'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Agent, Task } from 'mahler'
import { CameraControls } from '@react-three/drei'
import { N, NodeId, BUILDINGS, NODE_POS, findPath, isImmediatellyReachable, Vec3 } from '../../lib/bunker-world'
import { Ground, BoxMarker, Building, LabelSprite, AgentMesh, EnhancedObject, SmallSphere, InventoryItem, PickupAnimation } from '../../lib/bunker-scene'

const AGENT_INSIDE_BUILDING_OPACITY = 0.5

// Adjacency and gates
type WorldState = {
  agentAt: NodeId
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

const initial: WorldState = {
  agentAt: N.COURTYARD,
  keyOnTable: true,
  c4Available: true,
  starPresent: true,
  hasKey: false,
  hasC4: false,
  hasStar: false,
  storageUnlocked: false,
  c4Placed: false,
  bunkerBreached: false,
}

export default function BunkerPage() {
  const [agentPos, setAgentPos] = useState<Vec3>(NODE_POS[N.COURTYARD])
  const agentPosRef = useRef<Vec3>(agentPos)
  const motionRef = useRef<{
    active: boolean
    start: THREE.Vector3
    end: THREE.Vector3
    startTime: number
    durationMs: number
    resolve?: () => void
  }>({ active: false, start: new THREE.Vector3(), end: new THREE.Vector3(), startTime: 0, durationMs: 800 })

  const [world, setWorld] = useState<WorldState>(initial)
  const [status, setStatus] = useState<string>('')
  const [boom, setBoom] = useState<{ at?: Vec3; t?: number }>({})

  // Pickup animations state
  const [pickupAnimations, setPickupAnimations] = useState<{
    [key: string]: {
      active: boolean
      startPos: Vec3
      endPos: Vec3
      startTime: number
      duration: number
      type: 'key' | 'c4' | 'star'
      color: string
    }
  }>({})

  // Imperative motion via useFrame
  function AnimateController() {
    useFrame(() => {
      const m = motionRef.current
      if (!m.active) return
      const now = performance.now()
      const t = Math.min(1, (now - m.startTime) / m.durationMs)
      const cur = new THREE.Vector3().copy(m.start).lerp(m.end, t)
      const v: Vec3 = [cur.x, cur.y, cur.z]
      agentPosRef.current = v
      setAgentPos(v)
      if (t >= 1) {
        m.active = false
        m.resolve?.()
        m.resolve = undefined
      }
    })
    return null
  }

  const apiRef = useRef<{
    moveTo: (n: NodeId) => Promise<void>;
    explodeAt: (n: NodeId) => Promise<void>;
    startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>;
    startPlacementAnimation: (toPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>;
  } | null>(null)

  if (apiRef.current == null) {
    apiRef.current = {
      moveTo: (n: NodeId) => {
        const target = NODE_POS[n]
        const cur = agentPosRef.current
        return new Promise<void>((resolve) => {
          motionRef.current.active = true
          motionRef.current.start.set(cur[0], cur[1], cur[2])
          motionRef.current.end.set(target[0], target[1], target[2])
          motionRef.current.startTime = performance.now()
          motionRef.current.durationMs = 800
          motionRef.current.resolve = resolve
        })
      },
      explodeAt: async (n: NodeId) => {
        const at = NODE_POS[n]
        setBoom({ at, t: performance.now() })
        await new Promise((r) => setTimeout(r, 500))
        setBoom({})
      },
      startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_${performance.now()}`
        const agentPos = agentPosRef.current
        const endPos: Vec3 = [agentPos[0], agentPos[1] + 1.5, agentPos[2]]

        return new Promise<void>((resolve) => {
          setPickupAnimations(prev => ({
            ...prev,
            [animId]: {
              active: true,
              startPos: fromPos,
              endPos,
              startTime: performance.now(),
              duration: 800,
              type,
              color
            }
          }))

          // Clean up animation after completion
          setTimeout(() => {
            setPickupAnimations(prev => {
              const newAnims = { ...prev }
              delete newAnims[animId]
              return newAnims
            })
            resolve()
          }, 800)
        })
      },
      startPlacementAnimation: (toPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_placement_${performance.now()}`
        const agentPos = agentPosRef.current
        const startPos: Vec3 = [agentPos[0], agentPos[1] + 1.2, agentPos[2]]

        return new Promise<void>((resolve) => {
          setPickupAnimations(prev => ({
            ...prev,
            [animId]: {
              active: true,
              startPos,
              endPos: toPos,
              startTime: performance.now(),
              duration: 600,
              type,
              color
            }
          }))

          // Clean up animation after completion
          setTimeout(() => {
            setPickupAnimations(prev => {
              const newAnims = { ...prev }
              delete newAnims[animId]
              return newAnims
            })
            resolve()
          }, 600)
        })
      },
    }
  }

  // Build tasks once, actions capture apiRef via closure
  const tasks = useMemo(() => {
    const Move = Task.of<WorldState>().from({
      lens: '/agentAt',
      condition: (agentAt, { target, system }) => agentAt !== target && isImmediatellyReachable(system, agentAt, target as NodeId),
      effect: (agentAt, { target }) => {
        agentAt._ = target as NodeId
      },
      action: async (agentAt, { target }) => {
        await apiRef.current!.moveTo(target as NodeId)
        agentAt._ = target as NodeId
      },
      description: ({ target }) => `Move to ${String(target)}`,
    })

    const PickUpKey = Task.from<WorldState>({
      condition: (state) => !state.hasKey && state.agentAt === N.TABLE,
      effect: (state) => {
        state._.hasKey = true
        state._.keyOnTable = false
      },
      action: async (state) => {
        // Hide original key immediately when animation starts
        state._.keyOnTable = false
        await apiRef.current!.startPickupAnimation([NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]], 'key', '#fbbf24')
        state._.hasKey = true
      },
      description: 'Pick up key',
    })

    const UnlockStorage = Task.from<WorldState>({
      condition: (state) => state.hasKey && !state.storageUnlocked && state.agentAt === N.STORAGE_DOOR,
      effect: (state) => {
        state._.storageUnlocked = true
      },
      action: async (state) => {
        await new Promise((r) => setTimeout(r, 200))
        state._.storageUnlocked = true
      },
      description: 'Unlock storage door with key',
    })

    const PickUpC4 = Task.from<WorldState>({
      condition: (state) => !state.hasC4 && state.agentAt === N.C4_TABLE,
      effect: (state) => {
        state._.hasC4 = true
        state._.c4Available = false
      },
      action: async (state) => {
        // Hide original C4 immediately when animation starts
        state._.c4Available = false
        await apiRef.current!.startPickupAnimation([NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]], 'c4', '#ef4444')
        state._.hasC4 = true
      },
      description: 'Pick up C4',
    })

    const PlaceC4 = Task.from<WorldState>({
      condition: (state) => state.hasC4 && !state.c4Placed && state.agentAt === N.BUNKER_DOOR,
      effect: (state) => {
        state._.hasC4 = false
        state._.c4Placed = true
      },
      action: async (state) => {
        // Remove from inventory immediately
        state._.hasC4 = false
        // Animate C4 being placed down from agent to door position
        const doorPos: Vec3 = [NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.4, NODE_POS[N.BUNKER_DOOR][2]]
        await apiRef.current!.startPlacementAnimation(doorPos, 'c4', '#ef4444')
        // Show placed C4
        state._.c4Placed = true
      },
      description: 'Place C4 on bunker',
    })

    const Detonate = Task.from<WorldState>({
      condition: (state) => state.c4Placed && !state.bunkerBreached && state.agentAt === N.SAFE,
      effect: (state) => {
        state._.bunkerBreached = true
        state._.c4Placed = false
      },
      action: async (state) => {
        await apiRef.current!.explodeAt(N.BUNKER_DOOR)
        state._.bunkerBreached = true
        state._.c4Placed = false
      },
      description: 'Detonate C4 (boom)',
    })

    const PickUpStar = Task.from<WorldState>({
      condition: (state) => !state.hasStar && state.starPresent && state.agentAt === N.STAR,
      effect: (state) => {
        state._.hasStar = true
        state._.starPresent = false
      },
      action: async (state) => {
        // Hide original star immediately when animation starts
        state._.starPresent = false
        await apiRef.current!.startPickupAnimation([NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]], 'star', '#fde68a')
        state._.hasStar = true
      },
      description: 'Pick up star',
    })

    const GoTo = Task.of<WorldState>().from({
      lens: '/agentAt',
      condition: (agentAt, { target }) => agentAt !== target,
      expansion: 'sequential',
      method: (agentAt, { system, target }) => {
        const path = findPath(system, agentAt as NodeId, target as NodeId)
        if (!path || path.length < 2) return []
        return path.slice(1).map((step) => Move({ target: step }))
      },
      description: ({ target }) => `Go to ${String(target)}`,
    })

    const AcquireKey = Task.from<WorldState>({
      condition: (state) => !state.hasKey,
      expansion: 'sequential',
      method: (_state, ctx) => [GoTo({ target: N.TABLE }), PickUpKey({ target: ctx.target })],
      description: 'Acquire key',
    })

    const AcquireC4 = Task.from<WorldState>({
      condition: (state) => !state.hasC4,
      expansion: 'sequential',
      method: (state, ctx) => {
        const steps: any[] = [GoTo({ target: N.STORAGE_DOOR })]
        if (!state.storageUnlocked) steps.push(UnlockStorage({ target: ctx.target }))
        steps.push(GoTo({ target: N.C4_TABLE }), PickUpC4({ target: ctx.target }))
        return steps
      },
      description: 'Acquire C4',
    })

    const BreachBunker = Task.from<WorldState>({
      condition: (state) => !state.bunkerBreached,
      expansion: 'sequential',
      method: (state, ctx) => {
        const steps: any[] = []
        if (!state.c4Placed) steps.push(GoTo({ target: N.BUNKER_DOOR }), PlaceC4({ target: ctx.target }))
        steps.push(GoTo({ target: N.SAFE }), Detonate({ target: ctx.target }))
        return steps
      },
      description: 'Breach bunker',
    })

    const GetStar = Task.from<WorldState>({
      condition: (state) => !state.hasStar && state.starPresent === true,
      expansion: 'sequential',
      method: (_state, ctx) => [GoTo({ target: N.STAR }), PickUpStar({ target: ctx.target })],
      description: 'Collect star',
    })

    return [
      // Methods
      GoTo,
      AcquireKey,
      AcquireC4,
      BreachBunker,
      GetStar,
      // Actions
      Move,
      PickUpKey,
      UnlockStorage,
      PickUpC4,
      PlaceC4,
      Detonate,
      PickUpStar,
    ]
  }, [])

  // Setup & run agent once
  useEffect(() => {
    let stopped = false
    const agent = Agent.from<WorldState>({ initial, tasks })
    const sub = agent.subscribe((s) => {
      if (!stopped) setWorld(s)
    })
    ;(async () => {
      setStatus('Planning...')
      agent.seek({ hasStar: true })
      const res = await agent.wait()
      if (!stopped) setStatus(res.success ? 'Mission complete' : 'Mission failed')
    })()
    return () => {
      stopped = true
      sub.unsubscribe()
      agent.stop()
    }
  }, [tasks])

  const getAgentPos = () => agentPos

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">Bunker Mission (HTN + Three.js)</h1>
        <p className="text-gray-300 mb-4">Status: {status || 'Running...'}</p>

        <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }}>
          	<CameraControls makeDefault />
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />
            <AnimateController />

            <Ground />
            {/* Grid helper - expanded for larger space */}
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Buildings and markers */}
            <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
            <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />

            {/* Storage building - using calculated positions */}
            <Building
              center={BUILDINGS.STORAGE.center}
              size={BUILDINGS.STORAGE.size}
              color="#3f6212"
              label="Storage"
              doorFace={BUILDINGS.STORAGE.doorFace}
              doorSize={BUILDINGS.STORAGE.doorSize}
              doorColor={world.storageUnlocked ? '#16a34a' : '#a16207'}
              showDoor={!world.storageUnlocked}
              opacity={world.agentAt === N.STORAGE_INT || world.agentAt === N.C4_TABLE || world.agentAt === N.STORAGE_DOOR ? AGENT_INSIDE_BUILDING_OPACITY : 1}
              debug={false}
            />
            {/* Reference markers for pathfinding nodes */}
            <BoxMarker position={NODE_POS[N.STORAGE_DOOR]} color={world.storageUnlocked ? '#16a34a' : '#a16207'} label="Storage Door" />
            <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />

            {/* Bunker building - using calculated positions */}
            <Building
              center={BUILDINGS.BUNKER.center}
              size={BUILDINGS.BUNKER.size}
              color="#374151"
              label="Bunker"
              doorFace={BUILDINGS.BUNKER.doorFace}
              doorSize={BUILDINGS.BUNKER.doorSize}
              doorColor={world.bunkerBreached ? '#16a34a' : '#7c2d12'}
              showDoor={!world.bunkerBreached}
              opacity={world.agentAt === N.BUNKER_INT || world.agentAt === N.STAR || world.agentAt === N.BUNKER_DOOR ? AGENT_INSIDE_BUILDING_OPACITY : 1}
              debug={false}
            />
            <BoxMarker position={NODE_POS[N.BUNKER_DOOR]} color={world.bunkerBreached ? '#16a34a' : '#7c2d12'} label="Bunker Door" />

            <BoxMarker position={NODE_POS[N.STAR]} color="#6b21a8" label="Star" />
            <BoxMarker position={NODE_POS[N.SAFE]} color="#0ea5e9" label="Blast Safe Zone" />

            {/* Objects in world */}
            <EnhancedObject
              position={[NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]]}
              color="#fbbf24"
              type="key"
              visible={world.keyOnTable}
            />
            <EnhancedObject
              position={[NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]]}
              color="#ef4444"
              type="c4"
              visible={world.c4Available}
            />
            <SmallSphere
              position={[NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.4, NODE_POS[N.BUNKER_DOOR][2]]}
              color="#ef4444"
              visible={world.c4Placed}
              size={0.3}
            />
            <EnhancedObject
              position={[NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]]}
              color="#fde68a"
              type="star"
              visible={world.starPresent}
            />

            {/* Agent */}
            <group>
              <AgentMesh getPos={getAgentPos} />
              {/* Agent label rendered in world space to avoid double transforms */}
              <LabelSprite position={[agentPos[0], 1.2, agentPos[2]]} text="Agent" />
            </group>

            {/* Inventory items hovering around agent */}
            {world.hasKey && (
              <InventoryItem
                agentPos={agentPos}
                type="key"
                color="#fbbf24"
                index={0}
              />
            )}
            {world.hasC4 && (
              <InventoryItem
                agentPos={agentPos}
                type="c4"
                color="#ef4444"
                index={1}
              />
            )}
            {world.hasStar && (
              <InventoryItem
                agentPos={agentPos}
                type="star"
                color="#fde68a"
                index={2}
              />
            )}

            {/* Pickup animations */}
            {Object.entries(pickupAnimations).map(([id, animation]) => (
              <PickupAnimation
                key={id}
                animation={animation}
                onComplete={() => {
                  setPickupAnimations(prev => {
                    const newAnims = { ...prev }
                    delete newAnims[id]
                    return newAnims
                  })
                }}
              />
            ))}

            {/* Explosion VFX */}
            {boom.at && (
              <mesh position={boom.at}>
                <sphereGeometry args={[0.4, 16, 16]} />
                <meshStandardMaterial color="#f97316" emissive="#dc2626" emissiveIntensity={1.2} transparent opacity={0.7} />
              </mesh>
            )}
          </Canvas>
        </div>

        <div className="mt-4 text-gray-300">
          <div>
            Inventory:{" "}
            <span>Key: {world.hasKey ? "true" : "false"}</span>
            {" | "}
            <span>C4: {world.hasC4 ? "true" : "false"}</span>
            {" | "}
            <span>Star: {world.hasStar ? "true" : "false"}</span>
          </div>
          <a href="/" className="inline-block mt-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
        </div>
      </div>
    </div>
  )
}


