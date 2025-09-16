'use client'

import { Suspense, useMemo, useRef, useState, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, StatsGl, Text } from '@react-three/drei'
import { Physics, RigidBody, HeightfieldCollider, BallCollider } from '@react-three/rapier'
import type { CollisionEnterPayload, RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'

// Configure collider refresh in terms of FPS for clarity
// const colliderFps = 12.5
const colliderFps = 60

/**
 * CRATER TUNING — adjust these to control crater size/depth
 */
const CRATER_RADIUS_MULTIPLIER = 10.0
const CRATER_RADIUS_MIN = 1.25
const CRATER_DEPTH_MULTIPLIER = 3
const CRATER_DEPTH_MIN = 0.22

type CraterConfig = {
  craterRadiusWorld: number
  craterDepthWorld: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Smoothstep used to soften crater edges
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function CraterHeightfieldScene() {
  // Grid/scale config
  const widthQuads = 60
  const depthQuads = 60
  const rows = depthQuads + 1
  const cols = widthQuads + 1
  const scaleX = 50
  const scaleY = 4
  const scaleZ = 50

  // Heights storage (row-major, size rows*cols). Start completely flat at 0.
  const heightsRef = useRef<Float32Array>(new Float32Array(rows * cols))

  // Snapshot for collider and key to force remount
  const [colliderHeights, setColliderHeights] = useState<number[]>(() => Array.from({ length: rows * cols }, () => 0))
  const [colliderKey, setColliderKey] = useState(0)

  // Geometry aligned to Rapier heightfield orientation
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(scaleX, scaleZ, cols - 1, rows - 1)
    // Align to Rapier heightfield orientation (same approach as dynamic demo)
    geo.scale(1, -1, 1)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(-Math.PI / 2)
    geo.computeVertexNormals()
    return geo
  }, [rows, cols])

  // Precompute world-space grid sample positions for efficient cratering
  const sampleWorldX = useMemo(() => {
    const arr = new Float32Array(cols)
    for (let c = 0; c < cols; c++) {
      arr[c] = (c / (cols - 1) - 0.5) * scaleX
    }
    return arr
  }, [cols])

  const sampleWorldZ = useMemo(() => {
    const arr = new Float32Array(rows)
    for (let r = 0; r < rows; r++) {
      arr[r] = (r / (rows - 1) - 0.5) * scaleZ
    }
    return arr
  }, [rows])

  // Crater application flag + timer for throttled collider rebuild
  const needsColliderUpdateRef = useRef(false)
  const colliderTimerRef = useRef(0)

  const applyCraterAt = useCallback((worldPos: THREE.Vector3, config: CraterConfig) => {
    const { craterRadiusWorld, craterDepthWorld } = config
    const heights = heightsRef.current
    const radius = craterRadiusWorld
    const depthUnits = craterDepthWorld / scaleY // convert world Y to height units

    // IMPORTANT: Z and X are swapped here to match Rapier orientation
    const cx = worldPos.z
    const cz = worldPos.x

    // Affect entire grid (small enough). Optimize by bounding box if needed.
    for (let r = 0; r < rows; r++) {
      const z = sampleWorldZ[r]
      const dz = z - cz
      // Quick reject by Z distance
      if (Math.abs(dz) > radius) continue
      for (let c = 0; c < cols; c++) {
        const x = sampleWorldX[c]
        const dx = x - cx
        const d = Math.hypot(dx, dz)
        if (d > radius) continue
        const t = 1 - d / radius
        const falloff = smoothstep(0, 1, t) // 0..1
        const i = r * cols + c
        heights[i] = heights[i] - falloff * depthUnits
      }
    }

    // Mark collider and normals update
    needsColliderUpdateRef.current = true
  }, [sampleWorldX, sampleWorldZ, rows, cols])

  // Visual update + throttled normals/collider refresh
  useFrame((_, delta) => {
    const heights = heightsRef.current

    // Update visual mesh (local Y corresponds to world up after geometry transforms)
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      position.setY(i, heights[i] * scaleY)
    }
    position.needsUpdate = true

    // Throttle expensive operations (normals + collider rebuild)
    colliderTimerRef.current += delta
    const refreshInterval = 1 / colliderFps
    if (needsColliderUpdateRef.current && colliderTimerRef.current >= refreshInterval) {
      geometry.computeVertexNormals()
      setColliderHeights(Array.from(heights))
      setColliderKey((k) => k + 1)
      needsColliderUpdateRef.current = false
      colliderTimerRef.current = 0
    }
  })

  return (
    <>
      {/* Ground heightfield (physics + visual) */}
      <RigidBody
        type="fixed"
        position={[0, 0, 0]}
        colliders={false}
        name="CraterTerrain"
        friction={1}
        restitution={0.05}
        density={1}
      >
        <HeightfieldCollider
          key={colliderKey}
          args={[widthQuads, depthQuads, colliderHeights, { x: scaleX, y: scaleY, z: scaleZ }]}
        />
        <mesh
            geometry={geometry}
            receiveShadow
            // Found experimentally to align with Rapier orientation in dynamic demo
            scale={[scaleX / scaleZ, 1, scaleZ / scaleX]}
        >
            <meshLambertMaterial color="#5a8f62" side={2} />
        </mesh>
      </RigidBody>


      {/* Falling meteors */}
      <FallingMeteors
        groundName="CraterTerrain"
        spawnWidth={scaleX}
        spawnDepth={scaleZ}
        spawnHeight={14}
        numMeteors={10}
        radius={0.35}
        onImpact={(pos, radius) => {
          // Map meteor size to crater size/depth using tuning constants
          const craterRadiusWorld = Math.max(CRATER_RADIUS_MIN, radius * CRATER_RADIUS_MULTIPLIER)
          const craterDepthWorld = Math.max(CRATER_DEPTH_MIN, radius * CRATER_DEPTH_MULTIPLIER)
          applyCraterAt(pos, { craterRadiusWorld, craterDepthWorld })
        }}
      />

      {/* UI */}
      <Text
        position={[0, 8, 0]}
        fontSize={0.7}
        color="#222"
        anchorX="center"
        anchorY="middle"
      >
        Meteors dent the ground and it deteriorates over time
      </Text>
    </>
  )
}

