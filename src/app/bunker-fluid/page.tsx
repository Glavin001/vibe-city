'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls, Line } from '@react-three/drei'
import { N, NodeId, NODE_POS, BUILDINGS, Vec3 } from '../../lib/bunker-world'
import { Ground, BoxMarker, AgentMesh, Building, LabelSprite, EnhancedObject, SmallSphere, InventoryItem, PickupAnimation } from '../../lib/bunker-scene'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'

export default function BunkerFluidPage() {
  const [agentPos, setAgentPos] = useState<Vec3>(NODE_POS[N.COURTYARD])
  const agentPosRef = useRef<Vec3>(agentPos)
  const [status, setStatus] = useState<string>('Idle')
  const [lastMs, setLastMs] = useState<number | null>(null)

  const [world, setWorld] = useState({
    agentAt: N.COURTYARD as NodeId,
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

  const [boom, setBoom] = useState<{ at?: Vec3; t?: number }>({})
  const [pickupAnimations, setPickupAnimations] = useState<{ [key: string]: { active: boolean; startPos: Vec3; endPos: Vec3; startTime: number; duration: number; type: 'key' | 'c4' | 'star'; color: string } }>({})
  const [showPlanVis, setShowPlanVis] = useState(true)
  const [planLinePoints, setPlanLinePoints] = useState<Vec3[]>([])
  const [planNodeMarkers, setPlanNodeMarkers] = useState<Array<{ node: NodeId; pos: Vec3; steps: Array<{ step: number; text: string }> }>>([])
  const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null)
  const PLAN_Y_OFFSET = 1.9

  const nodeTitle: Record<NodeId, string> = {
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

  const nodeIds = Object.values(N) as NodeId[]

  const schema = useMemo(() => ({
    type: 'object',
    properties: {
      initial: {
        type: 'object',
        title: 'Initial State',
        properties: {
          agentAt: { type: 'string', oneOf: nodeIds.map((id) => ({ const: id, title: nodeTitle[id] })) },
          keyOnTable: { type: 'boolean', title: 'Key On Table' },
          c4Available: { type: 'boolean', title: 'C4 Available' },
          starPresent: { type: 'boolean', title: 'Star Present' },
          hasKey: { type: 'boolean', title: 'Has Key' },
          hasC4: { type: 'boolean', title: 'Has C4' },
          hasStar: { type: 'boolean', title: 'Has Star' },
          storageUnlocked: { type: 'boolean', title: 'Storage Unlocked' },
          c4Placed: { type: 'boolean', title: 'C4 Placed' },
          bunkerBreached: { type: 'boolean', title: 'Bunker Breached' },
        },
      },
      goal: {
        type: 'object',
        title: 'Goal State',
        properties: {
          agentAt: { type: 'string', oneOf: [{ const: '', title: '(none)' }, ...nodeIds.map((id) => ({ const: id, title: nodeTitle[id] }))] },
          hasKey: { type: 'boolean', title: 'Has Key' },
          hasC4: { type: 'boolean', title: 'Has C4' },
          bunkerBreached: { type: 'boolean', title: 'Bunker Breached' },
          hasStar: { type: 'boolean', title: 'Has Star' },
        },
      },
    },
  }), [])

  const uiSchema = useMemo(() => ({
    'ui:submitButtonOptions': { norender: true },
    initial: {
      agentAt: { 'ui:widget': 'select' },
    },
    goal: {
      agentAt: { 'ui:widget': 'select' },
    },
  }), [])

  const [autoRun, setAutoRun] = useState(false)
  const [formData, setFormData] = useState<any>({
    initial: { ...world },
    goal: { hasStar: true },
  })

  const getAgentPos = () => agentPos

  useEffect(() => {
    agentPosRef.current = agentPos
  }, [agentPos])

  const apiRef = useRef<{
    moveTo: (n: NodeId) => Promise<void>
    explodeAt: (n: NodeId) => Promise<void>
    startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>
    startPlacementAnimation: (toPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => Promise<void>
  } | null>(null)

  if (apiRef.current == null) {
    apiRef.current = {
      moveTo: (n: NodeId) => animateMove(n),
      explodeAt: async (n: NodeId) => {
        const at = NODE_POS[n]
        setBoom({ at, t: performance.now() })
        await new Promise((r) => setTimeout(r, 500))
        setBoom({})
      },
      startPickupAnimation: (fromPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_${performance.now()}`
        const agent = agentPosRef.current
        const endPos: Vec3 = [agent[0], agent[1] + 1.5, agent[2]]
        return new Promise<void>((resolve) => {
          setPickupAnimations((prev) => ({
            ...prev,
            [animId]: { active: true, startPos: fromPos, endPos, startTime: performance.now(), duration: 800, type, color },
          }))
          setTimeout(() => {
            setPickupAnimations((prev) => {
              const next = { ...prev }
              delete next[animId]
              return next
            })
            resolve()
          }, 800)
        })
      },
      startPlacementAnimation: (toPos: Vec3, type: 'key' | 'c4' | 'star', color: string) => {
        const animId = `${type}_placement_${performance.now()}`
        const agent = agentPosRef.current
        const startPos: Vec3 = [agent[0], agent[1] + 1.2, agent[2]]
        return new Promise<void>((resolve) => {
          setPickupAnimations((prev) => ({
            ...prev,
            [animId]: { active: true, startPos, endPos: toPos, startTime: performance.now(), duration: 600, type, color },
          }))
          setTimeout(() => {
            setPickupAnimations((prev) => {
              const next = { ...prev }
              delete next[animId]
              return next
            })
            resolve()
          }, 600)
        })
      },
    }
  }

  async function runFluidPlan() {
    setStatus('Planning...')
    const t0 = performance.now()
    const worker = new Worker('/workers/fluid-htn.worker.js', { type: 'module' })

    // Reset world to initial from form
    const nextInitial = formData?.initial || {}
    const nextWorld = {
      agentAt: (nextInitial.agentAt as NodeId) ?? N.COURTYARD,
      keyOnTable: nextInitial.keyOnTable ?? true,
      c4Available: nextInitial.c4Available ?? true,
      starPresent: nextInitial.starPresent ?? true,
      hasKey: nextInitial.hasKey ?? false,
      hasC4: nextInitial.hasC4 ?? false,
      hasStar: nextInitial.hasStar ?? false,
      storageUnlocked: nextInitial.storageUnlocked ?? false,
      c4Placed: nextInitial.c4Placed ?? false,
      bunkerBreached: nextInitial.bunkerBreached ?? false,
    }
    setWorld(nextWorld)
    const startPos = NODE_POS[nextWorld.agentAt]
    agentPosRef.current = startPos
    setAgentPos(startPos)

    const requestPayload = {
      initial: { ...nextWorld },
      goal: { ...(formData?.goal || {}) },
    }

    const steps: string[] = await new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const { type, steps, elapsedMs, message } = ev.data || {}
        if (type === 'result') {
          setLastMs(elapsedMs)
          resolve(steps)
        } else if (type === 'error') {
          reject(new Error(message))
        }
        worker.terminate()
      }
      worker.postMessage({ type: 'planRequest', request: requestPayload, enableDebug: false })
    })

    const t1 = performance.now()
    setStatus(`Executing plan (${Math.round(t1 - t0)} ms to plan)`)

    // Build plan visualization from MOVE steps
    try {
      const raise = (p: Vec3): Vec3 => [p[0], p[1] + PLAN_Y_OFFSET, p[2]]
      const linePts: Vec3[] = [raise(NODE_POS[nextWorld.agentAt])]
      const nodeSteps: Record<string, Array<{ step: number; text: string }>> = {}

      const pretty = (op: string, arg?: string) => {
        switch (op) {
          case 'MOVE': return `Move to ${nodeTitle[arg as NodeId] ?? arg}`
          case 'PICKUP_KEY': return 'Pick up key'
          case 'UNLOCK_STORAGE': return 'Unlock storage'
          case 'PICKUP_C4': return 'Pick up C4'
          case 'PLACE_C4': return 'Place C4'
          case 'DETONATE': return 'Detonate'
          case 'PICKUP_STAR': return 'Pick up star'
          default: return op
        }
      }

      const actionNode = (op: string, arg?: string): NodeId | null => {
        if (op === 'MOVE' && arg) return arg as NodeId
        switch (op) {
          case 'PICKUP_KEY': return N.TABLE
          case 'UNLOCK_STORAGE': return N.STORAGE_DOOR
          case 'PICKUP_C4': return N.C4_TABLE
          case 'PLACE_C4': return N.BUNKER_DOOR
          case 'DETONATE': return N.SAFE
          case 'PICKUP_STAR': return N.STAR
          default: return null
        }
      }

      let stepIndex = 0
      for (const s of steps) {
        stepIndex += 1
        const [op, arg] = s.split(' ')
        const n = actionNode(op, arg)
        if (n) {
          if (op === 'MOVE') {
            linePts.push(raise(NODE_POS[n]))
          }
          const key = n
          ;(nodeSteps[key] ||= []).push({ step: stepIndex, text: pretty(op, arg) })
        }
      }
      const markers = Object.keys(nodeSteps).map((k) => {
        const node = k as NodeId
        return { node, pos: raise(NODE_POS[node]), steps: nodeSteps[k].sort((a, b) => a.step - b.step) }
      })
      setPlanLinePoints(linePts)
      setPlanNodeMarkers(markers)
    } catch {}

    for (const s of steps) {
      const [op, arg] = s.split(' ')
      if (op === 'MOVE' && arg) {
        await apiRef.current!.moveTo(arg as NodeId)
        setWorld((w) => ({ ...w, agentAt: arg as NodeId }))
        continue
      }
      if (op === 'PICKUP_KEY') {
        setWorld((w) => ({ ...w, keyOnTable: false }))
        await apiRef.current!.startPickupAnimation([NODE_POS[N.TABLE][0], NODE_POS[N.TABLE][1] + 0.6, NODE_POS[N.TABLE][2]], 'key', '#fbbf24')
        setWorld((w) => ({ ...w, hasKey: true }))
        continue
      }
      if (op === 'UNLOCK_STORAGE') {
        await new Promise((r) => setTimeout(r, 200))
        setWorld((w) => ({ ...w, storageUnlocked: true }))
        continue
      }
      if (op === 'PICKUP_C4') {
        setWorld((w) => ({ ...w, c4Available: false }))
        await apiRef.current!.startPickupAnimation([NODE_POS[N.C4_TABLE][0], NODE_POS[N.C4_TABLE][1] + 0.6, NODE_POS[N.C4_TABLE][2]], 'c4', '#ef4444')
        setWorld((w) => ({ ...w, hasC4: true }))
        continue
      }
      if (op === 'PLACE_C4') {
        setWorld((w) => ({ ...w, hasC4: false }))
        const doorPos: Vec3 = [NODE_POS[N.BUNKER_DOOR][0], NODE_POS[N.BUNKER_DOOR][1] + 0.4, NODE_POS[N.BUNKER_DOOR][2]]
        await apiRef.current!.startPlacementAnimation(doorPos, 'c4', '#ef4444')
        setWorld((w) => ({ ...w, c4Placed: true }))
        continue
      }
      if (op === 'DETONATE') {
        await apiRef.current!.explodeAt(N.BUNKER_DOOR)
        setWorld((w) => ({ ...w, bunkerBreached: true, c4Placed: false }))
        continue
      }
      if (op === 'PICKUP_STAR') {
        setWorld((w) => ({ ...w, starPresent: false }))
        await apiRef.current!.startPickupAnimation([NODE_POS[N.STAR][0], NODE_POS[N.STAR][1] + 0.5, NODE_POS[N.STAR][2]], 'star', '#fde68a')
        setWorld((w) => ({ ...w, hasStar: true }))
        continue
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    setStatus('Done')
  }

  function animateMove(target: NodeId) {
    const start = agentPosRef.current
    const end = NODE_POS[target]
    const startVec = new THREE.Vector3(...start)
    const endVec = new THREE.Vector3(...end)
    const durationMs = 800
    const startTime = performance.now()
    return new Promise<void>((resolve) => {
      function tick() {
        const t = Math.min(1, (performance.now() - startTime) / durationMs)
        const cur = startVec.clone().lerp(endVec, t)
        const v: Vec3 = [cur.x, cur.y, cur.z]
        agentPosRef.current = v
        setAgentPos(v)
        if (t < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="p-6">
        <h1 className="text-3xl font-bold text-white mb-2">Bunker (Fluid HTN + WASM)</h1>
        <p className="text-gray-300 mb-4">Status: {status} {lastMs != null ? `(planner ${lastMs} ms)` : ''}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">Planner Controls</h2>
              <label className="text-gray-300 text-sm flex items-center gap-2">
                <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} /> Auto-run
              </label>
            </div>
            <div className="flex items-center gap-4 mb-3 text-gray-300 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showPlanVis} onChange={(e) => setShowPlanVis(e.target.checked)} /> Show plan visualization
              </label>
            </div>
            <Form
              schema={schema as any}
              uiSchema={uiSchema as any}
              formData={formData}
              onChange={(e) => {
                setFormData(e.formData)
                if (autoRun) {
                  // debounce minimal
                  setTimeout(() => runFluidPlan(), 0)
                }
              }}
              onSubmit={(e) => runFluidPlan()}
              validator={validator as any}
            >
              <></>
            </Form>
            <button onClick={runFluidPlan} className="mt-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg">Run Plan</button>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <h2 className="text-white font-semibold mb-3">Current State</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-gray-300 text-sm">
              <div className="opacity-80">Agent At</div>
              <div className="font-medium">{nodeTitle[world.agentAt]}</div>

              <div className="opacity-80">Key On Table</div>
              <div className="font-mono">{String(world.keyOnTable)}</div>

              <div className="opacity-80">C4 Available</div>
              <div className="font-mono">{String(world.c4Available)}</div>

              <div className="opacity-80">Star Present</div>
              <div className="font-mono">{String(world.starPresent)}</div>

              <div className="opacity-80">Has Key</div>
              <div className="font-mono">{String(world.hasKey)}</div>

              <div className="opacity-80">Has C4</div>
              <div className="font-mono">{String(world.hasC4)}</div>

              <div className="opacity-80">Has Star</div>
              <div className="font-mono">{String(world.hasStar)}</div>

              <div className="opacity-80">Storage Unlocked</div>
              <div className="font-mono">{String(world.storageUnlocked)}</div>

              <div className="opacity-80">C4 Placed</div>
              <div className="font-mono">{String(world.c4Placed)}</div>

              <div className="opacity-80">Bunker Breached</div>
              <div className="font-mono">{String(world.bunkerBreached)}</div>
            </div>
            <a href="/" className="inline-block mt-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
          </div>
        </div>

        <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden">
          <Canvas shadows camera={{ position: [0, 12, 24], fov: 50 }}>
            <CameraControls makeDefault />
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />

            <Ground />
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Plan visualization */}
            {showPlanVis && planLinePoints.length >= 2 && (
              <Line points={planLinePoints} color="#22d3ee" lineWidth={2} dashed={false} />
            )}
            {showPlanVis && planNodeMarkers.map((m) => (
              <group key={`nodept_${m.node}`} position={m.pos} onPointerOver={() => setHoveredNode(m.node)} onPointerOut={() => setHoveredNode(null)}>
                <mesh>
                  <sphereGeometry args={[0.12, 12, 12]} />
                  <meshStandardMaterial color={hoveredNode === m.node ? '#22d3ee' : '#0ea5e9'} />
                </mesh>
                {/* Step list (multi-line) */}
                <LabelSprite position={[0, 0.5, 0]} text={m.steps.map(s => `${s.step}. ${s.text}`).join("\n")} />
                {hoveredNode === m.node && (
                  <LabelSprite position={[0, 1.1, 0]} text={nodeTitle[m.node]} />
                )}
              </group>
            ))}

            {/* Reference markers and buildings */}
            <BoxMarker position={NODE_POS[N.COURTYARD]} color="#2c3e50" label="Courtyard" />
            <BoxMarker position={NODE_POS[N.TABLE]} color="#2f74c0" label="Table" />

            {/* Storage building */}
            <Building
              center={BUILDINGS.STORAGE.center}
              size={BUILDINGS.STORAGE.size}
              color="#3f6212"
              label="Storage"
              doorFace={BUILDINGS.STORAGE.doorFace}
              doorSize={BUILDINGS.STORAGE.doorSize}
              doorColor={world.storageUnlocked ? '#16a34a' : '#a16207'}
              showDoor={!world.storageUnlocked}
              opacity={world.agentAt === N.STORAGE_INT || world.agentAt === N.C4_TABLE || world.agentAt === N.STORAGE_DOOR ? 0.5 : 1}
              debug={false}
            />
            <BoxMarker position={NODE_POS[N.STORAGE_DOOR]} color={world.storageUnlocked ? '#16a34a' : '#a16207'} label="Storage Door" />
            <BoxMarker position={NODE_POS[N.C4_TABLE]} color="#7f1d1d" label="C4 Table" />

            {/* Bunker building */}
            <Building
              center={BUILDINGS.BUNKER.center}
              size={BUILDINGS.BUNKER.size}
              color="#374151"
              label="Bunker"
              doorFace={BUILDINGS.BUNKER.doorFace}
              doorSize={BUILDINGS.BUNKER.doorSize}
              doorColor={world.bunkerBreached ? '#16a34a' : '#7c2d12'}
              showDoor={!world.bunkerBreached}
              opacity={world.agentAt === N.BUNKER_INT || world.agentAt === N.STAR || world.agentAt === N.BUNKER_DOOR ? 0.5 : 1}
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
              <AgentMesh getPos={() => agentPos} />
              <LabelSprite position={[agentPos[0], 1.2, agentPos[2]]} text="Agent" />
            </group>

            {/* Inventory items */}
            {world.hasKey && (
              <InventoryItem agentPos={agentPos} type="key" color="#fbbf24" index={0} />
            )}
            {world.hasC4 && (
              <InventoryItem agentPos={agentPos} type="c4" color="#ef4444" index={1} />
            )}
            {world.hasStar && (
              <InventoryItem agentPos={agentPos} type="star" color="#fde68a" index={2} />
            )}

            {/* Pickup animations */}
            {Object.entries(pickupAnimations).map(([id, animation]) => (
              <PickupAnimation key={id} animation={animation} onComplete={() => {
                setPickupAnimations((prev) => {
                  const next = { ...prev }
                  delete next[id]
                  return next
                })
              }} />
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
            Inventory:{' '}
            <span>Key: {world.hasKey ? 'true' : 'false'}</span>
            {' | '}
            <span>C4: {world.hasC4 ? 'true' : 'false'}</span>
            {' | '}
            <span>Star: {world.hasStar ? 'true' : 'false'}</span>
          </div>
          <a href="/" className="inline-block mt-3 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
        </div>
      </div>
    </div>
  )
}


