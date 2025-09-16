'use client'

import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, StatsGl } from '@react-three/drei'
import { Physics, RigidBody, HeightfieldCollider, BallCollider } from '@react-three/rapier'
import * as THREE from 'three'

function generateTargetHeight(row: number, col: number, time: number, rows: number, cols: number): number {
  // Bowl baseline: higher near the edges, lower at center.
  const cx = (cols - 1) * 0.5
  const cz = (rows - 1) * 0.5
  const dx = (col - cx) / cx
  const dz = (row - cz) / cz
  const r = Math.sqrt(dx * dx + dz * dz) // 0 at center, ~1 at corners

  // Quadratic bowl height (clamped to [0,1])
  const bowl = Math.min(1, Math.max(0, r * r))

  // Turbulent, time-varying motion strongest near the center, fading to the rim
  const centerFalloff = 1 - Math.min(1, r)
  const t = time

  // Multi-octave trigs for a noise-like effect (fBm-style)
  const f1 = Math.sin((dx * 6 + dz * 6) + t * 2.2)
  const f2 = Math.cos((dx * 12 - dz * 8) - t * 3.1)
  const f3 = Math.sin((dx * 24 + dz * 18) + t * 4.0) * 0.6
  const f4 = Math.cos((dx * 40 - dz * 32) - t * 5.3) * 0.35
  let turbulence = f1 * 0.8 + f2 * 0.6 + f3 * 0.45 + f4 * 0.3

  // Shape to emphasize high highs and low lows
  turbulence = Math.sign(turbulence) * Math.pow(Math.abs(turbulence), 1.6)

  // Stronger amplitude near center, taper to the rim
  const amplitude = 1.4
  const ripples = centerFalloff * amplitude * turbulence

  // Enforce rim dominance: the bowl rim (r≈1) must be the tallest.
  // Cap interior heights below the rim by a radius-weighted margin.
  const rimDominanceMargin = 0.08 // 8% below rim at center, fades to 0% at rim
  const cap = 1 - rimDominanceMargin * centerFalloff // cap=1 at rim, 1-margin at center
  const unclamped = bowl + ripples
  const clamped = Math.min(unclamped, cap)

  // Keep non-negative to avoid terrain below floor
  return Math.max(0, clamped)

  // FOR DEBUGGING:
  /*
  // Make a spiky, obvious shape for debugging: tall spikes at every 5th row/col, animated over time
  if ((row % 5 === 0) && (col % 5 === 0)) {
    // Animate spike height with a sine wave for time-varying effect
    return 2.5 + Math.sin(time * 2 + row * 0.5 + col * 0.5) * 1.5
  }
  return 0
  */
}

