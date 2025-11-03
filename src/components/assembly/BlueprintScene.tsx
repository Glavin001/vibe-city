'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Color, Quaternion, Vector3 } from 'three'
import type { Line, Mesh } from 'three'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import {
  BallCollider,
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  type RapierRigidBody,
  useRapier,
} from '@react-three/rapier'
import type {
  Blueprint,
  Catalog,
  JointInstance,
  JointTemplate,
  JointTemplateDrive,
  PartInstance,
  SocketDef,
} from '../../types/assembly'
import {
  IDENTITY_QUAT,
  quatToEulerRad,
  rotateVectorByQuat,
} from '../../lib/assemblyMath'

export interface BlueprintRuntimeApi {
  getRigidBody: (id: string) => RapierRigidBody | null
  setJointMotorTarget: (jointId: string, target: number, maxForce?: number) => void
  nudgeJoint: (jointId: string, velocity: number, durationMs?: number) => void
  setManualWheelVelocity: (velocity: number) => void
  getManualWheelVelocity: () => number
  applyImpulseToPart: (partId: string, impulse: [number, number, number]) => void
}

export interface BlueprintSceneProps {
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

type BodyRef = MutableRefObject<RapierRigidBody | null>

type JointHandleInfo = {
  joint: any
  template?: JointTemplate
  drive?: JointTemplateDrive & { target?: number }
}

const DEFAULT_MOTOR_FORCE = 120
const KEYBOARD_WHEEL_SPEED = 9
const TURN_GAIN = 3.2

const toRapierVector = (value: [number, number, number]) => ({ x: value[0], y: value[1], z: value[2] })
const toRapierRotation = (value: [number, number, number, number]) => ({
  x: value[0],
  y: value[1],
  z: value[2],
  w: value[3],
})

const resolveDriveConfig = (
  template: JointTemplate | undefined,
  joint: JointInstance,
): (JointTemplateDrive & { target?: number }) | undefined => {
  const override = joint.driveOverride
  if (override?.mode === 'velocity') {
    return {
      mode: 'velocity',
      target: override.target ?? 0,
      maxForce: override.maxForce,
    }
  }
  const templateDrive = template?.drive?.find((drive) => drive.mode === 'velocity')
  if (templateDrive) {
    return { ...templateDrive, target: templateDrive.target ?? 0 }
  }
  return undefined
}

const applyMotorWithFallback = (joint: any, target: number, maxForce: number) => {
  if (!joint) return
  if (typeof joint.configureMotorVelocity === 'function') {
    joint.configureMotorVelocity(target, maxForce)
  } else if (typeof joint.setMotorTargetVelocity === 'function') {
    joint.setMotorTargetVelocity(target, maxForce)
  } else if (typeof joint.motorTargetVel === 'function') {
    joint.motorTargetVel(target, maxForce)
  }
}

const useBodyRegistry = () => {
  const mapRef = useRef(new Map<string, BodyRef>())

  const register = useCallback((id: string, ref: BodyRef | null) => {
    if (!ref) {
      mapRef.current.delete(id)
    } else {
      mapRef.current.set(id, ref)
    }
  }, [])

  const get = useCallback((id: string) => mapRef.current.get(id)?.current ?? null, [])

  const getRef = useCallback((id: string) => mapRef.current.get(id), [])

  const clear = useCallback(() => {
    mapRef.current.clear()
  }, [])

  return { register, get, getRef, clear, mapRef }
}

const PartInstanceBody = ({
  instance,
  partDef,
  selected,
  onSelect,
  register,
  showSockets,
}: {
  instance: PartInstance
  partDef: Catalog['parts'][string]
  selected: boolean
  onSelect?: (id: string) => void
  register: (id: string, ref: BodyRef | null) => void
  showSockets?: boolean
}) => {
  const bodyRef = useRef<RapierRigidBody | null>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    register(instance.id, bodyRef)
    return () => {
      register(instance.id, null)
    }
  }, [instance.id, register])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const [x, y, z] = instance.transform.position
    const [qx, qy, qz, qw] = instance.transform.rotationQuat
    body.setTranslation({ x, y, z }, true)
    body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true)
  }, [instance.transform.position, instance.transform.rotationQuat])

  const handlePointerDown = useCallback(
    (event: any) => {
      event.stopPropagation()
      onSelect?.(instance.id)
    },
    [instance.id, onSelect],
  )

  const handlePointerOver = useCallback((event: any) => {
    event.stopPropagation()
    setHovered(true)
  }, [])

  const handlePointerOut = useCallback((event: any) => {
    event.stopPropagation()
    setHovered(false)
  }, [])

  const bodyType = partDef.physics?.dynamic ? 'dynamic' : 'fixed'
  const baseColor = partDef.render?.color ?? '#cfd2d5'
  const emissive = selected ? new Color('#ffb347') : hovered ? new Color('#66ccff') : new Color('#000000')

  const colliders = partDef.physics?.colliders?.map((collider, index) => {
    const offsetPosition = collider.offset?.position ?? [0, 0, 0]
    const offsetRotation = collider.offset?.rotationQuat ?? IDENTITY_QUAT
    const rotation = quatToEulerRad(offsetRotation)
    const material = collider.material ?? {}
    const friction = material.friction ?? (partDef.physics?.dynamic ? 0.7 : 1.0)
    const restitution = material.restitution ?? (partDef.physics?.dynamic ? 0.1 : 0.05)

    if (collider.shape === 'box') {
      const [hx, hy, hz] = collider.params as [number, number, number]
      return (
        <CuboidCollider
          key={`collider-${index}`}
          args={[hx, hy, hz]}
          position={offsetPosition}
          rotation={rotation}
          friction={friction}
          restitution={restitution}
        />
      )
    }
    if (collider.shape === 'sphere') {
      const [radius] = collider.params as [number]
      return (
        <BallCollider
          key={`collider-${index}`}
          args={[radius]}
          position={offsetPosition}
          friction={friction}
          restitution={restitution}
        />
      )
    }
    if (collider.shape === 'cylinder') {
      const [radius, halfHeight] = collider.params as [number, number]
      return (
        <CylinderCollider
          key={`collider-${index}`}
          args={[halfHeight ?? 0.5, radius ?? 0.5]}
          position={offsetPosition}
          rotation={rotation}
          friction={friction}
          restitution={restitution}
        />
      )
    }
    return null
  })

  const renderShape = () => {
    const shape = partDef.render?.shape ?? 'box'
    if (shape === 'box') {
      const [sx, sy, sz] = partDef.render?.size ?? [1, 1, 1]
      return (
        <mesh
          castShadow
          receiveShadow
          onPointerDown={handlePointerDown}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <boxGeometry args={[sx, sy, sz]} />
          <meshStandardMaterial color={baseColor} metalness={0.1} roughness={0.6} emissive={emissive} emissiveIntensity={selected ? 0.6 : 0.2} />
        </mesh>
      )
    }
    if (shape === 'cylinder') {
      const radius = partDef.render?.radius ?? 0.5
      const height = partDef.render?.height ?? 0.5
      return (
        <mesh
          castShadow
          receiveShadow
          rotation={[0, 0, Math.PI / 2]}
          onPointerDown={handlePointerDown}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <cylinderGeometry args={[radius, radius, height, 24]} />
          <meshStandardMaterial color={baseColor} metalness={0.2} roughness={0.5} emissive={emissive} emissiveIntensity={selected ? 0.6 : 0.2} />
        </mesh>
      )
    }
    if (shape === 'panel') {
      const [sx, sy] = partDef.render?.size ?? [2, 2]
      return (
        <mesh
          receiveShadow
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={handlePointerDown}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <planeGeometry args={[sx, sy]} />
          <meshStandardMaterial color={baseColor} side={2} emissive={emissive} emissiveIntensity={selected ? 0.6 : 0.2} />
        </mesh>
      )
    }
    return null
  }

  return (
    <RigidBody
      ref={bodyRef}
      type={bodyType}
      colliders={false}
      mass={partDef.physics?.mass}
      canSleep
      name={instance.label ?? instance.partId}
    >
      {colliders}
      <group>{renderShape()}</group>
      {showSockets && (
        <group>
          {partDef.sockets.map((socket) => (
            <mesh key={socket.id} position={socket.frame.position}>
              <sphereGeometry args={[selected ? 0.11 : 0.08, 12, 12]} />
              <meshBasicMaterial color={selected ? '#ffd166' : '#57c7ff'} transparent opacity={selected ? 0.9 : 0.6} />
            </mesh>
          ))}
        </group>
      )}
      {selected && instance.label ? (
        <Html
          position={[0, (partDef.render?.size?.[1] ?? 1.5) * 0.6 + 0.6, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white shadow-lg">{instance.label}</div>
        </Html>
      ) : null}
    </RigidBody>
  )
}

const JointInstanceComponent = ({
  joint,
  template,
  socketA,
  socketB,
  bodyA,
  bodyB,
  registerJoint,
}: {
  joint: JointInstance
  template: JointTemplate
  socketA: SocketDef
  socketB: SocketDef
  bodyA: BodyRef | undefined
  bodyB: BodyRef | undefined
  registerJoint: (id: string, handle: JointHandleInfo | null) => void
}) => {
  const { rapier, world } = useRapier()

  useEffect(() => {
    const bodyAApi = bodyA?.current
    const bodyBApi = bodyB?.current
    if (!bodyAApi || !bodyBApi) return

    const rawA = bodyAApi
    const rawB = bodyBApi

    const anchorA = socketA.frame.position
    const anchorB = socketB.frame.position
    const frameAQuat = socketA.frame.rotationQuat ?? IDENTITY_QUAT
    const frameBQuat = socketB.frame.rotationQuat ?? IDENTITY_QUAT
    const baseAxis = template.axis ?? [0, 1, 0]
    const axis = rotateVectorByQuat(baseAxis, frameAQuat)

    let created: any = null

    if (template.type === 'revolute') {
      const data = rapier.JointData.revolute(
        toRapierVector(anchorA),
        toRapierVector(anchorB),
        toRapierVector(axis),
      )
      created = world.createImpulseJoint(data, rawA, rawB, true)
    } else if (template.type === 'fixed') {
      const data = rapier.JointData.fixed(
        toRapierVector(anchorA),
        toRapierRotation(frameAQuat),
        toRapierVector(anchorB),
        toRapierRotation(frameBQuat),
      )
      created = world.createImpulseJoint(data, rawA, rawB, true)
    } else {
      return () => {}
    }

    const driveConfig = resolveDriveConfig(template, joint)
    if (driveConfig?.mode === 'velocity') {
      applyMotorWithFallback(
        created,
        driveConfig.target ?? 0,
        driveConfig.maxForce ?? DEFAULT_MOTOR_FORCE,
      )
    }

    registerJoint(joint.id, { joint: created, template, drive: driveConfig })

    return () => {
      registerJoint(joint.id, null)
      if (created && typeof world.removeImpulseJoint === 'function') {
        world.removeImpulseJoint(created, true)
      }
    }
  }, [bodyA, bodyB, joint, rapier, registerJoint, socketA, socketB, template, world])

  return null
}

const JointAnchorGizmo = ({
  joint,
  socketA,
  socketB,
  bodyA,
  bodyB,
  selected,
  onSelect,
}: {
  joint: JointInstance
  socketA: SocketDef
  socketB: SocketDef
  bodyA: BodyRef | undefined
  bodyB: BodyRef | undefined
  selected: boolean
  onSelect?: (id: string) => void
}) => {
  const sphereARef = useRef<Mesh>(null)
  const sphereBRef = useRef<Mesh>(null)
  const lineRef = useRef<Line>(null)
  const linePositions = useMemo(() => new Float32Array(6), [])

  const updatePositions = useCallback(() => {
    const bodyAApi = bodyA?.current
    const bodyBApi = bodyB?.current
    if (!bodyAApi || !bodyBApi) return
    const translationA = bodyAApi.translation()
    const rotationA = bodyAApi.rotation()
    const translationB = bodyBApi.translation()
    const rotationB = bodyBApi.rotation()

    const qa = new Quaternion(rotationA.x, rotationA.y, rotationA.z, rotationA.w)
    const qb = new Quaternion(rotationB.x, rotationB.y, rotationB.z, rotationB.w)

    const worldA = new Vector3().fromArray(socketA.frame.position).applyQuaternion(qa)
    worldA.add(new Vector3(translationA.x, translationA.y, translationA.z))

    const worldB = new Vector3().fromArray(socketB.frame.position).applyQuaternion(qb)
    worldB.add(new Vector3(translationB.x, translationB.y, translationB.z))

    sphereARef.current?.position.copy(worldA)
    sphereBRef.current?.position.copy(worldB)

    const positions = lineRef.current?.geometry.getAttribute('position')
    if (positions) {
      positions.setXYZ(0, worldA.x, worldA.y, worldA.z)
      positions.setXYZ(1, worldB.x, worldB.y, worldB.z)
      positions.needsUpdate = true
    }
  }, [bodyA, bodyB, socketA.frame.position, socketB.frame.position])

  useFrame(updatePositions)

  const handleSelect = useCallback(
    (event: any) => {
      event.stopPropagation()
      onSelect?.(joint.id)
    },
    [joint.id, onSelect],
  )

  const color = selected ? '#ffaf40' : '#6dd5ff'
  const scale = selected ? 1.2 : 1

  return (
    <group>
      <mesh ref={sphereARef} scale={scale} onPointerDown={handleSelect}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={sphereBRef} scale={scale} onPointerDown={handleSelect}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <threeLine ref={lineRef} onPointerDown={handleSelect}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} linewidth={selected ? 2 : 1} />
      </threeLine>
    </group>
  )
}

