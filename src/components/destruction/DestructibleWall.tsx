'use client'

import React, { Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RigidBody, useRapier } from '@react-three/rapier'
import type { CollisionEnterPayload, ContactForcePayload, RapierRigidBody } from '@react-three/rapier'
import { fracture, FractureOptions } from '@dgreenheck/three-pinata'

const IDENTITY_QUATERNION = { w: 1, x: 0, y: 0, z: 0 } as const

// Physical material defaults
const DEFAULT_DENSITY = 0.24
const DEFAULT_FRICTION = 1.7
const DEFAULT_RESTITUTION = 0.08

export type ImpactDirection = 'posX' | 'negX' | 'posZ' | 'negZ'

export type WallSpec = {
  id: string
  size: [number, number, number]
  center: [number, number, number]
  fragmentCount: number
  impactDirection: ImpactDirection
  outerColor?: number | string
  innerColor?: number | string
}

type FragmentData = {
  id: string
  geometry: THREE.BufferGeometry
  worldPosition: [number, number, number]
  localCenter: [number, number, number]
  halfExtents: [number, number, number]
}

export type JointCandidate = {
  id: string
  aId: string
  bId: string
  midpoint: [number, number, number]
  anchors: [number, number, number][]
  normal: [number, number, number]
  toughness: number
  isRebar: boolean
}

type RapierContextValue = ReturnType<typeof useRapier>
type RapierImpulseJoint = ReturnType<RapierContextValue['world']['createImpulseJoint']>

type JointRecord = {
  id: string
  aId: string
  bId: string
  joint: RapierImpulseJoint
  broken: boolean
  toughness: number
  isRebar: boolean
  anchorWorld: [number, number, number]
  normal: [number, number, number]
  damage: number
}

type FragmentRefs = Map<string, RapierRigidBody | null>
type JointMap = Map<string, JointRecord>
type FragmentJointMap = Map<string, Set<string>>

type WallFragmentProps = {
  fragment: FragmentData
  friction: number
  restitution: number
  density: number
  setFragmentRef: (id: string) => (body: RapierRigidBody | null) => void
  registerCollision: (fragmentId: string, payload: CollisionEnterPayload) => void
  registerForce: (fragmentId: string, event: ContactForcePayload) => void
  outerMaterial: THREE.Material
  innerMaterial: THREE.Material
}

const WallFragment = React.memo<WallFragmentProps>(({
  fragment,
  friction,
  restitution,
  density,
  setFragmentRef,
  registerCollision,
  registerForce,
  outerMaterial,
  innerMaterial,
}) => {
  const positionProps = useMemo(() => ({
    position: fragment.worldPosition,
  }), [fragment.worldPosition])

  const eventHandlers = useMemo(() => ({
    onCollisionEnter: (payload: CollisionEnterPayload) => registerCollision(fragment.id, payload),
    onContactForce: (event: ContactForcePayload) => registerForce(fragment.id, event),
  }), [fragment.id, registerCollision, registerForce])

  const physicsProps = useMemo(() => ({
    colliders: "hull" as const,
    friction,
    restitution,
    density,
    linearDamping: 0.02,
    angularDamping: 0.02,
  }), [friction, restitution, density])

  const ref: Ref<RapierRigidBody | null> = useCallback((body: RapierRigidBody | null) => {
    if (!body) {
      throw new Error('Body is required')
    }
    body.sleep()
    return setFragmentRef(fragment.id)(body)
  }, [fragment.id, setFragmentRef])

  return (
    <RigidBody
      ref={ref}
      {...positionProps}
      {...physicsProps}
      {...eventHandlers}
    >
      <mesh
        geometry={fragment.geometry}
        material={[outerMaterial, innerMaterial]}
        castShadow
        receiveShadow
      />
    </RigidBody>
  )
})

WallFragment.displayName = 'WallFragment'

function buildFragments(spec: WallSpec): FragmentData[] {
  const geometry = new THREE.BoxGeometry(
    spec.size[0],
    spec.size[1],
    spec.size[2],
    2,
    3,
    1,
  )
  const fractureOptions = new FractureOptions()
  fractureOptions.fragmentCount = spec.fragmentCount

  const pieces = fracture(geometry, fractureOptions)
  geometry.dispose()
  const fragments: FragmentData[] = pieces.map((geom, index) => {
    geom.computeBoundingBox()
    const bbox = geom.boundingBox
    const center = new THREE.Vector3()
    bbox?.getCenter(center)
    geom.translate(-center.x, -center.y, -center.z)
    const sizeVec = new THREE.Vector3()
    bbox?.getSize(sizeVec)

    return {
      id: `${spec.id}-${index}`,
      geometry: geom,
      worldPosition: [spec.center[0] + center.x, spec.center[1] + center.y, spec.center[2] + center.z],
      localCenter: [center.x, center.y, center.z],
      halfExtents: [sizeVec.x / 2, sizeVec.y / 2, sizeVec.z / 2],
    }
  })

  return fragments
}

