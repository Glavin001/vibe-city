'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { KeyboardControls } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { GroundPhysics } from '@/components/physics/GroundPhysics'
import { BuildingColliders } from '@/components/physics/BuildingColliders'
import { BUILDINGS } from '@/lib/bunker-world'
import { useClientSideChat } from '@/ai/hooks/use-chat'
import { google } from '@/ai/providers/google'
import type { World } from './actions'
import { createDemoWorld } from './world-setup'
import { Scene } from './components-3d'
import { createAITools, AI_SYSTEM_PROMPT } from './ai-tools'
import { ActionLog, ChatPanel, ApiKeyInput } from './ui-components'
import { DetailedWorldState } from './components-world-state'
import { ControlsHelp, WorldCapabilities } from './components-help'
import { CONTROLS_MAP, LOCAL_STORAGE_KEY, type AgentPose } from './types'
import { WORLD_CONFIG, CAMERA_CONFIG } from './config'

/* ============================= MAIN PAGE ============================= */

export default function AIWorldPage() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState("")

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY)
      if (stored) setApiKey(stored)
    } catch {
      // Ignore localStorage errors
    }
  }, [])

  const handleSaveKey = useCallback(() => {
    if (!inputKey) return
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, inputKey)
      setApiKey(inputKey)
    } catch {
      // Ignore localStorage errors
    }
  }, [inputKey])

  if (!apiKey) {
    return <ApiKeyInput inputKey={inputKey} setInputKey={setInputKey} onSave={handleSaveKey} />
  }

  return <AIWorldMain apiKey={apiKey} />
}

/* ============================= MAIN COMPONENT ============================= */

