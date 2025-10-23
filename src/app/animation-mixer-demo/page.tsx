'use client'

import { Canvas, useFrame, useGraph } from '@react-three/fiber'
import { OrbitControls, Grid, Environment, useGLTF } from '@react-three/drei'
import type * as THREE from 'three'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Animator } from '@/lib/animation-machine'
import { createHumanoidLocomotionGraph, getRequiredClipNames, getBlendSpaceClipNames } from '@/lib/animation-machine/humanoid-locomotion'
import { SkeletonUtils } from 'three-stdlib'

// Custom model component that doesn't use useAnimations to avoid mixer conflicts
function HumanoidModel(props: React.JSX.IntrinsicElements['group'] & { onLoaded?: (group: THREE.Group, clips: THREE.AnimationClip[]) => void }) {
  const { onLoaded, ...groupProps } = props
  const groupRef = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF('/models/AnimationLibrary_Godot_Standard-transformed.glb')
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene])
  const graph = useGraph(clone)
  const nodes = graph.nodes as {
    Mannequin_1: THREE.SkinnedMesh
    Mannequin_2: THREE.SkinnedMesh
    root: THREE.Bone
  }
  const materials = graph.materials as {
    M_Main: THREE.MeshStandardMaterial
    M_Joints: THREE.MeshStandardMaterial
  }

  useEffect(() => {
    if (groupRef.current && onLoaded && animations) {
      onLoaded(groupRef.current, animations as THREE.AnimationClip[])
    }
  }, [onLoaded, animations])

  return (
    <group ref={groupRef} {...groupProps} dispose={null}>
      <group name="Scene">
        <group name="Rig">
          <primitive object={nodes.root} />
        </group>
        <group name="Mannequin">
          <skinnedMesh name="Mannequin_1" geometry={nodes.Mannequin_1.geometry} material={materials.M_Main} skeleton={nodes.Mannequin_1.skeleton} />
          <skinnedMesh name="Mannequin_2" geometry={nodes.Mannequin_2.geometry} material={materials.M_Joints} skeleton={nodes.Mannequin_2.skeleton} />
        </group>
      </group>
    </group>
  )
}

interface AnimatedCharacterProps {
  position: [number, number, number]
  onAnimatorReady?: (animator: Animator) => void
}

