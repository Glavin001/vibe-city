import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier'
import type { RapierRigidBody, RapierCollider } from '@react-three/rapier'

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

const PLAYER_EYE_HEIGHT = 1.65 // Realistic human eye height (1.8m person)
const WALK_SPEED = 5
const RUN_SPEED = 9
const CAPSULE_HALF_HEIGHT = 0.6 // Capsule dimensions for 1.8m tall human
const CAPSULE_RADIUS = 0.3
const CAPSULE_CENTER_HEIGHT = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS // 0.9m when feet on ground

export type AgentPose = {
  position: [number, number, number]
  yaw: number
  pitch: number
}

export function PlayerKCC({ 
  start, 
  poseRef,
  eyeHeight = PLAYER_EYE_HEIGHT,
  initialYaw = 0,
  initialPitch = 0
}: { 
  start: [number, number, number]
  poseRef?: React.MutableRefObject<AgentPose>
  eyeHeight?: number
  initialYaw?: number
  initialPitch?: number
}) {
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
        (world as unknown as { removeCharacterController: (c: CharacterControllerAny) => void }).removeCharacterController(characterController.current)
        characterController.current = null
      }
    }
  }, [rapier, world])

  // Place player and camera at spawn
  useEffect(() => {
    if (!characterRigidBody.current) return
    characterRigidBody.current.setNextKinematicTranslation({ x: start[0], y: start[1], z: start[2] })
    // Capsule center is at start[1]. With current dimensions, center is 0.9m above ground when feet touch y=0.
    camera.position.set(start[0], start[1] + (eyeHeight - CAPSULE_CENTER_HEIGHT), start[2])
    // Set initial camera rotation
    camera.rotation.set(initialPitch, initialYaw, 0)
    // Update pose ref if provided
    if (poseRef) {
      poseRef.current = {
        position: [start[0], start[1] + (eyeHeight - CAPSULE_CENTER_HEIGHT), start[2]],
        yaw: initialYaw,
        pitch: initialPitch,
      }
    }
  }, [start, camera, eyeHeight, initialYaw, initialPitch, poseRef])

  const tmp = useMemo(() => ({ forward: new THREE.Vector3(), right: new THREE.Vector3(), dir: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), [])

  useFrame((_, delta) => {
    const body = characterRigidBody.current
    const collider = characterColliderRef.current
    const ctrl = characterController.current
    if (!body || !collider || !ctrl) return

    const { forward, backward, left, right, jump, run } = get()
    const speed = (run ? RUN_SPEED : WALK_SPEED)

    // Camera-relative planar movement (ignore pitch)
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

    // Place camera at eye height over rigid body
    camera.position.set(next.x, next.y + (eyeHeight - CAPSULE_CENTER_HEIGHT), next.z)
    
    // Update pose ref if provided
    if (poseRef) {
      poseRef.current = {
        position: [next.x, next.y + (eyeHeight - CAPSULE_CENTER_HEIGHT), next.z],
        yaw: camera.rotation.y,
        pitch: camera.rotation.x,
      }
    }
  })

  return (
    <RigidBody ref={characterRigidBody} type="kinematicPosition" colliders={false} enabledRotations={[false, false, false]} position={start}>
      {/* Capsule: 1.8m tall human (halfHeight=0.6m, radius=0.3m) */}
      <CapsuleCollider ref={characterColliderRef} args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
    </RigidBody>
  )
}