export const BlueprintScene = ({
  blueprint,
  catalog,
  selectedPartId,
  selectedJointId,
  onSelectPart,
  onSelectJoint,
  onRuntimeReady,
  showSockets,
  showJointDebug = true,
  variantKey,
}: BlueprintSceneProps) => {
  const parts = blueprint.root.parts
  const joints = blueprint.root.joints

  const partLookup = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts])

  const bodyRegistry = useBodyRegistry()
  const jointHandlesRef = useRef(new Map<string, JointHandleInfo>())
  const carControlRef = useRef({
    manualVelocity: 0,
    throttle: 0,
    turn: 0,
    keys: { forward: false, backward: false, left: false, right: false },
  })

  useEffect(() => {
    bodyRegistry.clear()
    jointHandlesRef.current.clear()
    carControlRef.current.manualVelocity = 0
    carControlRef.current.throttle = 0
    carControlRef.current.turn = 0
  }, [blueprint.id, bodyRegistry])

  const registerJoint = useCallback((id: string, handle: JointHandleInfo | null) => {
    if (!handle) {
      jointHandlesRef.current.delete(id)
    } else {
      jointHandlesRef.current.set(id, handle)
    }
  }, [])

  useEffect(() => {
    joints.forEach((joint) => {
      const handle = jointHandlesRef.current.get(joint.id)
      if (!handle) return
      const drive = resolveDriveConfig(handle.template, joint)
      if (drive?.mode === 'velocity') {
        applyMotorWithFallback(
          handle.joint,
          joint.driveOverride?.target ?? drive.target ?? 0,
          drive.maxForce ?? DEFAULT_MOTOR_FORCE,
        )
        handle.drive = drive
      }
    })
  }, [joints])

  const wheelJointIds = useMemo(
    () =>
      joints
        .filter((joint) => joint.template === 'hinge_wheel_motor_v1')
        .map((joint) => joint.id),
    [joints],
  )

  const wheelJointSides = useMemo(() => {
    const map = new Map<string, 'left' | 'right'>()
    wheelJointIds.forEach((jointId) => {
      const joint = joints.find((candidate) => candidate.id === jointId)
      if (!joint) return
      const wheelInstance = partLookup.get(joint.b.partInstanceId)
      if (!wheelInstance) return
      const [x] = wheelInstance.transform.position
      map.set(jointId, x < 0 ? 'left' : 'right')
    })
    return map
  }, [joints, partLookup, wheelJointIds])

  useEffect(() => {
    if (variantKey !== 'example-car') return
    const pressed = carControlRef.current.keys

    const updateState = () => {
      const forward = (pressed.forward ? 1 : 0) - (pressed.backward ? 1 : 0)
      const turn = (pressed.left ? 1 : 0) - (pressed.right ? 1 : 0)
      carControlRef.current.throttle = forward
      carControlRef.current.turn = turn
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          pressed.forward = true
          break
        case 'KeyS':
        case 'ArrowDown':
          pressed.backward = true
          break
        case 'KeyA':
        case 'ArrowLeft':
          pressed.left = true
          break
        case 'KeyD':
        case 'ArrowRight':
          pressed.right = true
          break
        default:
          return
      }
      updateState()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'KeyW':
        case 'ArrowUp':
          pressed.forward = false
          break
        case 'KeyS':
        case 'ArrowDown':
          pressed.backward = false
          break
        case 'KeyA':
        case 'ArrowLeft':
          pressed.left = false
          break
        case 'KeyD':
        case 'ArrowRight':
          pressed.right = false
          break
        default:
          return
      }
      updateState()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      carControlRef.current.keys.forward = false
      carControlRef.current.keys.backward = false
      carControlRef.current.keys.left = false
      carControlRef.current.keys.right = false
      carControlRef.current.throttle = 0
      carControlRef.current.turn = 0
    }
  }, [variantKey])

  useFrame(() => {
    if (variantKey !== 'example-car') return
    const control = carControlRef.current
    const baseVelocity = control.manualVelocity + control.throttle * KEYBOARD_WHEEL_SPEED
    const turnBias = control.turn * TURN_GAIN

    wheelJointIds.forEach((jointId) => {
      const handle = jointHandlesRef.current.get(jointId)
      if (!handle) return
      const side = wheelJointSides.get(jointId)
      const driveForce = handle.drive?.maxForce ?? DEFAULT_MOTOR_FORCE * 5
      const target = side === 'left' ? baseVelocity - turnBias : baseVelocity + turnBias
      applyMotorWithFallback(handle.joint, target, driveForce)
    })
  })

  const setJointMotorTarget = useCallback((jointId: string, target: number, maxForce?: number) => {
    const handle = jointHandlesRef.current.get(jointId)
    if (!handle) return
    const force = maxForce ?? handle.drive?.maxForce ?? DEFAULT_MOTOR_FORCE
    applyMotorWithFallback(handle.joint, target, force)
    if (handle.drive) {
      handle.drive.target = target
      handle.drive.maxForce = force
    }
  }, [])

  const nudgeJoint = useCallback((jointId: string, velocity: number, durationMs = 400) => {
    const handle = jointHandlesRef.current.get(jointId)
    if (!handle) return
    const force = handle.drive?.maxForce ?? DEFAULT_MOTOR_FORCE
    applyMotorWithFallback(handle.joint, velocity, force)
    window.setTimeout(() => {
      applyMotorWithFallback(handle.joint, 0, force)
    }, durationMs)
  }, [])

  const setManualWheelVelocity = useCallback((velocity: number) => {
    carControlRef.current.manualVelocity = velocity
  }, [])

  const getManualWheelVelocity = useCallback(() => carControlRef.current.manualVelocity, [])

  const applyImpulseToPart = useCallback((partId: string, impulse: [number, number, number]) => {
    const body = bodyRegistry.get(partId)
    if (!body) return
    body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true)
  }, [bodyRegistry])

  useEffect(() => {
    if (!onRuntimeReady) return
    const runtime: BlueprintRuntimeApi = {
      getRigidBody: bodyRegistry.get,
      setJointMotorTarget,
      nudgeJoint,
      setManualWheelVelocity,
      getManualWheelVelocity,
      applyImpulseToPart,
    }
    onRuntimeReady(runtime)
    return () => onRuntimeReady(null)
  }, [
    applyImpulseToPart,
    bodyRegistry.get,
    getManualWheelVelocity,
    nudgeJoint,
    onRuntimeReady,
    setJointMotorTarget,
    setManualWheelVelocity,
  ])

  const getSocket = useCallback(
    (partInstanceId: string, socketId: string) => {
      const instance = partLookup.get(partInstanceId)
      if (!instance) return undefined
      const partDef = catalog.parts[instance.partId]
      return partDef?.sockets.find((socket) => socket.id === socketId)
    },
    [catalog.parts, partLookup],
  )

  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[40, 0.05, 40]} position={[0, -0.1, 0]} friction={1.4} restitution={0.05} />
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#2a2d33" roughness={0.9} metalness={0} />
        </mesh>
      </RigidBody>
      {parts.map((instance) => {
        const partDef = catalog.parts[instance.partId]
        if (!partDef) return null
        return (
          <PartInstanceBody
            key={instance.id}
            instance={instance}
            partDef={partDef}
            selected={selectedPartId === instance.id}
            onSelect={(id) => onSelectPart?.(id)}
            register={(id, ref) => bodyRegistry.register(id, ref)}
            showSockets={showSockets}
          />
        )
      })}
      {joints.map((joint) => {
        const template = catalog.jointTemplates?.[joint.template]
        if (!template) return null
        const socketA = getSocket(joint.a.partInstanceId, joint.a.socketId)
        const socketB = getSocket(joint.b.partInstanceId, joint.b.socketId)
        if (!socketA || !socketB) return null
        const bodyA = bodyRegistry.getRef(joint.a.partInstanceId)
        const bodyB = bodyRegistry.getRef(joint.b.partInstanceId)
        if (!bodyA || !bodyB) return null
        return (
          <group key={joint.id}>
            <JointInstanceComponent
              joint={joint}
              template={template}
              socketA={socketA}
              socketB={socketB}
              bodyA={bodyA}
              bodyB={bodyB}
              registerJoint={registerJoint}
            />
            {showJointDebug ? (
              <JointAnchorGizmo
                joint={joint}
                socketA={socketA}
                socketB={socketB}
                bodyA={bodyA}
                bodyB={bodyB}
                selected={selectedJointId === joint.id}
                onSelect={(id) => onSelectJoint?.(id)}
              />
            ) : null}
          </group>
        )
      })}
    </group>
  )
}
