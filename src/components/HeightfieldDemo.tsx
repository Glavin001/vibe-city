'use client'

import { useRef, useState, useCallback, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import { Physics, RigidBody, HeightfieldCollider, BallCollider, CuboidCollider } from '@react-three/rapier'
import type { CollisionEnterPayload, RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'

// Generate a simple heightfield with some hills and valleys
// IMPORTANT: HeightfieldCollider expects heights sized (widthQuads+1) * (depthQuads+1)
// and ordered in ROW-MAJOR layout (row * cols + col), where:
//   - widthQuads: number of quads along X (width)
//   - depthQuads: number of quads along Z (depth)
//   - cols = widthQuads + 1, rows = depthQuads + 1
// When passing args to <HeightfieldCollider /> use:
//   args={[widthQuads, depthQuads, heights, { x: scaleX, y: scaleY, z: scaleZ }]}
// Note: scale must be an object with {x,y,z}, not a THREE.Vector3.
// See: https://github.com/pmndrs/react-three-rapier/issues/730#issuecomment-2734006659
function generateHeights(rows: number, cols: number) {
  const heights = new Float32Array(rows * cols)
  const centerX = cols / 2
  const centerZ = rows / 2
  
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dx = col - centerX
      const dz = row - centerZ
      const distance = Math.sqrt(dx * dx + dz * dz)
      
      // Create some hills and valleys
      let height = 0
      height += Math.sin(col * 0.3) * 0.8
      height += Math.cos(row * 0.2) * 0.6
      height += Math.sin(distance * 0.15) * 1.2
      height = Math.max(0, height) // Keep terrain above ground level
      
      // Store in row-major order: row * cols + col
      heights[row * cols + col] = height
    }
  }
  return heights
}

// Generate terrain mesh for visualization
// rows = depthQuads + 1, cols = widthQuads + 1
function TerrainMesh({ rows, cols, heights, scaleX, scaleY, scaleZ }: { rows: number, cols: number, heights: Float32Array, scaleX: number, scaleY: number, scaleZ: number }) {
  const geometry = useMemo(() => {
    // Build plane with the same segments as the collider (cols-1 by rows-1)
    const geo = new THREE.PlaneGeometry(scaleX, scaleZ, cols - 1, rows - 1)
    const position = geo.attributes.position

    // Apply heights directly in the same flattened (row-major) order
    // We write into local Z because we'll rotate the geometry so that local +Z maps to world +Y
    for (let i = 0; i < position.count; i++) {
      position.setZ(i, heights[i] * scaleY)
    }

    // Align orientation to Rapier heightfield (same as the working simple demo):
    // 1) Flip Y so winding/normal matches
    // 2) Rotate -90° around X to lay on XZ
    // 3) Rotate -90° around Y to match X/Z indexing
    geo.scale(1, -1, 1)
    geo.rotateX(-Math.PI / 2)
    geo.rotateY(-Math.PI / 2)

    geo.computeVertexNormals()
    return geo
  }, [rows, cols, heights, scaleX, scaleY, scaleZ])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshLambertMaterial color="#4a7c59" wireframe={false} side={2} />
    </mesh>
  )
}