function DynamicTerrain({ widthQuads, depthQuads, scaleX, scaleY, scaleZ }: { widthQuads: number, depthQuads: number, scaleX: number, scaleY: number, scaleZ: number }) {
  const rows = depthQuads + 1
  const cols = widthQuads + 1

  // Internal continuous height state (mutated each frame)
  const heightsRef = useRef<Float32Array>(new Float32Array(rows * cols))

  // Snapshot for the collider (updated at a lower rate with a key to force remount)
  const [colliderHeights, setColliderHeights] = useState<number[]>(() => Array.from({ length: rows * cols }, () => 0))
  const [colliderKey, setColliderKey] = useState(0)

  const geometry = useMemo(() => {
    // Keep geometry unrotated; we'll apply orientation on the mesh.
    const geo = new THREE.PlaneGeometry(scaleX, scaleZ, cols - 1, rows - 1)
    // Align to Rapier heightfield orientation
    geo.scale(1, -1, 1)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(-Math.PI / 2)
    geo.computeVertexNormals()
    return geo
  }, [rows, cols, scaleX, scaleZ])

  const timeRef = useRef(0)
  const colliderTimerRef = useRef(0)

  useFrame((_, delta) => {
    timeRef.current += delta
    colliderTimerRef.current += delta

    // Smoothly update heights toward a moving target height field
    const heights = heightsRef.current
    const alpha = Math.min(1, delta * 1.5) // smoothing factor per frame
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const target = generateTargetHeight(r, c, timeRef.current, rows, cols)
        const current = heights[i]
        const next = current + (target - current) * alpha
        heights[i] = next
      }
    }

    // Update visual mesh Z positions (local +Z maps to world +Y after rotation)
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      // position.setZ(i, heights[i] * scaleY)
      position.setY(i, heights[i] * scaleY)
    }
    position.needsUpdate = true

    // Throttle expensive operations (normals + collider rebuild)
    const refreshPhysicsFps = 60;
    if (colliderTimerRef.current >= 1/refreshPhysicsFps) {
      // Align to Rapier heightfield orientation
      geometry.computeVertexNormals()

      setColliderHeights(Array.from(heights))
      setColliderKey((k) => k + 1)
      colliderTimerRef.current = 0
    }
  })

  return (
    <>
      {/* Physics collider */}
      <RigidBody
        type="fixed" position={[0, 0, 0]} colliders={false} name="BowlTerrain"
        friction={1}
        restitution={0.05}
        density={1}
      >
        <HeightfieldCollider
          key={colliderKey}
          args={[widthQuads, depthQuads, colliderHeights, { x: scaleX, y: scaleY, z: scaleZ }]}
        />
        {/* Visual terrain mesh (apply orientation at the mesh level to mirror static demo) */}
      </RigidBody>
      <mesh
        geometry={geometry}
        receiveShadow
        // scale={[2, 1, 0.5]}
        // scale={[0.33, 1, 3]}
        // Found this experimentally, not sure why it works
        scale={[scaleX/scaleZ, 1, scaleZ/scaleX]}
        // scale={[scaleY/20, scaleX/20, scaleZ/20]}
        // rotation={[0, Math.PI / 2, 0]}
      >
        <meshLambertMaterial color="#4a7c59" side={2} />
      </mesh>

      {/* Rolling ball */}
      <RigidBody
        type="dynamic"
        position={[0, 8, 0]}
        colliders={false}
        canSleep={false}
        linearDamping={0.05}
        angularDamping={0.05}
        name="Ball"
        friction={1}
        restitution={0.05}
        density={1}
        // ccd={true}
      >
        <BallCollider args={[0.6]} friction={1} restitution={0.05} density={1} />
        <mesh castShadow>
          <sphereGeometry args={[0.6, 24, 24]} />
          <meshStandardMaterial color="#ffcc00" metalness={0.2} roughness={0.6} />
        </mesh>
      </RigidBody>

    </>
  )
}

export default function DynamicHeightfieldDemo() {
  const widthQuads = 60
  const depthQuads = 60
  const scaleX = 50
  const scaleY = 4
  const scaleZ = 50

  return (
    <div className="w-full h-[80vh] bg-gradient-to-b from-indigo-500 to-sky-300 rounded-lg overflow-hidden relative">
      <Canvas shadows camera={{ position: [10, 8, 10], fov: 55 }}>
        <Suspense fallback={null}>
            <ambientLight intensity={0.5} />
            <directionalLight
              position={[12, 12, 6]}
              intensity={1}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
            />

            <Physics gravity={[0, -9.81, 0]} debug>
                <DynamicTerrain widthQuads={widthQuads} depthQuads={depthQuads} scaleX={scaleX} scaleY={scaleY} scaleZ={scaleZ} />
            </Physics>

            <OrbitControls enablePan enableZoom enableRotate />

            <StatsGl className="absolute top-80 left-10" />
        </Suspense>
      </Canvas>

      <div className="absolute top-4 left-4 bg-black/80 text-white p-4 rounded-lg backdrop-blur-sm max-w-sm">
        <h3 className="text-lg font-bold mb-2">Dynamic Heightfield</h3>
        <div className="text-sm space-y-1">
          <p>• Surface morphs over time using a simple noise function</p>
          <p>• Physics collider updates at a throttled rate</p>
          <p>• Visual mesh updates every frame</p>
        </div>
      </div>
    </div>
  )
}


