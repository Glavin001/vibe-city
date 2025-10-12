'use client'

import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { BUILDINGS, NODE_POS, N } from '../../lib/bunker-world'
import { Ground, Building } from '../../lib/bunker-scene'
import { PlayerKCC } from '../../components/physics/PlayerKCC'
import { BuildingColliders } from '../../components/physics/BuildingColliders'
import { GroundPhysics } from '../../components/physics/GroundPhysics'

type Controls = 'forward' | 'backward' | 'left' | 'right' | 'jump' | 'run'

function Scene() {
  const [isLocked, setIsLocked] = useState(false)
  // Place capsule center at 0.9m so feet touch ground (y=0) with realistic 1.8m tall human
  const spawn: [number, number, number] = useMemo(() => [NODE_POS[N.COURTYARD][0], 0.9, NODE_POS[N.COURTYARD][2]], [])
  return (
    <div className="w-full h-[80vh] bg-black rounded-lg overflow-hidden relative">
      <KeyboardControls
        map={[
          { name: 'forward' as Controls, keys: ['ArrowUp', 'w', 'W'] },
          { name: 'backward' as Controls, keys: ['ArrowDown', 's', 'S'] },
          { name: 'left' as Controls, keys: ['ArrowLeft', 'a', 'A'] },
          { name: 'right' as Controls, keys: ['ArrowRight', 'd', 'D'] },
          { name: 'jump' as Controls, keys: ['Space'] },
          { name: 'run' as Controls, keys: ['Shift'] },
        ]}
      >
        <Canvas shadows camera={{ fov: 75 }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[10, 20, 10]} intensity={0.9} castShadow />
          <Physics>
            {/* Physics ground */}
            <GroundPhysics />
            
            {/* Building colliders (simple 4-wall boxes) */}
            <BuildingColliders config={BUILDINGS.STORAGE} />
            <BuildingColliders config={BUILDINGS.BUNKER} />

            {/* Visual ground */}
            <Ground />
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Buildings visuals */}
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

            {/* Player with kinematic character controller */}
            <PlayerKCC start={spawn} />
          </Physics>
          <PointerLockControls makeDefault onLock={() => setIsLocked(true)} onUnlock={() => setIsLocked(false)} selector="#startPointerLockRapier" />
        </Canvas>
      </KeyboardControls>
      <div id="startPointerLockRapier" className="absolute inset-0 select-none cursor-pointer" style={{ display: isLocked ? 'none' : 'block' }} title="Click to start (Esc to unlock)">
        <div className="pointer-events-none absolute bottom-3 right-3 text-[11px] bg-gray-900/40 text-gray-200 px-2 py-1 rounded">
          Click to start · Esc to unlock
        </div>
      </div>
      <div className="absolute left-3 bottom-3 text-gray-300 text-xs bg-gray-900/60 rounded px-2 py-1">
        WASD move · Shift run · Space jump
      </div>
    </div>
  )
}

export default function BunkerRapierPage() {
  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <h1 className="text-2xl font-bold text-white mb-2">Bunker (Rapier Physics)</h1>
      <p className="text-gray-300 mb-4">Walk around with a kinematic character; buildings have physical walls.</p>
      <Scene />
      <div className="mt-4">
        <a href="/" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">← Back to Home</a>
      </div>
      <div className="mt-3 text-xs text-gray-500">
        Physics powered by @react-three/rapier KinematicCharacterController.
      </div>
    </div>
  )
}


