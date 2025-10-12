'use client'

import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, Text } from '@react-three/drei'
import { Model, type ActionName } from '@/components/UniversalHumanoid'
import type * as THREE from 'three'
import { useState, useCallback, useEffect } from 'react'

interface AnimatedHumanoidProps {
  position: [number, number, number]
  color: string
  label: string
  currentAnimation: ActionName
}

function AnimatedHumanoid({ position, color, label, currentAnimation }: AnimatedHumanoidProps) {
  const [actions, setActions] = useState<Record<ActionName, THREE.AnimationAction | null> | null>(null)
  const [previousAnimation, setPreviousAnimation] = useState<ActionName>('Idle_Loop')

  const handleActionsReady = useCallback((loadedActions: Record<ActionName, THREE.AnimationAction | null>) => {
    setActions(loadedActions)
    // Play initial animation
    const initialAction = loadedActions.Idle_Loop
    if (initialAction) {
      initialAction.reset().play()
      console.log('Playing initial animation: Idle_Loop')
    }
  }, [])

  // When currentAnimation prop changes, switch the animation
  useEffect(() => {
    if (!actions) return
    if (currentAnimation === previousAnimation) return

    console.log(`Switching animation from ${previousAnimation} to ${currentAnimation}`)

    const prevAction = actions[previousAnimation]
    const newAction = actions[currentAnimation]

    if (prevAction?.isRunning()) {
      prevAction.fadeOut(0.5)
    }

    if (newAction) {
      newAction.reset().fadeIn(0.5).play()
      setPreviousAnimation(currentAnimation)
    }
  }, [currentAnimation, actions, previousAnimation])

  return (
    <group position={position}>
      <Model onActionsReady={handleActionsReady} scale={1.5} />
      
      {/* Label above character */}
      <Text
        position={[0, 3, 0]}
        fontSize={0.3}
        color={color}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
      
      {/* Current animation indicator */}
      <Text
        position={[0, 2.5, 0]}
        fontSize={0.15}
        color="white"
        anchorX="center"
        anchorY="middle"
      >
        {currentAnimation.replace(/_/g, ' ')}
      </Text>
    </group>
  )
}

// Keyboard shortcuts mapped to animations
const KEYBOARD_SHORTCUTS: Record<string, ActionName> = {
  '1': 'Idle_Loop',
  'w': 'Walk_Loop',
  'r': 'Jog_Fwd_Loop',
  'Shift': 'Sprint_Loop',
  'c': 'Crouch_Fwd_Loop',
  'v': 'Crouch_Idle_Loop',
  ' ': 'Jump_Start', // Space
  'j': 'Jump_Loop',
  'l': 'Jump_Land',
  'q': 'Roll',
  'e': 'Interact',
  'p': 'PickUp_Table',
  'f': 'Punch_Jab',
  'g': 'Punch_Cross',
  's': 'Sword_Attack',
  'x': 'Pistol_Shoot',
  'z': 'Pistol_Reload',
  'i': 'Pistol_Idle_Loop',
  'd': 'Dance_Loop',
  't': 'Sitting_Idle_Loop',
}

// Reverse mapping for display
const ANIMATION_TO_KEY: Record<ActionName, string> = Object.entries(KEYBOARD_SHORTCUTS).reduce((acc, [key, anim]) => {
  acc[anim] = key === ' ' ? 'Space' : key === 'Shift' ? 'Shift' : key.toUpperCase()
  return acc
}, {} as Record<ActionName, string>)

const ANIMATION_CATEGORIES = {
  'Movement': ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Fwd_Loop', 'Crouch_Idle_Loop'],
  'Actions': ['Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Interact', 'PickUp_Table'],
  'Combat': ['Punch_Jab', 'Punch_Cross', 'Sword_Attack', 'Pistol_Shoot', 'Pistol_Reload', 'Pistol_Idle_Loop'],
  'Special': ['Dance_Loop', 'Sitting_Idle_Loop', 'Sitting_Enter', 'Sitting_Exit', 'Death01', 'Hit_Chest'],
} as const

