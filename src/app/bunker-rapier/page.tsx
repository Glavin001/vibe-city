'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { KeyboardControls, PointerLockControls, useKeyboardControls } from '@react-three/drei'
import { Physics, RigidBody, CapsuleCollider, CuboidCollider, useRapier } from '@react-three/rapier'
import type { RapierRigidBody, RapierCollider } from '@react-three/rapier'
import * as THREE from 'three'
import { BUILDINGS, type BuildingConfig, NODE_POS, N } from '../../lib/bunker-world'
import { Ground, Building } from '../../lib/bunker-scene'

type Controls = 'forward' | 'backward' | 'left' | 'right' | 'jump' | 'run'
// Use a minimal shape for the character controller to avoid cross-package type conflicts
type CharacterControllerAny = {
  enableAutostep: (maxStepHeight: number, minStepWidth: number, considerDynamicBodies: boolean) => void
  enableSnapToGround: (distance: number) => void
  setApplyImpulsesToDynamicBodies: (enabled: boolean) => void
  computeColliderMovement: (collider: RapierCollider, movement: { x: number; y: number; z: number }) => void
  computedMovement: () => { x: number; y: number; z: number }
  computedGrounded: () => boolean
}

const PLAYER_EYE_HEIGHT = 1.8
const WALK_SPEED = 5
const RUN_SPEED = 9

function BuildingColliders({ config, wallThickness = 0.25 }: { config: BuildingConfig; wallThickness?: number }) {
  const { center, size } = config
  const [dx, dy, dz] = size
  const hx = dx / 2
  const hy = dy / 2
  const hz = dz / 2
  const t = wallThickness
  return (
    <RigidBody type="fixed" position={[center[0], 0, center[2]]} colliders={false}>
      {/* North wall */}
      <CuboidCollider args={[hx, hy, t / 2]} position={[0, hy, -(hz - t / 2)]} />
      {/* South wall */}
      <CuboidCollider args={[hx, hy, t / 2]} position={[0, hy, hz - t / 2]} />
      {/* East wall */}
      <CuboidCollider args={[t / 2, hy, hz - t]} position={[hx - t / 2, hy, 0]} />
      {/* West wall */}
      <CuboidCollider args={[t / 2, hy, hz - t]} position={[-(hx - t / 2), hy, 0]} />
    </RigidBody>
  )
}

function GroundPhysics() {
  // Large static ground plane collider
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      <CuboidCollider args={[60, 0.05, 60]} position={[0, -0.05, 0]} />
    </RigidBody>
  )
}

function PlayerKCC({ start }: { start: [number, number, number] }) {
  const characterRigidBody = useRef<RapierRigidBody | null>(null)
  const characterColliderRef = useRef<RapierCollider | null>(null)
  const { world, rapier } = useRapier()
  const characterController = useRef<CharacterControllerAny | null>(null)
  const camera = useThree((s) => s.camera)
  const [, get] = useKeyboardControls<Controls>()

  // Movement state
  const velocityYRef = useRef(0)
  const jumpPressedRef = useRef(false)

  // Init controller
  useEffect(() => {
    if (!rapier || !world) return
    const ctrl = (world as unknown as { createCharacterController: (sn: number) => CharacterControllerAny }).createCharacterController(0.1)
    ctrl.enableAutostep(0.7, 0.3, true)
    ctrl.enableSnapToGround(0.1)
    ctrl.setApplyImpulsesToDynamicBodies(true)
    characterController.current = ctrl
    return () => {
      if (characterController.current) {
        // Cast world to minimal shape to avoid duplicate Rapier type instances during type-checking
        (world as unknown as { removeCharacterController: (c: CharacterControllerAny) => void }).removeCharacterController(characterController.current)
        characterController.current = null
      }
    }
  }, [rapier, world])

  // Place player and camera at spawn
  useEffect(() => {
    if (!characterRigidBody.current) return
    characterRigidBody.current.setNextKinematicTranslation({ x: start[0], y: start[1], z: start[2] })
    // Capsule center is at start[1]. With halfHeight=1 and radius=0.5, center is 1.5m above ground when bottom touches y=0.
    camera.position.set(start[0], start[1] + (PLAYER_EYE_HEIGHT - 1.5), start[2])
  }, [start, camera])

  const tmp = useMemo(() => ({ forward: new THREE.Vector3(), right: new THREE.Vector3(), dir: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), [])

  useFrame((_, delta) => {
    const body = characterRigidBody.current
    const collider = characterColliderRef.current
    const ctrl = characterController.current
    if (!body || !collider || !ctrl) return

    const { forward, backward, left, right, jump, run } = get()
    const speed = (run ? RUN_SPEED : WALK_SPEED)

    // Camera-relative planar movement (ignore pitch)
    // Compute flattened forward and right vectors from camera
    camera.getWorldDirection(tmp.forward)
    tmp.forward.y = 0
    if (tmp.forward.lengthSq() > 0) tmp.forward.normalize()
    tmp.right.copy(tmp.forward).cross(tmp.up).normalize()
    const f = Number(forward) - Number(backward)
    const r = Number(right) - Number(left)
    tmp.dir.set(0, 0, 0)
    if (f !== 0) tmp.dir.addScaledVector(tmp.forward, f)
    if (r !== 0) tmp.dir.addScaledVector(tmp.right, r)
    if (tmp.dir.lengthSq() > 1) tmp.dir.normalize()

    // Gravity and jumping
    const grounded = ctrl.computedGrounded()
    const gravity = -30
    if (grounded) {
      velocityYRef.current = 0
      if (jump && !jumpPressedRef.current) {
        velocityYRef.current = 8.5
        jumpPressedRef.current = true
      }
      if (!jump) jumpPressedRef.current = false
    } else {
      velocityYRef.current += gravity * delta
    }

    const movement = { x: tmp.dir.x * speed * delta, y: velocityYRef.current * delta, z: tmp.dir.z * speed * delta }

    // Compute collider movement against world
    ctrl.computeColliderMovement(collider, movement)
    const translation = body.translation()
    const move = ctrl.computedMovement()

    const next = new THREE.Vector3(translation.x + move.x, translation.y + move.y, translation.z + move.z)
    body.setNextKinematicTranslation(next)

    // Place camera at eye height over rigid body (capsule center ~1.5m above ground)
    camera.position.set(next.x, next.y + (PLAYER_EYE_HEIGHT - 1.5), next.z)
  })

  return (
    <>
      <RigidBody ref={characterRigidBody} type="kinematicPosition" colliders={false} enabledRotations={[false, false, false]} position={start}>
        {/* Capsule height definition: args = [halfHeight, radius] in r3r v2 */}
        <CapsuleCollider ref={characterColliderRef} args={[1, 0.5]} />
      </RigidBody>
    </>
  )
}

function Scene() {
  const [isLocked, setIsLocked] = useState(false)
  // Place capsule center at 1.5m so feet are near y ~ 0
  const spawn: [number, number, number] = useMemo(() => [NODE_POS[N.COURTYARD][0], 1.5, NODE_POS[N.COURTYARD][2]], [])
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
            {/* Visual ground */}
            <Ground />
            <gridHelper args={[60, 60, '#4b5563', '#374151']} position={[0, 0.01, 0]} />

            {/* Physics ground */}
            <GroundPhysics />

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

            {/* Building colliders (simple 4-wall boxes) */}
            <BuildingColliders config={BUILDINGS.STORAGE} />
            <BuildingColliders config={BUILDINGS.BUNKER} />

            {/* Player */}
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