function getSupportPointLocal(geometry: THREE.BufferGeometry, direction: THREE.Vector3): THREE.Vector3 {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const dir = direction
  let best = -Infinity
  let bx = 0, by = 0, bz = 0
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) as number
    const y = pos.getY(i) as number
    const z = pos.getZ(i) as number
    const d = x * dir.x + y * dir.y + z * dir.z
    if (d > best) {
      best = d
      bx = x; by = y; bz = z
    }
  }
  return new THREE.Vector3(bx, by, bz)
}

function projectExtentsOnAxisWorld(geometry: THREE.BufferGeometry, worldPos: THREE.Vector3, axis: THREE.Vector3): { min: number; max: number } {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const ax = axis
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) as number + worldPos.x
    const y = pos.getY(i) as number + worldPos.y
    const z = pos.getZ(i) as number + worldPos.z
    const p = x * ax.x + y * ax.y + z * ax.z
    if (p < min) min = p
    if (p > max) max = p
  }
  return { min, max }
}

function overlap1D(a: { min: number; max: number }, b: { min: number; max: number }) {
  return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min))
}

function computeJointCandidates(spec: WallSpec, fragments: FragmentData[]): JointCandidate[] {
  const candidates: JointCandidate[] = []
  if (fragments.length === 0) return candidates

  const tolerance = Math.max(0.05, Math.min(spec.size[0], spec.size[2]) * 0.12)
  const width = spec.size[0]
  const depth = spec.size[2]

  for (let i = 0; i < fragments.length; i += 1) {
    for (let j = i + 1; j < fragments.length; j += 1) {
      const a = fragments[i]
      const b = fragments[j]
      const dx = Math.abs(a.localCenter[0] - b.localCenter[0])
      const dy = Math.abs(a.localCenter[1] - b.localCenter[1])
      const dz = Math.abs(a.localCenter[2] - b.localCenter[2])
      const hx = a.halfExtents[0] + b.halfExtents[0]
      const hy = a.halfExtents[1] + b.halfExtents[1]
      const hz = a.halfExtents[2] + b.halfExtents[2]

      if (dx > hx + tolerance || dy > hy + tolerance || dz > hz + tolerance) continue

      const worldA = new THREE.Vector3(a.worldPosition[0], a.worldPosition[1], a.worldPosition[2])
      const worldB = new THREE.Vector3(b.worldPosition[0], b.worldPosition[1], b.worldPosition[2])
      const n = worldB.clone().sub(worldA).normalize()
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue

      const pA_local = getSupportPointLocal(a.geometry, n)
      const pB_local = getSupportPointLocal(b.geometry, n.clone().multiplyScalar(-1))
      const pA_world = pA_local.clone().add(worldA)
      const pB_world = pB_local.clone().add(worldB)

      const sA = pA_world.dot(n)
      const sB = pB_world.dot(n)
      const separation = sB - sA
      const epsGap = Math.max(0.006, Math.min(spec.size[0], spec.size[1], spec.size[2]) * 0.02)
      if (separation > epsGap) continue

      const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
      const t1 = new THREE.Vector3().crossVectors(n, up).normalize()
      const t2 = new THREE.Vector3().crossVectors(n, t1).normalize()
      const a1 = projectExtentsOnAxisWorld(a.geometry, worldA, t1)
      const b1 = projectExtentsOnAxisWorld(b.geometry, worldB, t1)
      const a2 = projectExtentsOnAxisWorld(a.geometry, worldA, t2)
      const b2 = projectExtentsOnAxisWorld(b.geometry, worldB, t2)
      const o1 = overlap1D(a1, b1)
      const o2 = overlap1D(a2, b2)
      const size1 = Math.min(a1.max - a1.min, b1.max - b1.min)
      const size2 = Math.min(a2.max - a2.min, b2.max - b2.min)
      if (o1 < size1 * 0.22 || o2 < size2 * 0.22) continue

      const contactArea = o1 * o2
      const centerX = (a.localCenter[0] + b.localCenter[0]) / 2
      const centerZ = (a.localCenter[2] + b.localCenter[2]) / 2
      const centerHeight = (a.localCenter[1] + b.localCenter[1]) / 2

      let toughness = 36 + contactArea * 28
      if (Math.abs(n.y) > 0.6) toughness += 20
      const nearEdge =
        Math.abs(centerX) > width * 0.45 ||
        Math.abs(centerZ) > depth * 0.45 ||
        centerHeight > spec.size[1] * 0.75
      if (nearEdge) toughness *= 0.75

      const isRebar = false
      if (isRebar) {
        toughness *= 2.4
      }

      const mid = pA_world.clone().add(pB_world).multiplyScalar(0.5)
      const midpoint: [number, number, number] = [mid.x, mid.y, mid.z]

      const half1 = 0.5 * o1
      const half2 = 0.5 * o2
      const ex = Math.max(0.05, 0.33 * half1)
      const ey = Math.max(0.05, 0.33 * half2)
      const P = new THREE.Vector3(mid.x, mid.y, mid.z)
      const a1w = P.clone().addScaledVector(t1, +ex).addScaledVector(t2, +ey)
      const a2w = P.clone().addScaledVector(t1, -ex).addScaledVector(t2, +ey)
      const anchors: [number, number, number][] = [
        [P.x, P.y, P.z],
        [a1w.x, a1w.y, a1w.z],
        [a2w.x, a2w.y, a2w.z],
      ]

      const normal: [number, number, number] = [n.x, n.y, n.z]

      const id = `${a.id}--${b.id}`
      candidates.push({
        id,
        aId: a.id,
        bId: b.id,
        midpoint,
        anchors,
        normal,
        toughness,
        isRebar,
      })
    }
  }

  return candidates
}