// Falling objects component
function FallingObjects({ onCollision, spawnWidth, spawnDepth, spawnHeight = 12, numObjects = 20 }: { onCollision: (position: THREE.Vector3) => void, spawnWidth: number, spawnDepth: number, spawnHeight?: number, numObjects?: number }) {
  // const objects = useRef<Array<{ id: number, type: 'box' | 'sphere', color: string }>>([])
  const bodyRefs = useRef<Map<number, RapierRigidBody | null>>(new Map())
  const [collisions, setCollisions] = useState<Array<{ id: number, position: THREE.Vector3, timestamp: number }>>([])
  // Guard to prevent duplicate processing for the same object across multiple contact points
  const processingIdsRef = useRef<Set<number>>(new Set())
  // Ensure strictly unique, deterministic keys across renders
  const objectIdRef = useRef(0)
  const collisionIdRef = useRef(0)

  const randomSpawnPosition = useCallback((): [number, number, number] => {
    const x = (Math.random() - 0.5) * spawnWidth
    const z = (Math.random() - 0.5) * spawnDepth
    const y = spawnHeight + Math.random() * 5
    return [x, y, z]
  }, [spawnWidth, spawnDepth, spawnHeight])

  type Object = { id: number, type: 'box' | 'sphere', color: string, position: THREE.Vector3 }
  
  const [objects] = useState<Array<Object>>(() => {
  // Initialize fixed number of objects once
    const next: Array<Object> = []
    for (let i = 0; i < numObjects; i++) {
      const id = ++objectIdRef.current
      const type = Math.random() > 0.5 ? 'box' : 'sphere'
      const color = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b', '#6c5ce7'][Math.floor(Math.random() * 7)]
      const position = new THREE.Vector3(...randomSpawnPosition())
      next.push({ id, type, color, position })
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
    // Small cooldown to avoid rapid duplicate enter events while physics settles
    setTimeout(() => {
      processingIdsRef.current.delete(id)
    }, 10)
  }, [randomSpawnPosition])

  const handleCollisionEnter = useCallback((id: number, event: CollisionEnterPayload) => {
    // Debounce multiple contact points for the same object
    if (processingIdsRef.current.has(id)) {
      return
    }
    processingIdsRef.current.add(id)
    const t = event.target.rigidBody ? event.target.rigidBody.translation() : undefined
    if (!t) {
        console.error('CollisionEnterPayload has no translation', event)
        return
    }
    const pos = new THREE.Vector3(t.x, t.y, t.z)
    console.log('handleCollisionEnter', id, t, pos, event)
    onCollision(pos)
    const collision = { id: ++collisionIdRef.current, position: pos, timestamp: Date.now() }
    setCollisions(prev => [...prev.slice(-numObjects), collision])
    recycleBody(id)
  }, [onCollision, recycleBody, numObjects])

  // console.log('FallingObjects render', spawnWidth, spawnDepth, spawnHeight, numObjects, objects)

  return (
    <>
      {/* Falling objects (recycled) */}
      {objects.map((obj) => (
        <RigidBody 
          key={obj.id}
          type="dynamic"
          position={obj.position}
          colliders={false}
          ref={(rb) => {
            bodyRefs.current.set(obj.id, rb as unknown as RapierRigidBody)
            if (rb) {
              try {
                rb.setLinvel({ x: 0, y: 0, z: 0 }, true)
                rb.setAngvel({ x: 0, y: 0, z: 0 }, true)
                rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
              } catch {}
            }
          }}
          onCollisionEnter={(event) => handleCollisionEnter(obj.id, event)}
        >
          {obj.type === 'box' ? (
            <>
              <CuboidCollider args={[0.25, 0.25, 0.25]} />
              <mesh castShadow>
                <boxGeometry args={[0.5, 0.5, 0.5]} />
                <meshStandardMaterial color={obj.color} />
              </mesh>
            </>
          ) : (
            <>
              <BallCollider args={[0.25]} />
              <mesh castShadow>
                <sphereGeometry args={[0.25, 16, 16]} />
                <meshStandardMaterial color={obj.color} />
              </mesh>
            </>
          )}
        </RigidBody>
      ))}

      {/* Collision indicators */}
      {collisions.map((collision) => (
        <CollisionIndicator key={collision.id} position={collision.position} timestamp={collision.timestamp} />
      ))}
    </>
  )
}

// Collision effect indicator
function CollisionIndicator({ position, timestamp }: { position: THREE.Vector3, timestamp: number }) {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (meshRef.current) {
      const age = (Date.now() - timestamp) / 1000
      const scale = Math.max(0, 1 - age * 0.5)
      const opacity = Math.max(0, 1 - age * 0.5)
      
      meshRef.current.scale.setScalar(scale * 2)
      if (meshRef.current.material instanceof THREE.MeshBasicMaterial) {
        meshRef.current.material.opacity = opacity
      }
      
      if (age > 2) {
        meshRef.current.visible = false
      }
    }
  })

  // Rotate the ring so it lies flat (horizontal, in XZ plane)
  return (
    <mesh ref={meshRef} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.1, 0.5, 16]} />
      <meshBasicMaterial color="#ffff00" transparent opacity={1} />
    </mesh>
  )
}