function FallingMeteors({
  groundName,
  spawnWidth,
  spawnDepth,
  spawnHeight = 12,
  numMeteors = 20,
  radius = 0.3,
  onImpact,
}: {
  groundName: string
  spawnWidth: number
  spawnDepth: number
  spawnHeight?: number
  numMeteors?: number
  radius?: number
  onImpact: (position: THREE.Vector3, radius: number) => void
}) {
  const bodyRefs = useRef<Map<number, RapierRigidBody | null>>(new Map())
  const processingIdsRef = useRef<Set<number>>(new Set())
  const objectIdRef = useRef(0)

  const randomSpawnPosition = useCallback((): [number, number, number] => {
    const x = (Math.random() - 0.5) * spawnWidth
    const z = (Math.random() - 0.5) * spawnDepth
    const y = spawnHeight + Math.random() * 6
    // const x = (-0.1) * spawnWidth
    // const z = (-0.0) * spawnDepth
    // const y = spawnHeight + 0 * 6
    return [x, y, z]
  }, [spawnWidth, spawnDepth, spawnHeight])

  type Meteor = { id: number, color: string, position: THREE.Vector3 }

  const [meteors] = useState<Array<Meteor>>(() => {
    const next: Array<Meteor> = []
    for (let i = 0; i < numMeteors; i++) {
      const id = ++objectIdRef.current
      const color = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7'][Math.floor(Math.random() * 7)]
      const position = new THREE.Vector3(...randomSpawnPosition())
      next.push({ id, color, position })
    }
    return next
  })

  const recycleBody = useCallback((id: number) => {
    const rb = bodyRefs.current.get(id)
    if (!rb) return
    const [x, y, z] = randomSpawnPosition()
    try {
      rb.setTranslation({ x, y, z }, true)
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true)
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true)
      rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
    } catch {}
    setTimeout(() => {
      processingIdsRef.current.delete(id)
    }, 10)
  }, [randomSpawnPosition])

  const handleCollisionEnter = useCallback((id: number, event: CollisionEnterPayload) => {
    if (processingIdsRef.current.has(id)) return
    // Only process impacts with the ground
    const otherName = event.other?.rigidBodyObject?.name
    if (otherName !== groundName) return

    processingIdsRef.current.add(id)
    const t = event.target.rigidBody ? event.target.rigidBody.translation() : undefined
    if (!t) return
    const pos = new THREE.Vector3(t.x, t.y, t.z)
    onImpact(pos, radius)
    recycleBody(id)
  }, [groundName, onImpact, radius, recycleBody])

  return (
    <>
      {meteors.map((m) => (
        <RigidBody
          key={m.id}
          type="dynamic"
          position={m.position}
          colliders={false}
          canSleep={false}
          ref={(rb) => {
            bodyRefs.current.set(m.id, rb as unknown as RapierRigidBody)
            if (rb) {
              try {
                rb.setLinvel({ x: 0, y: 0, z: 0 }, true)
                rb.setAngvel({ x: 0, y: 0, z: 0 }, true)
                rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
              } catch {}
            }
          }}
          onCollisionEnter={(event) => handleCollisionEnter(m.id, event)}
          name={`Meteor-${m.id}`}
          friction={1}
          restitution={0.05}
          density={1}
        >
          <BallCollider args={[radius]} />
          <mesh castShadow>
            <sphereGeometry args={[radius, 16, 16]} />
            <meshStandardMaterial color={m.color} />
          </mesh>
        </RigidBody>
      ))}
    </>
  )
}

export default function CraterHeightfieldDemo() {
  return (
    <div className="w-full h-[100vh] bg-gradient-to-b from-emerald-500 to-teal-300 rounded-lg overflow-hidden relative">
      <Canvas shadows camera={{ position: [10, 10, 12], fov: 55 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[12, 16, 6]}
            intensity={1}
            castShadow
            shadow-mapSize-width={1024}
            shadow-mapSize-height={1024}
          />

          <Physics gravity={[0, -9.81, 0]} debug={false}>
            <CraterHeightfieldScene />
          </Physics>

          <OrbitControls enablePan enableZoom enableRotate />
          <StatsGl className="absolute top-80 left-10" />
        </Suspense>
      </Canvas>

      <div className="absolute top-4 left-4 bg-black/80 text-white p-4 rounded-lg backdrop-blur-sm max-w-sm">
        <h3 className="text-lg font-bold mb-2">Crumbling Heightfield</h3>
        <div className="text-sm space-y-1">
          <p>• Start flat; meteors dent the ground on impact</p>
          <p>• Visual mesh and physics collider update together</p>
          <p>• Collider refresh throttled at {colliderFps} FPS</p>
        </div>
      </div>
    </div>
  )
}