function useJointGlue(
  fragments: FragmentData[],
  candidates: JointCandidate[],
  fragmentRefs: FragmentRefs,
  jointsEnabled: boolean = true,
  onJointsChanged?: () => void,
) {
  const { rapier, world } = useRapier()
  const jointRecordsRef = useRef<JointMap>(new Map())
  const fragmentJointsRef = useRef<FragmentJointMap>(new Map())
  const lastContactRef = useRef<Map<string, { point: [number, number, number]; normal: [number, number, number] }>>(new Map())

  const breakJoint = useCallback(
    (jointId: string) => {
      if (!world) return
      const record = jointRecordsRef.current.get(jointId)
      if (!record || record.broken) return

      world.removeImpulseJoint(record.joint, true)
      record.broken = true
      jointRecordsRef.current.delete(jointId)
      const aSet = fragmentJointsRef.current.get(record.aId)
      if (aSet) {
        aSet.delete(jointId)
        if (aSet.size === 0) fragmentJointsRef.current.delete(record.aId)
      }
      const bSet = fragmentJointsRef.current.get(record.bId)
      if (bSet) {
        bSet.delete(jointId)
        if (bSet.size === 0) fragmentJointsRef.current.delete(record.bId)
      }
      const bodyA = fragmentRefs.get(record.aId)
      const bodyB = fragmentRefs.get(record.bId)
      bodyA?.wakeUp()
      bodyB?.wakeUp()
      onJointsChanged?.()
    },
    [fragmentRefs, world, onJointsChanged],
  )

  const registerForce = useCallback(
    (fragmentId: string, event: ContactForcePayload) => {
      const contact = lastContactRef.current.get(fragmentId)
      if (!contact) return

      const magnitude = Math.max(event.totalForceMagnitude, event.maxForceMagnitude)
      const joints = fragmentJointsRef.current.get(fragmentId)
      if (!joints) return

      const forceDir = event.maxForceDirection
      const dirVec = new THREE.Vector3(forceDir.x, forceDir.y, forceDir.z).normalize()
      const contactNormal = new THREE.Vector3(contact.normal[0], contact.normal[1], contact.normal[2])

      let broke = 0
      for (const jointId of Array.from(joints.values())) {
        if (broke >= MAX_BREAKS_PER_STEP) break
        const rec = jointRecordsRef.current.get(jointId)
        if (!rec || rec.broken) continue

        const jointN = new THREE.Vector3(rec.normal[0], rec.normal[1], rec.normal[2])
        const tensionByNormal = Math.max(0, jointN.dot(contactNormal))
        const tensionByForceDir = Math.max(0, jointN.dot(dirVec))
        const dirFactor = Math.max(tensionByNormal, tensionByForceDir)

        rec.damage = (rec.damage ?? 0) * DAMAGE_DECAY + magnitude * dirFactor
        const threshold = (rec.isRebar ? 3.0 : 1.0) * rec.toughness * 120
        if (rec.damage >= threshold) {
          breakJoint(jointId)
          broke += 1
        }
      }
    },
    [breakJoint],
  )

  const MAX_BREAKS_PER_STEP = 6
  const DAMAGE_DECAY = 0.9

  const registerCollision = useCallback(
    (fragmentId: string, payload: CollisionEnterPayload) => {
      const manifold = payload.manifold
      const solverCount = manifold.numSolverContacts()
      if (solverCount <= 0) return

      const p = manifold.solverContactPoint(0)
      const n = manifold.normal()

      const hitPoint = new THREE.Vector3(p.x, p.y, p.z)
      const hitNormal = new THREE.Vector3(n.x, n.y, n.z).normalize()

      const impulse = manifold.contactImpulse(0) ?? 0
      const magnitude = impulse
      lastContactRef.current.set(fragmentId, {
        point: [hitPoint.x, hitPoint.y, hitPoint.z],
        normal: [hitNormal.x, hitNormal.y, hitNormal.z],
      })

      const joints = fragmentJointsRef.current.get(fragmentId)
      if (!joints) return

      let broke = 0
      for (const jointId of Array.from(joints.values())) {
        if (broke >= MAX_BREAKS_PER_STEP) break
        const rec = jointRecordsRef.current.get(jointId)
        if (!rec || rec.broken) continue

        const jointN = new THREE.Vector3(rec.normal[0], rec.normal[1], rec.normal[2])
        const dirFactor = Math.max(0, jointN.dot(hitNormal))
        rec.damage = (rec.damage ?? 0) * DAMAGE_DECAY + magnitude * dirFactor
        const threshold = (rec.isRebar ? 3.0 : 1.0) * rec.toughness * 120
        if (rec.damage >= threshold) {
          breakJoint(jointId)
          broke += 1
        }
      }
    },
    [breakJoint],
  )

  useEffect(() => {
    if (!world) return
    const _fragCount = fragments.length
    jointRecordsRef.current.forEach((record) => {
      world.removeImpulseJoint(record.joint, true)
    })
    jointRecordsRef.current.clear()
    fragmentJointsRef.current.clear()
  }, [fragments, world])

  useEffect(() => {
    if (!world) return
    if (fragments.length === 0 || candidates.length === 0) return
    if (!jointsEnabled) return

    let disposed = false
    function tryCreateJoints() {
      if (disposed) return
      const ready = fragments.every((fragment) => fragmentRefs.get(fragment.id))
      if (!ready) {
        requestAnimationFrame(tryCreateJoints)
        return
      }

      for (const candidate of candidates) {
        const bodyA = fragmentRefs.get(candidate.aId)
        const bodyB = fragmentRefs.get(candidate.bId)
        if (!bodyA || !bodyB) continue
        const wca = bodyA.worldCom()
        const lca = bodyA.localCom()
        const ra = bodyA.rotation()
        const qaInv = new THREE.Quaternion(ra.x, ra.y, ra.z, ra.w).invert()

        const wcb = bodyB.worldCom()
        const lcb = bodyB.localCom()
        const rb = bodyB.rotation()
        const qbInv = new THREE.Quaternion(rb.x, rb.y, rb.z, rb.w).invert()

        for (let k = 0; k < candidate.anchors.length; k += 1) {
          const [wx, wy, wz] = candidate.anchors[k]
          const M = new THREE.Vector3(wx, wy, wz)

          const aDeltaLocal = M.clone().sub(new THREE.Vector3(wca.x, wca.y, wca.z)).applyQuaternion(qaInv)
          const bDeltaLocal = M.clone().sub(new THREE.Vector3(wcb.x, wcb.y, wcb.z)).applyQuaternion(qbInv)

          const anchorA = new THREE.Vector3(lca.x, lca.y, lca.z).add(aDeltaLocal)
          const anchorBVec = new THREE.Vector3(lcb.x, lcb.y, lcb.z).add(bDeltaLocal)

          const jointData = rapier.JointData.fixed(
            { x: anchorA.x, y: anchorA.y, z: anchorA.z },
            IDENTITY_QUATERNION,
            { x: anchorBVec.x, y: anchorBVec.y, z: anchorBVec.z },
            IDENTITY_QUATERNION,
          )
          const created = world.createImpulseJoint(jointData, bodyA, bodyB, false)

          const recordId = `${candidate.id}#${k}`
          const record: JointRecord = {
            id: recordId,
            aId: candidate.aId,
            bId: candidate.bId,
            joint: created,
            broken: false,
            toughness: candidate.toughness / candidate.anchors.length,
            isRebar: candidate.isRebar,
            anchorWorld: candidate.anchors[k],
            normal: candidate.normal,
            damage: 0,
          }
          jointRecordsRef.current.set(recordId, record)
          const setA = fragmentJointsRef.current.get(candidate.aId) ?? new Set<string>()
          setA.add(recordId)
          fragmentJointsRef.current.set(candidate.aId, setA)
          const setB = fragmentJointsRef.current.get(candidate.bId) ?? new Set<string>()
          setB.add(recordId)
          fragmentJointsRef.current.set(candidate.bId, setB)
        }
      }
      onJointsChanged?.()
    }

    tryCreateJoints()
    return () => { disposed = true }
  }, [candidates, fragmentRefs, fragments, jointsEnabled, onJointsChanged, world, rapier])

  useEffect(() => {
    return () => {
      if (!world) return
      jointRecordsRef.current.forEach((record) => {
        world.removeImpulseJoint(record.joint, true)
      })
      jointRecordsRef.current.clear()
      fragmentJointsRef.current.clear()
    }
  }, [world])

  return { registerForce, registerCollision, jointRecordsRef }
}