// Info panel component
function InfoPanel({ collisionCount }: { collisionCount: number }) {
  return (
    <div className="absolute top-4 left-4 bg-black/80 text-white p-4 rounded-lg backdrop-blur-sm max-w-sm">
      <h3 className="text-lg font-bold mb-2">Heightfield Physics Demo</h3>
      <div className="text-sm space-y-1">
        <p>• Objects spawn and fall onto the terrain</p>
        <p>• Heightfield collider provides realistic terrain physics</p>
        <p>• Yellow rings show collision points</p>
        <p className="mt-2 text-yellow-400">Collisions: {collisionCount}</p>
      </div>
    </div>
  )
}

// Main scene component
function Scene() {
  const [collisionCount, setCollisionCount] = useState(0)
  
  // Heightfield configuration
  // Rapier expects (widthQuads, depthQuads) and heights sized (widthQuads+1)*(depthQuads+1)
  const widthQuads = 30
  const depthQuads = 20
  const rows = depthQuads + 1
  const cols = widthQuads + 1
  const scaleX = 30
  const scaleY = 2
  const scaleZ = 30
  // (scale object not used anymore by TerrainMesh; kept axes separately)
  const heights = useMemo<number[]>(() => Array.from(generateHeights(rows, cols)), [rows, cols])

  const handleCollision = useCallback(() => {
    setCollisionCount(prev => prev + 1)
  }, [])

  return (
    <div className="w-full h-[80vh] bg-gradient-to-b from-sky-400 to-sky-200 rounded-lg overflow-hidden relative">
      <Canvas shadows camera={{ position: [8, 8, 8], fov: 60 }}>
        <ambientLight intensity={0.4} />
        <directionalLight 
          position={[10, 10, 5]} 
          intensity={1} 
          castShadow 
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={50}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
        />
        
        <Physics gravity={[0, -9.81/4, 0]} debug>
          {/* Heightfield terrain */}
          <RigidBody type="fixed" position={[0, 0, 0]} colliders={false}>
            <HeightfieldCollider 
              // args = [widthQuads, depthQuads, heights(row-major of size (w+1)*(d+1)), scale]
              args={[widthQuads, depthQuads, heights, { x: scaleX, y: scaleY, z: scaleZ }]}
            />
            {/* Visual terrain mesh (same order and transforms as collider) */}
            <TerrainMesh rows={rows} cols={cols} heights={new Float32Array(heights)} scaleX={scaleX} scaleY={scaleY} scaleZ={scaleZ} />
          </RigidBody>

          {/* Falling objects (recycled) */}
          <FallingObjects onCollision={handleCollision} spawnWidth={scaleX} spawnDepth={scaleZ} spawnHeight={12} numObjects={30} />

          {/* Invisible object spawner trigger */}
          {/*
          <RigidBody type="dynamic" position={[0, 12, 0]} colliders={false}>
            <BallCollider args={[0.1]} sensor />
            <mesh>
              <sphereGeometry args={[0.1]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>
          </RigidBody>
          */}
        </Physics>

        {/* Controls */}
        <OrbitControls enablePan enableZoom enableRotate />
        
        {/* Instruction text */}
        <Text
          position={[0, 6, 0]}
          fontSize={0.8}
          color="#333"
          anchorX="center"
          anchorY="middle"
        >
          Objects will spawn and fall automatically!
        </Text>
      </Canvas>
      
      <InfoPanel collisionCount={collisionCount} />
    </div>
  )
}

export default function HeightfieldDemo() {
  return <Scene />
}