function AnimatedCharacter({ position, onAnimatorReady }: AnimatedCharacterProps) {
  const animatorRef = useRef<Animator | null>(null)

  const handleModelLoaded = useCallback((group: THREE.Group, clips: THREE.AnimationClip[]) => {
    console.log(`Model loaded with ${clips.length} clips:`, clips.map(c => c.name))
    
    // Filter out T-pose - we never want to use it
    const filteredClips = clips.filter(clip => !clip.name.includes('TPose'))
    console.log(`After filtering: ${filteredClips.length} clips`)
    
    // Check if we have the clips we need
    const requiredClips = getRequiredClipNames()
    const availableClipNames = filteredClips.map(c => c.name)
    const missingClips = requiredClips.filter(name => !availableClipNames.includes(name))
    
    console.log('Available clips:', availableClipNames.sort())
    console.log('Required clips:', requiredClips)
    
    if (missingClips.length > 0) {
      console.error('❌ MISSING REQUIRED CLIPS:', missingClips)
      console.error('This will cause T-pose! Fix clip names in the config.')
    } else {
      console.log('✅ All required clips found!')
    }
    
    // Log which clips are actually used in the blend space
    const blendSpaceClips = getBlendSpaceClipNames()
    const blendSpaceMissing = blendSpaceClips.filter(name => !availableClipNames.includes(name))
    if (blendSpaceMissing.length > 0) {
      console.error('❌ BLEND SPACE MISSING CLIPS:', blendSpaceMissing)
    } else {
      console.log('✅ All blend space clips available')
    }
    
    // Create animator with our graph config
    const config = createHumanoidLocomotionGraph()
    
    // VALIDATE: Check that all blend space clips exist in Moving state
    console.log('🔍 Validating blend space configuration...')
    const movingState = config.layers[0].states.Moving
    if (movingState && movingState.node.type === 'blend1d') {
      const blendChildren = movingState.node.children
      const missingInBlendSpace: string[] = []
      
      for (const child of blendChildren) {
        const clipName = child.motion.clip
        if (!availableClipNames.includes(clipName)) {
          missingInBlendSpace.push(clipName)
        }
      }
      
      if (missingInBlendSpace.length > 0) {
        console.error('❌ FATAL: Moving state blend space references clips that don\'t exist!')
        console.error('Missing clips:', missingInBlendSpace)
        console.error('This WILL cause T-pose artifacts!')
        alert(`Animation Error: Missing clips ${missingInBlendSpace.join(', ')}. Check console.`)
      } else {
        console.log('✅ All Moving state blend space clips validated')
      }
      
      console.log(`Moving state blend space has ${blendChildren.length} samples`)
    }
    
    const animator = new Animator(group, filteredClips, config)
    animatorRef.current = animator
    
    console.log('✅ Animator created successfully')
    console.log('Initial parameters:', {
      speedX: animator.get('speedX'),
      speedY: animator.get('speedY'),
      grounded: animator.get('grounded')
    })
    
    if (onAnimatorReady) {
      onAnimatorReady(animator)
    }
  }, [onAnimatorReady])

  useFrame((_state, delta) => {
    if (animatorRef.current) {
      animatorRef.current.update(Math.min(delta, 0.1))
      
      // VALIDATION: Check for blend weight issues
      if (Math.random() < 0.016) { // ~60fps = 1 per second
        const mixer = animatorRef.current.mixer as THREE.AnimationMixer & { _actions?: THREE.AnimationAction[] }
        const actions = mixer._actions
        if (actions && actions.length > 0) {
          const activeActions = actions.filter(a => a.isRunning() && a.getEffectiveWeight() > 0.01)
          
          // Calculate total weight for base layer (non-masked)
          const baseLayerActions = activeActions.filter(a => !a.getClip().name.includes('masked'))
          const baseLayerWeight = baseLayerActions.reduce((sum, a) => sum + a.getEffectiveWeight(), 0)
          
          // WARNING: Weight should be close to 1.0
          if (baseLayerWeight < 0.95 || baseLayerWeight > 1.05) {
            console.error('⚠️ BLEND WEIGHT ERROR! Total weight:', baseLayerWeight.toFixed(2), 'Expected: ~1.00')
            console.error('Missing weight:', (1.0 - baseLayerWeight).toFixed(2), '← This shows as T-pose!')
            console.error('Active clips:', baseLayerActions.map(a => `${a.getClip().name}: ${a.getEffectiveWeight().toFixed(2)}`))
          }
          
          const actionInfo = activeActions.map(a => `${a.getClip().name}: ${a.getEffectiveWeight().toFixed(2)}`)
          console.log(`✓ Active (${activeActions.length}):`, actionInfo, `| Base weight: ${baseLayerWeight.toFixed(2)}`)
        } else {
          console.error('❌ NO ACTIONS RUNNING - Character will be in T-pose!')
        }
      }
    }
  })

  useEffect(() => {
    return () => {
      if (animatorRef.current) {
        animatorRef.current.dispose()
      }
    }
  }, [])

  return (
    <group position={position}>
      <HumanoidModel onLoaded={handleModelLoaded} scale={1.5} />
    </group>
  )
}