function AIWorldMain({ apiKey }: { apiKey: string }) {
  // World state
  const worldRef = useRef<World | null>(null)
  const [playerAgent, setPlayerAgent] = useState<string | null>(null)
  const [worldVersion, setWorldVersion] = useState(0) // Force re-renders when world changes
  
  useEffect(() => {
    const { world, playerAgent: player } = createDemoWorld()
    worldRef.current = world
    setPlayerAgent(player)
  }, [])

  // Player state
  // IMPORTANT: Physics spawn position uses capsule center height (0.9m), NOT eye height
  const SPAWN_POSITION: [number, number, number] = useMemo(() => [0, 0.9, 0], [])
  
  const playerPoseRef = useRef<AgentPose>({ 
    position: [0, 1.65, 0], // Eye height for display only
    yaw: 3/4 * Math.PI,
    pitch: 0,
  })
  const [isLocked, setIsLocked] = useState(false)
  const handleLock = useCallback(() => setIsLocked(true), [])
  const handleUnlock = useCallback(() => setIsLocked(false), [])

  // Mirror player pose into world model without triggering React re-renders
  useEffect(() => {
    const id = setInterval(() => {
      // Mirror pose into world data model for UI panels
      if (worldRef.current && playerAgent) {
        const pos = playerPoseRef.current.position
        worldRef.current.positions.set(playerAgent, { 
          x: pos[0], 
          y: pos[1], 
          z: pos[2], 
          room: "courtyard" 
        })
      }
    }, WORLD_CONFIG.updates.playerPoseUpdate)
    return () => clearInterval(id)
  }, [playerAgent])

  // Chat and action log
  const [input, setInput] = useState("")
  const [actionLog, setActionLog] = useState<string[]>([])
  
  const addLog = useCallback((message: string) => {
    setActionLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
  }, [])

  // Player interaction state
  const [interactPrompt, setInteractPrompt] = useState<string>('')
  const [interactTarget, setInteractTarget] = useState<[number, number, number] | null>(null)
  const interactHandlerRef = useRef<() => void>(() => {})
  
  // Helper for distance checks
  const distTo = useCallback((pos: [number, number, number]) => {
    const p = playerPoseRef.current.position
    const dx = p[0] - pos[0]
    const dz = p[2] - pos[2]
    return Math.hypot(dx, dz)
  }, [])

  // Trigger world update for 3D scene re-render
  const triggerWorldUpdate = useCallback(() => {
    setWorldVersion(v => v + 1)
  }, [])

  // AI Tools - recreate when world is initialized
  const [tools, setTools] = useState<ReturnType<typeof createAITools> | undefined>(undefined)
  
  useEffect(() => {
    if (worldRef.current) {
      setTools(createAITools(worldRef, addLog, triggerWorldUpdate))
    }
  }, [addLog, triggerWorldUpdate]) // Recreate when callbacks change

  const model = useMemo(() => google(WORLD_CONFIG.ai.model, { apiKey }), [apiKey])
  
  const { messages, sendMessage, status, error, setSystemPrompt } = useClientSideChat(model, { 
    tools: tools || {}
  })
  
  useEffect(() => {
    setSystemPrompt(AI_SYSTEM_PROMPT)
  }, [setSystemPrompt])

  const handleSendMessage = useCallback(() => {
    if (input.trim().length === 0) return
    sendMessage({ text: input })
    setInput('')
  }, [input, sendMessage])

  // Player interaction detection
  useEffect(() => {
    const id = setInterval(() => {
      const world = worldRef.current
      if (!world || !playerAgent) {
        setInteractPrompt('')
        setInteractTarget(null)
        return
      }

      // Check each item for pickup
      for (const [itemId, item] of world.items.entries()) {
        const itemPos = world.positions.get(itemId)
        if (!itemPos) continue
        
        // Check if already in someone's inventory
        let inInventory = false
        for (const [, inv] of world.inventories.entries()) {
          if (inv.items.includes(itemId)) {
            inInventory = true
            break
          }
        }
        if (inInventory) continue
        
        // Check distance
        const dist = distTo([itemPos.x, itemPos.y, itemPos.z ?? 0])
        if (dist <= 1.7) {
          setInteractPrompt(`Press E to Pick up ${item.name}`)
          setInteractTarget([itemPos.x, itemPos.y + 0.5, itemPos.z ?? 0])
          interactHandlerRef.current = () => {
            // Pick up item
            const playerInv = world.inventories.get(playerAgent)
            if (playerInv && !playerInv.items.includes(itemId)) {
              playerInv.items.push(itemId)
              world.positions.delete(itemId) // Remove from world
              addLog(`Picked up ${item.name}`)
              triggerWorldUpdate() // Force 3D scene update
            }
          }
          return
        }
      }
      
      // No interactions available
      setInteractPrompt('')
      setInteractTarget(null)
      interactHandlerRef.current = () => {}
    }, 120)
    return () => clearInterval(id)
  }, [playerAgent, distTo, addLog, triggerWorldUpdate])

  // Keyboard binding for player actions
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'e' || e.key === 'E') {
        interactHandlerRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">
            AI World - Advanced Interactive 3D Environment
          </h1>
        </div>
        <a 
          href="/" 
          className="ml-4 bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-3 rounded-lg transition-colors text-sm whitespace-nowrap"
        >
          ← Back to Home
        </a>
      </header>

      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {/* Left: 3D Scene + Bottom Panel (World State + Action Log) */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <div className="flex-1 bg-black rounded-lg overflow-hidden relative">
            {worldRef.current && (
              <KeyboardControls map={CONTROLS_MAP}>
                <Canvas id="aiworld-canvas" shadows camera={{ fov: CAMERA_CONFIG.fov }}>
                  <Physics gravity={WORLD_CONFIG.physics.gravity}>
                    <GroundPhysics />
                    <BuildingColliders config={BUILDINGS.STORAGE} />
                    <BuildingColliders config={BUILDINGS.BUNKER} />
                    <Scene
                      key={worldVersion}
                      world={worldRef.current}
                      playerPoseRef={playerPoseRef}
                      playerSpawn={SPAWN_POSITION}
                      interactPrompt={interactPrompt}
                      interactTarget={interactTarget}
                      interactHandlerRef={interactHandlerRef}
                      onLock={handleLock}
                      onUnlock={handleUnlock}
                    />
                  </Physics>
                </Canvas>
              </KeyboardControls>
            )}
            <div 
              id="startPointerLock" 
              className="absolute inset-0 select-none cursor-pointer pointer-events-none" 
              style={{ display: isLocked ? 'none' : 'block' }} 
              title="Click to start (Esc to unlock)"
            >
              <div className="pointer-events-none absolute bottom-3 right-3 text-sm bg-gray-900/60 text-gray-200 px-3 py-2 rounded-lg">
                Click to start · Esc to unlock · WASD to move
              </div>
            </div>
          </div>
          
          {/* Bottom Panel: World State (2/3) + Action Log (1/3) */}
          <div className="flex-shrink-0 h-64 flex gap-3">
            <div className="flex-1 basis-2/3 overflow-y-auto">
              <DetailedWorldState world={worldRef.current} />
            </div>
            <div className="flex-1 basis-1/3 overflow-hidden">
              <ActionLog logs={actionLog} />
            </div>
          </div>
        </div>

        {/* Right: Controls & Chat */}
        <div className="w-96 flex flex-col gap-3 overflow-hidden">
          <WorldCapabilities />
          
          <ControlsHelp isLocked={isLocked} />
          
          <div className="flex-1 min-h-0">
            <ChatPanel
              messages={messages}
              status={status}
              error={error}
              input={input}
              setInput={setInput}
              onSendMessage={handleSendMessage}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
