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

  // AI Tools - recreate when world is initialized
  const [tools, setTools] = useState<ReturnType<typeof createAITools> | undefined>(undefined)
  
  useEffect(() => {
    if (worldRef.current) {
      setTools(createAITools(worldRef, addLog))
    }
  }, [addLog]) // Recreate when addLog changes

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

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 px-6 py-3 bg-gray-800 border-b border-gray-700">
        <h1 className="text-2xl font-bold text-white mb-1">
          AI World - Advanced Interactive 3D Environment
        </h1>
        <p className="text-sm text-gray-300">
          Explore a physics-based 3D world with AI-powered NPCs. Click to lock pointer, WASD to move, mouse to look.
        </p>
      </header>

      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        {/* Left: 3D Scene */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="flex-1 bg-black rounded-lg overflow-hidden relative">
            {worldRef.current && (
              <KeyboardControls map={CONTROLS_MAP}>
                <Canvas id="aiworld-canvas" shadows camera={{ fov: CAMERA_CONFIG.fov }}>
                  <Physics gravity={WORLD_CONFIG.physics.gravity}>
                    <GroundPhysics />
                    <BuildingColliders config={BUILDINGS.STORAGE} />
                    <BuildingColliders config={BUILDINGS.BUNKER} />
                    <Scene
                      world={worldRef.current}
                      playerPoseRef={playerPoseRef}
                      playerSpawn={SPAWN_POSITION}
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
            
          <ActionLog logs={actionLog} />
        </div>

        {/* Right: Controls, World State & Chat */}
        <div className="w-96 flex flex-col gap-3 overflow-hidden">
          <WorldCapabilities />
          
          <ControlsHelp isLocked={isLocked} />
          
          <div className="flex-1 overflow-y-auto">
              <DetailedWorldState 
                world={worldRef.current}
              />
          </div>
          
          <div className="flex-shrink-0">
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

      <footer className="flex-shrink-0 px-6 py-3 bg-gray-800 border-t border-gray-700">
        <a 
          href="/" 
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm"
        >
          ← Back to Home
        </a>
      </footer>
    </div>
  )
}
