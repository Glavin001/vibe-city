'use client'

import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Grid, OrbitControls } from '@react-three/drei'
import type { Blueprint, Catalog } from '../../types/assembly'
import { BlueprintScene, type BlueprintRuntimeApi } from './BlueprintScene'

export interface BlueprintCanvasProps {
  blueprint: Blueprint
  catalog: Catalog
  selectedPartId?: string | null
  selectedJointId?: string | null
  onSelectPart?: (id: string | null) => void
  onSelectJoint?: (id: string | null) => void
  onRuntimeReady?: (runtime: BlueprintRuntimeApi | null) => void
  showSockets?: boolean
  showJointDebug?: boolean
  variantKey?: string
}

export const BlueprintCanvas = ({
  blueprint,
  catalog,
  selectedPartId,
  selectedJointId,
  onSelectPart,
  onSelectJoint,
  onRuntimeReady,
  showSockets,
  showJointDebug,
  variantKey,
}: BlueprintCanvasProps) => {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [9, 7, 9], fov: 45 }}
      onPointerMissed={() => {
        onSelectPart?.(null)
        onSelectJoint?.(null)
      }}
    >
      <color attach="background" args={['#04060a']} />
      <fog attach="fog" args={['#04060a', 35, 120]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 16, 12]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]} timeStep="vary">
          <BlueprintScene
            blueprint={blueprint}
            catalog={catalog}
            selectedPartId={selectedPartId}
            selectedJointId={selectedJointId}
            onSelectPart={onSelectPart}
            onSelectJoint={onSelectJoint}
            onRuntimeReady={onRuntimeReady}
            showSockets={showSockets}
            showJointDebug={showJointDebug}
            variantKey={variantKey}
          />
        </Physics>
        <Grid
          args={[100, 100]}
          cellSize={1}
          sectionSize={5}
          fadeDistance={60}
          fadeStrength={1}
          infiniteGrid
        />
        <OrbitControls
          makeDefault
          target={[0, 1.2, 0]}
          maxPolarAngle={Math.PI * 0.48}
          minPolarAngle={0.1}
          maxDistance={60}
          minDistance={2.4}
        />
      </Suspense>
    </Canvas>
  )
}