export default function HumanoidDemo() {
  const [currentAnimation, setCurrentAnimation] = useState<ActionName>('Idle_Loop')

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const key = event.key
      const animation = KEYBOARD_SHORTCUTS[key]
      
      if (animation) {
        event.preventDefault()
        setCurrentAnimation(animation)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="w-full h-screen relative">
      {/* 3D Scene */}
      <Canvas camera={{ position: [0, 4, 10], fov: 50 }}>
        <color attach="background" args={['#1a1a2e']} />
        
        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
        <pointLight position={[-10, 10, -5]} intensity={0.5} />

        {/* Environment */}
        <Environment preset="sunset" />
        
        {/* Ground Grid */}
        <Grid
          args={[20, 20]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#6b7280"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#9ca3af"
          fadeDistance={25}
          fadeStrength={1}
          position={[0, 0, 0]}
        />

        {/* Humanoid Models - Each with independent skeleton for animations */}
        <AnimatedHumanoid 
          position={[-4, 0, 0]} 
          color="#ef4444" 
          label="Character 1"
          currentAnimation={currentAnimation}
        />
        <AnimatedHumanoid 
          position={[0, 0, 0]} 
          color="#3b82f6" 
          label="Character 2"
          currentAnimation={currentAnimation}
        />
        <AnimatedHumanoid 
          position={[4, 0, 0]} 
          color="#10b981" 
          label="Character 3"
          currentAnimation={currentAnimation}
        />

        <OrbitControls
          makeDefault
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2}
          target={[0, 1, 0]}
        />
      </Canvas>

      {/* Header - Compact */}
      <div className="absolute top-0 left-0 right-0 p-2 pointer-events-none z-10">
        <div className="max-w-7xl mx-auto">
          <div className="bg-black/90 backdrop-blur-sm rounded-lg p-2 px-3 pointer-events-auto">
            <h1 className="text-lg font-bold text-white">Universal Humanoid Demo</h1>
            <p className="text-gray-400 text-xs">
              Click any animation button below to play it on all three characters
            </p>
          </div>
        </div>
      </div>

      {/* Animation Control Panel - Compact */}
      <div className="absolute bottom-0 left-0 right-0 p-2 pointer-events-none z-10">
        <div className="max-w-7xl mx-auto">
          <div className="bg-black/95 backdrop-blur-sm rounded-lg p-2 pointer-events-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div>
                  <h2 className="text-xs font-semibold text-gray-400">Current</h2>
                  <p className="text-lg font-bold text-blue-400">{currentAnimation.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-gray-400">Red</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-gray-400">Blue</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-400">Green</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-gray-500">
                  ⌨️ Keyboard shortcuts enabled
                </div>
                <div className="text-xs text-gray-500">
                  2.18MB • 45 animations • 3 characters
                </div>
              </div>
            </div>

            {/* Animation Categories - Compact Grid */}
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(ANIMATION_CATEGORIES).map(([category, animations]) => (
                <div key={category}>
                  <h3 className="text-[10px] font-semibold text-gray-500 uppercase mb-1">{category}</h3>
                  <div className="flex flex-wrap gap-1">
                    {animations.map((anim) => {
                      const shortcut = ANIMATION_TO_KEY[anim as ActionName]
                      return (
                        <button
                          key={anim}
                          type="button"
                          onClick={() => setCurrentAnimation(anim as ActionName)}
                          className={`px-2 py-1 rounded text-xs font-medium transition-all duration-200 relative ${
                            currentAnimation === anim
                              ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/50'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                          title={shortcut ? `Press ${shortcut}` : undefined}
                        >
                          {anim.replace(/_/g, ' ')}
                          {shortcut && (
                            <span className="ml-1 text-[9px] opacity-60 font-mono bg-black/30 px-1 rounded">
                              {shortcut}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Camera Controls & Shortcuts Helper - Compact */}
      <div className="absolute top-16 right-2 pointer-events-none z-10 space-y-2">
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-2 text-white pointer-events-auto">
          <h3 className="font-semibold text-xs mb-1">Camera Controls</h3>
          <ul className="text-[10px] text-gray-300 space-y-0.5">
            <li>🖱️ Drag to rotate</li>
            <li>🖱️ Right-click to pan</li>
            <li>📜 Scroll to zoom</li>
          </ul>
        </div>
        
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-2 text-white pointer-events-auto">
          <h3 className="font-semibold text-xs mb-1">⌨️ Keyboard Shortcuts</h3>
          <div className="text-[10px] text-gray-300 space-y-0.5">
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">1</kbd> Idle</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">W</kbd> Walk</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">R</kbd> Jog</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">⇧</kbd> Sprint</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">Space</kbd> Jump</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">Q</kbd> Roll</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">E</kbd> Interact</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">S</kbd> Sword</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">F</kbd> Punch</div>
              <div><kbd className="font-mono bg-gray-700 px-1 rounded">D</kbd> Dance</div>
            </div>
            <p className="text-[9px] text-gray-500 mt-1 italic">+ more (hover buttons)</p>
          </div>
        </div>
      </div>
    </div>
  )
}