export default function AnimationMixerDemo() {
  const [animator, setAnimator] = useState<Animator | null>(null)
  const [currentState, setCurrentState] = useState<{ base: string; upper: string }>({ 
    base: 'Locomotion', 
    upper: 'Idle' 
  })
  const [params, setParams] = useState({
    speedX: 0,
    speedY: 0,
    grounded: true,
    crouch: false,
    upperBodyWeight: 1
  })

  // Update state display
  useEffect(() => {
    if (!animator) return
    
    const interval = setInterval(() => {
      // In a real implementation, we'd expose getCurrentState() from Animator
      // For now, we'll just track based on parameters
      setCurrentState(prev => prev)
    }, 100)
    
    return () => clearInterval(interval)
  }, [animator])

  const handleParamChange = useCallback((param: string, value: number | boolean) => {
    if (!animator) return
    
    console.log(`Setting ${param} = ${value}`)
    setParams(prev => ({ ...prev, [param]: value }))
    animator.set(param, value)
  }, [animator])

  const handleTrigger = useCallback((triggerName: string) => {
    if (!animator) return
    animator.trigger(triggerName)
  }, [animator])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!animator) return
      
      // Don't trigger if typing in input
      if (e.target instanceof HTMLInputElement) return
      
      const key = e.key.toLowerCase()
      
      // Forward movement: W or ArrowUp (walk by default, sprint with Shift)
      if (key === 'w' || key === 'arrowup') {
        const speed = e.shiftKey ? 1.0 : 0.5  // Sprint vs Walk
        handleParamChange('speedY', speed)
        console.log(`Moving forward at speed ${speed} (${e.shiftKey ? 'Sprint' : 'Walk'})`)
      }
      // Backward movement: S or ArrowDown
      else if (key === 's' || key === 'arrowdown') {
        handleParamChange('speedY', -0.5)  // Backward walk speed
      }
      // Left strafe: A or ArrowLeft
      else if (key === 'a' || key === 'arrowleft') {
        handleParamChange('speedX', -1)
      }
      // Right strafe: D or ArrowRight
      else if (key === 'd' || key === 'arrowright') {
        handleParamChange('speedX', 1)
      }
      // Jump: Space
      else if (key === ' ') {
        e.preventDefault()
        console.log('🦘 Jump key pressed! Current params:', {
          grounded: animator.get('grounded'),
          speedY: animator.get('speedY'),
          jump: animator.get('jump')
        })
        handleTrigger('jump')
        console.log('🦘 Jump trigger set! Params after trigger:', {
          grounded: animator.get('grounded'),
          jump: animator.get('jump')
        })
        // Simulate jump physics - delay grounded=false to allow transition to check trigger first
        setTimeout(() => {
          handleParamChange('grounded', false)
          console.log('🦘 Now leaving ground')
        }, 50) // Small delay to let transition fire
        setTimeout(() => {
          handleParamChange('grounded', true)
          console.log('🦘 Landing')
        }, 850)
      }
      // Crouch: C
      else if (key === 'c') {
        handleParamChange('crouch', !params.crouch)
      }
      // Attack: F
      else if (key === 'f') {
        console.log('👊 Attack key pressed! Current params:', {
          attack: animator.get('attack')
        })
        handleTrigger('attack')
        console.log('👊 Attack trigger set! Params after trigger:', {
          attack: animator.get('attack')
        })
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!animator) return
      
      const key = e.key.toLowerCase()
      
      // Stop forward/backward: W, S, ArrowUp, ArrowDown
      if (key === 'w' || key === 's' || key === 'arrowup' || key === 'arrowdown') {
        handleParamChange('speedY', 0)
      }
      // Stop strafe: A, D, ArrowLeft, ArrowRight
      else if (key === 'a' || key === 'd' || key === 'arrowleft' || key === 'arrowright') {
        handleParamChange('speedX', 0)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [animator, params.crouch, handleParamChange, handleTrigger])

  return (
    <div className="w-full h-screen relative">
      {/* 3D Scene */}
      <Canvas camera={{ position: [5, 3, 8], fov: 50 }}>
        <color attach="background" args={['#0f0f23']} />
        
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
        <pointLight position={[-10, 5, -5]} intensity={0.3} color="#4488ff" />
        <pointLight position={[10, 5, 5]} intensity={0.3} color="#ff8844" />

        <Environment preset="night" />
        
        <Grid
          args={[30, 30]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1a1a3e"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#2a2a5e"
          fadeDistance={30}
          fadeStrength={1}
          position={[0, 0, 0]}
        />

        <AnimatedCharacter 
          position={[0, 0, 0]} 
          onAnimatorReady={setAnimator}
        />

        {/* State visualization - Idle at center, Moving states around it */}
        <group position={[0, 0.01, 0]}>
          {/* Current position indicator */}
          <mesh position={[params.speedX * 2, 0, -params.speedY * 2]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 16]} />
            <meshBasicMaterial color="#00ff88" transparent opacity={0.8} />
          </mesh>
          
          {/* Center - Idle (orange, larger) */}
          <mesh position={[0, 0, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.04, 8]} />
            <meshBasicMaterial color="#ffaa00" transparent opacity={0.7} />
          </mesh>
          
          {/* Forward axis - Walk → Jog → Sprint */}
          <mesh position={[0, 0, -0.1 * 2]}><cylinderGeometry args={[0.04, 0.04, 0.02, 8]} /><meshBasicMaterial color="#4488ff" transparent opacity={0.5} /></mesh>
          <mesh position={[0, 0, -0.35 * 2]}><cylinderGeometry args={[0.04, 0.04, 0.02, 8]} /><meshBasicMaterial color="#4488ff" transparent opacity={0.5} /></mesh>
          <mesh position={[0, 0, -0.6 * 2]}><cylinderGeometry args={[0.05, 0.05, 0.02, 8]} /><meshBasicMaterial color="#6688ff" transparent opacity={0.6} /></mesh>
          <mesh position={[0, 0, -0.85 * 2]}><cylinderGeometry args={[0.05, 0.05, 0.02, 8]} /><meshBasicMaterial color="#6688ff" transparent opacity={0.6} /></mesh>
          <mesh position={[0, 0, -1 * 2]}><cylinderGeometry args={[0.06, 0.06, 0.02, 8]} /><meshBasicMaterial color="#0066ff" transparent opacity={0.7} /></mesh>
          
          {/* Backward axis (red) - Walk samples close to origin */}
          <mesh position={[0, 0, 0.1 * 2]}><cylinderGeometry args={[0.04, 0.04, 0.02, 8]} /><meshBasicMaterial color="#ff4488" transparent opacity={0.5} /></mesh>
          <mesh position={[0, 0, 0.5 * 2]}><cylinderGeometry args={[0.05, 0.05, 0.02, 8]} /><meshBasicMaterial color="#ff4488" transparent opacity={0.5} /></mesh>
          <mesh position={[0, 0, 1 * 2]}><cylinderGeometry args={[0.06, 0.06, 0.02, 8]} /><meshBasicMaterial color="#ff0044" transparent opacity={0.7} /></mesh>
        </group>

        <OrbitControls
          makeDefault
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2.2}
          target={[0, 1, 0]}
        />
      </Canvas>

      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 pointer-events-none z-10">
        <div className="max-w-7xl mx-auto">
          <div className="bg-black/90 backdrop-blur-sm rounded-lg p-4 pointer-events-auto border border-blue-500/30">
            <h1 className="text-2xl font-bold text-white mb-1">
              Animation State Machine Demo
            </h1>
            <p className="text-gray-400 text-sm">
              State-based animation: Idle state with smooth transitions to Walk → Sprint blend space with speed scaling | Professional studio approach
            </p>
          </div>
        </div>
      </div>

      {/* Controls Panel */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-3 gap-4">
          
          {/* Parameters */}
          <div className="bg-black/90 backdrop-blur-sm rounded-lg p-4 pointer-events-auto border border-blue-500/30">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-blue-400">⚙️</span> Parameters
            </h2>
            
            <div className="space-y-3">
              <div>
                <label htmlFor="speedX-slider" className="text-sm text-gray-400 block mb-1">
                  Speed X (Strafe): {params.speedX.toFixed(2)}
                </label>
                <input
                  id="speedX-slider"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={params.speedX}
                  onChange={(e) => handleParamChange('speedX', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
              
              <div>
                <label htmlFor="speedY-slider" className="text-sm text-gray-400 block mb-1">
                  Speed Y (Forward): {params.speedY.toFixed(2)}
                </label>
                <input
                  id="speedY-slider"
                  type="range"
                  min="-1"
                  max="1"
                  step="0.1"
                  value={params.speedY}
                  onChange={(e) => handleParamChange('speedY', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
              </div>
              
              <div>
                <label htmlFor="upperBodyWeight-slider" className="text-sm text-gray-400 block mb-1">
                  Upper Body Weight: {params.upperBodyWeight.toFixed(2)}
                </label>
                <input
                  id="upperBodyWeight-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={params.upperBodyWeight}
                  onChange={(e) => handleParamChange('upperBodyWeight', parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                />
              </div>
              
              <div className="flex gap-2 pt-2">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={params.grounded}
                    onChange={(e) => handleParamChange('grounded', e.target.checked)}
                    className="w-4 h-4 accent-blue-500"
                  />
                  Grounded
                </label>
                
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={params.crouch}
                    onChange={(e) => handleParamChange('crouch', e.target.checked)}
                    className="w-4 h-4 accent-blue-500"
                  />
                  Crouch
                </label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-black/90 backdrop-blur-sm rounded-lg p-4 pointer-events-auto border border-green-500/30">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-green-400">⚡</span> Triggers
            </h2>
            
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  handleTrigger('jump')
                  handleParamChange('grounded', false)
                  setTimeout(() => handleParamChange('grounded', true), 800)
                }}
                disabled={!params.grounded}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded font-medium transition-colors"
              >
                🦘 Jump <kbd className="ml-2 text-xs bg-black/30 px-2 py-1 rounded">Space</kbd>
              </button>
              
              <button
                type="button"
                onClick={() => handleTrigger('attack')}
                className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors"
              >
                👊 Attack <kbd className="ml-2 text-xs bg-black/30 px-2 py-1 rounded">F</kbd>
              </button>
              
              <div className="pt-2 border-t border-gray-700">
                <p className="text-xs text-gray-500 italic">
                  Triggers fire once and auto-reset
                </p>
              </div>
            </div>
          </div>

          {/* State Info */}
          <div className="bg-black/90 backdrop-blur-sm rounded-lg p-4 pointer-events-auto border border-purple-500/30">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-purple-400">📊</span> Current States
            </h2>
            
            <div className="space-y-3">
              <div>
                <div className="text-xs text-gray-400 mb-1">Base Layer</div>
                <div className="px-3 py-2 bg-purple-900/30 border border-purple-500/50 rounded text-purple-300 font-mono text-sm">
                  {currentState.base}
                </div>
              </div>
              
              <div>
                <div className="text-xs text-gray-400 mb-1">Upper Body Layer</div>
                <div className="px-3 py-2 bg-purple-900/30 border border-purple-500/50 rounded text-purple-300 font-mono text-sm">
                  {currentState.upper}
                </div>
              </div>
              
              <div className="pt-2 border-t border-gray-700">
                <div className="text-xs text-gray-400 mb-2">Active Features:</div>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-gray-300">State Machine (Idle/Moving)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-gray-300">Smooth Transitions (0.15-0.2s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-gray-300">Upper Body Masking</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-gray-300">Shepard RBF Blending</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Help */}
      <div className="absolute top-24 right-4 pointer-events-none z-10">
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 text-white pointer-events-auto border border-gray-700">
          <h3 className="font-semibold text-sm mb-2">⌨️ Keyboard Controls</h3>
          <div className="text-xs text-gray-300 space-y-1">
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">W/↑</kbd> Walk</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">Shift+W</kbd> Sprint</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">S/↓</kbd> Backward</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">A/←</kbd> Strafe Left</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">D/→</kbd> Strafe Right</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">Space</kbd> Jump</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">C</kbd> Crouch</div>
            <div><kbd className="font-mono bg-gray-700 px-2 py-0.5 rounded">F</kbd> Attack</div>
          </div>
        </div>
      </div>

      {/* State Machine Visualization */}
      <div className="absolute top-24 left-4 pointer-events-none z-10">
        <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 border border-blue-500/30 pointer-events-auto">
          <h3 className="font-semibold text-sm text-white mb-2">Animation States</h3>
          <div className="relative w-32 h-32 bg-gray-900 rounded border border-gray-700">
            {/* Vertical line for 1D blend */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-blue-500/30" />
            
            {/* Blend space samples - 17 total (Idle + 10 forward + 6 backward) */}
            {/* Forward: Sprint speeds (0.7-1.0) */}
            <div className="absolute left-1/2 top-2 w-2 h-2 -ml-1 rounded-full bg-[#0066ff]" title="Sprint (1.0)" />
            <div className="absolute left-1/2 top-[8%] w-1 h-1 -ml-0.5 rounded-full bg-[#3388ff]" title="Sprint (0.9)" />
            <div className="absolute left-1/2 top-[14%] w-1 h-1 -ml-0.5 rounded-full bg-[#3388ff]" title="Sprint (0.8)" />
            <div className="absolute left-1/2 top-[20%] w-1 h-1 -ml-0.5 rounded-full bg-[#5599ff]" title="Sprint (0.7)" />
            {/* Forward: Walk speeds (0.1-0.6) */}
            <div className="absolute left-1/2 top-[26%] w-1 h-1 -ml-0.5 rounded-full bg-[#4488ff]" title="Walk (0.6)" />
            <div className="absolute left-1/2 top-[32%] w-1 h-1 -ml-0.5 rounded-full bg-[#4488ff]" title="Walk (0.5)" />
            <div className="absolute left-1/2 top-[38%] w-1 h-1 -ml-0.5 rounded-full bg-[#4488ff]" title="Walk (0.4)" />
            <div className="absolute left-1/2 top-[44%] w-1 h-1 -ml-0.5 rounded-full bg-[#5599ff]" title="Walk (0.3)" />
            <div className="absolute left-1/2 top-[47%] w-1 h-1 -ml-0.5 rounded-full bg-[#6699ff]" title="Walk (0.2)" />
            <div className="absolute left-1/2 top-[49%] w-1 h-1 -ml-0.5 rounded-full bg-[#7799ff]" title="Walk (0.1)" />
            {/* Center: Idle */}
            <div className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 rounded-full bg-[#ffaa00]" title="Idle (0.0)" />
            {/* Backward: Walk speeds (-0.1 to -0.6, matching forward granularity) */}
            <div className="absolute left-1/2 bottom-[49%] w-1 h-1 -ml-0.5 rounded-full bg-[#ff7799]" title="Walk (-0.1)" />
            <div className="absolute left-1/2 bottom-[47%] w-1 h-1 -ml-0.5 rounded-full bg-[#ff6699]" title="Walk (-0.2)" />
            <div className="absolute left-1/2 bottom-[44%] w-1 h-1 -ml-0.5 rounded-full bg-[#ff5599]" title="Walk (-0.3)" />
            <div className="absolute left-1/2 bottom-[38%] w-1 h-1 -ml-0.5 rounded-full bg-[#ff4488]" title="Walk (-0.4)" />
            <div className="absolute left-1/2 bottom-[32%] w-1 h-1 -ml-0.5 rounded-full bg-[#ff3377]" title="Walk (-0.5)" />
            <div className="absolute left-1/2 bottom-[26%] w-1 h-1 -ml-0.5 rounded-full bg-[#ff2266]" title="Walk (-0.6)" />
            
            {/* Current position */}
            <div 
              className="absolute left-1/2 w-3 h-3 bg-green-400 rounded-full border-2 border-white shadow-lg transition-all duration-150"
              style={{
                top: `${((1 - params.speedY) / 2) * 100}%`,
                transform: 'translate(-50%, -50%)'
              }}
            />
            
            {/* Labels */}
            <div className="absolute left-1/2 -top-6 -translate-x-1/2 text-[10px] text-gray-500">+1.0</div>
            <div className="absolute left-1/2 -bottom-6 -translate-x-1/2 text-[10px] text-gray-500">-1.0</div>
            <div className="absolute left-1/2 top-1/2 -translate-y-1/2 -right-10 text-[10px] text-gray-500">Idle</div>
          </div>
          <p className="text-[10px] text-gray-500 mt-2 italic">States: Idle center, Moving with speed scaling</p>
          <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
            <div className="flex items-center gap-1 text-[9px]">
              <div className="w-2 h-2 rounded-full bg-[#ffaa00]" />
              <span className="text-gray-400">Idle State</span>
            </div>
            <div className="flex items-center gap-1 text-[9px]">
              <div className="w-2 h-2 rounded-full bg-[#4488ff]" />
              <span className="text-gray-400">Walk (0.1-0.6)</span>
            </div>
            <div className="flex items-center gap-1 text-[9px]">
              <div className="w-2 h-2 rounded-full bg-[#0066ff]" />
              <span className="text-gray-400">Sprint (0.7-1.0)</span>
            </div>
            <div className="flex items-center gap-1 text-[9px]">
              <div className="w-2 h-2 rounded-full bg-[#ff4488]" />
              <span className="text-gray-400">Backward (0.1-0.6)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Preload the model
useGLTF.preload('/models/AnimationLibrary_Godot_Standard-transformed.glb')