export function DestructibleWall({
  spec: _spec,
  density = DEFAULT_DENSITY,
  friction = DEFAULT_FRICTION,
  restitution = DEFAULT_RESTITUTION,
  jointsEnabled = false,
  debugEnabled = false,
  wireframe = false,
  sleep = true,
}: {
  spec: WallSpec
  density?: number
  friction?: number
  restitution?: number
  jointsEnabled?: boolean
  debugEnabled?: boolean
  wireframe?: boolean
  sleep?: boolean
}) {
  // Memoize spec to avoid unnecessary resets of fragments due to object identity
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const spec = useMemo(() => _spec, [JSON.stringify(_spec)])

  const fragments = useMemo(() => buildFragments(spec), [spec])
  const candidates = useMemo(() => computeJointCandidates(spec, fragments), [spec, fragments])

  useEffect(() => {
    return () => {
      for (const fragment of fragments) {
        fragment.geometry.dispose()
      }
    }
  }, [fragments])

  const fragmentRefs = useRef<FragmentRefs>(new Map())
  const [, setRefsVersion] = useState(0)
  const setFragmentRef = useCallback(
    (id: string) => (body: RapierRigidBody | null) => {
      if (!id) {
        throw new Error('Fragment ID is required')
      }
      if (!body) {
        throw new Error('Body is required')
      }

      fragmentRefs.current.set(id, body)
      // if (sleep) {
      body.sleep()
      // }
      // setRefsVersion((v) => v + 1)
    },
    [],
  )

  const [, setJointVersion] = useState(0)
  const { registerForce, registerCollision } = useJointGlue(
    fragments,
    candidates,
    fragmentRefs.current,
    jointsEnabled,
    useCallback(() => setJointVersion((v) => v + 1), []),
  )

  const outerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.outerColor ?? 0xbababa,
        roughness: 0.62,
        metalness: 0.05,
        wireframe,
      }),
    [spec.outerColor, wireframe],
  )
  const innerMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spec.innerColor ?? 0xbf4b4b,
        roughness: 0.3,
        metalness: 0,
        wireframe,
      }),
    [spec.innerColor, wireframe],
  )

  useEffect(() => {
    return () => {
      outerMaterial.dispose()
      innerMaterial.dispose()
    }
  }, [innerMaterial, outerMaterial])

  console.log('DestructibleWall render', spec.id, fragmentRefs.current)
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    console.log('DestructibleWall render', spec.id, fragmentRefs.current)
    return () => {
      console.log('DestructibleWall unmount', spec.id, fragmentRefs.current)
    }
  }, [])

  return (
    <group>
      {fragments.map((fragment) => (
        <WallFragment
          key={fragment.id}
          fragment={fragment}
          friction={friction}
          restitution={restitution}
          density={density}
          setFragmentRef={setFragmentRef}
          registerCollision={registerCollision}
          registerForce={registerForce}
          outerMaterial={outerMaterial}
          innerMaterial={innerMaterial}
        />
      ))}
      {debugEnabled ? (
        <group>
          {fragments.map((fragment) => {
            const body = fragmentRefs.current.get(fragment.id)
            if (!body) return null
            const com = body.worldCom()
            return (
              <mesh key={`com-${fragment.id}`} position={[com.x, com.y, com.z]}>
                <sphereGeometry args={[0.2, 8, 8]} />
                <meshBasicMaterial color="#00ffff" />
              </mesh>
            )
          })}
        </group>
      ) : null}
    </group>
  )
}


