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
 * Impact tuning constants derived from simple physics heuristics.
 * We use kinetic energy scaling to estimate crater radius/depth and
 * keep everything in a range that still runs comfortably in real-time.
 */
const ENERGY_BASELINE = 5_000
const MIN_CRATER_RADIUS = 0.6
const MIN_CRATER_DEPTH = 0.12
const SKID_ANGLE_THRESHOLD = 0.18
// Force-respawn meteors that fall too far below the terrain so they keep cycling
const RESPAWN_Y_THRESHOLD = -12
// Allow meteors to linger after impact so they can tumble inside their crater before recycling
const IMPACT_RESPAWN_DELAY = 2000
const BASE_LINEAR_DAMPING = 0.08
const BASE_ANGULAR_DAMPING = 0.06

type MeteorImpact = {
  position: THREE.Vector3
  radius: number
  mass: number
  velocity: THREE.Vector3
}

type MeteorImpactResponse = {
  postImpactVelocity?: THREE.Vector3
  linearDamping?: number
  angularDamping?: number
  angularVelocityScale?: number
}

type DeformationProfile = {
  position: THREE.Vector3
  majorRadius: number
  minorRadius: number
  depth: number
  rimHeight: number
  skidLength: number
  direction: THREE.Vector2
  shockFactor: number
  horizontalRatio: number
  verticalRatio: number
}

const METEOR_COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#45b7d1',
  '#f9ca24',
  '#f0932b',
  '#eb4d4b',
  '#6c5ce7',
] as const

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

  const sampleHeightAtWorld = useCallback(
    (x: number, z: number) => {
      const heights = heightsRef.current
      const halfWidth = scaleX / 2
      const halfDepth = scaleZ / 2
      const clampedZ = clamp(z, -halfWidth, halfWidth)
      const clampedX = clamp(x, -halfDepth, halfDepth)

      const colFloat = ((clampedZ / scaleX) + 0.5) * (cols - 1)
      const rowFloat = ((clampedX / scaleZ) + 0.5) * (rows - 1)

      const col0 = Math.floor(colFloat)
      const row0 = Math.floor(rowFloat)
      const col1 = Math.min(cols - 1, col0 + 1)
      const row1 = Math.min(rows - 1, row0 + 1)
      const tx = colFloat - col0
      const tz = rowFloat - row0

      const h00 = heights[row0 * cols + col0]
      const h10 = heights[row0 * cols + col1]
      const h01 = heights[row1 * cols + col0]
      const h11 = heights[row1 * cols + col1]

      const hx0 = h00 * (1 - tx) + h10 * tx
      const hx1 = h01 * (1 - tx) + h11 * tx
      const h = hx0 * (1 - tz) + hx1 * tz
      return h * scaleY
    },
    [cols, rows, scaleX, scaleY, scaleZ],
  )

  const surfaceNormalAt = useCallback(
    (position: THREE.Vector3) => {
      const heights = heightsRef.current
      if (!heights) return new THREE.Vector3(0, 1, 0)

      const stepX = rows > 1 ? scaleZ / (rows - 1) : 1
      const stepZ = cols > 1 ? scaleX / (cols - 1) : 1

      const hxPlus = sampleHeightAtWorld(position.x + stepX, position.z)
      const hxMinus = sampleHeightAtWorld(position.x - stepX, position.z)
      const hzPlus = sampleHeightAtWorld(position.x, position.z + stepZ)
      const hzMinus = sampleHeightAtWorld(position.x, position.z - stepZ)

      const gradientX = stepX !== 0 ? (hxPlus - hxMinus) / (2 * stepX) : 0
      const gradientZ = stepZ !== 0 ? (hzPlus - hzMinus) / (2 * stepZ) : 0

      const normal = new THREE.Vector3(-gradientX, 1, -gradientZ)
      return normal.normalize()
    },
    [cols, rows, sampleHeightAtWorld, scaleX, scaleZ],
  )

  // Crater application flag + timer for throttled collider rebuild
  const needsColliderUpdateRef = useRef(false)
  const colliderTimerRef = useRef(0)

  const carveCrater = useCallback((profile: DeformationProfile) => {
    const {
      position,
      majorRadius,
      minorRadius,
      depth,
      rimHeight,
      skidLength,
      direction,
      shockFactor,
      horizontalRatio,
      verticalRatio,
    } = profile
    const heights = heightsRef.current
    const depthUnits = depth / scaleY
    const rimUnits = rimHeight / scaleY
    const baseRadius = Math.max(majorRadius, minorRadius)
    const influence = baseRadius + skidLength + rimHeight * 2

    // IMPORTANT: Z and X are swapped here to match Rapier orientation
    const cx = position.z
    const cz = position.x

    const forwardDir = direction.lengthSq() > 1e-6 ? direction.clone().normalize() : new THREE.Vector2(0, 1)
    const sideDir = new THREE.Vector2(-forwardDir.y, forwardDir.x)
    const shockOuter = baseRadius * (1.4 + shockFactor * 0.8)
    const glancing = clamp(horizontalRatio, 0, 1)
    const verticalImpact = clamp(verticalRatio, 0, 1)

    let touched = false
    let rowMin = rows
    let rowMax = -1
    let colMin = cols
    let colMax = -1

    const markTouched = (r: number, c: number) => {
      touched = true
      if (r < rowMin) rowMin = r
      if (r > rowMax) rowMax = r
      if (c < colMin) colMin = c
      if (c > colMax) colMax = c
    }

    for (let r = 0; r < rows; r++) {
      const worldX = sampleWorldZ[r]
      const dz = worldX - cz
      if (Math.abs(dz) > influence) continue
      for (let c = 0; c < cols; c++) {
        const worldZ = sampleWorldX[c]
        const dx = worldZ - cx
        if (Math.abs(dx) > influence) continue

        const forward = dx * forwardDir.x + dz * forwardDir.y
        const lateral = dx * sideDir.x + dz * sideDir.y

        const normForward = majorRadius > 0 ? forward / majorRadius : 0
        const normLateral = minorRadius > 0 ? lateral / minorRadius : 0
        const radial = Math.sqrt(normForward * normForward + normLateral * normLateral)
        const planarDistance = Math.hypot(dx, dz)
        const i = r * cols + c

        if (radial <= 1) {
          const t = 1 - radial
          const bowl = smoothstep(0, 1, t)
          if (bowl > 0) {
            const verticalWeight = 0.62 + 0.38 * verticalImpact
            const centerBoost = (0.7 + 0.35 * t) * verticalWeight
            markTouched(r, c)
            heights[i] -= bowl * centerBoost * depthUnits

            if (horizontalRatio > 0.05) {
              const forwardSpan = majorRadius + skidLength * 0.6 + rimHeight * 0.5
              const forwardNorm = clamp(
                (forward + majorRadius * 0.25) / (forwardSpan + 1e-4),
                0,
                1,
              )
              if (forwardNorm > 0) {
                const lateralTightness = 1 - clamp(
                  Math.abs(lateral) /
                    (minorRadius * (0.65 + 0.35 * glancing) + 1e-4),
                  0,
                  1,
                )
                if (lateralTightness > 0) {
                  const plow =
                    Math.pow(forwardNorm, 1.8) * Math.pow(lateralTightness, 1.2)
                  const trenchScale = (0.55 + 0.35 * shockFactor) * (0.6 + 0.4 * glancing)
                  heights[i] -= plow * depthUnits * trenchScale
                }
              }
            }
          }
        }

        if (rimUnits > 0) {
          const rimBand = smoothstep(0.75, 1, radial) - smoothstep(1, 1.6, radial)
          if (rimBand > 0) {
            const rimWeight = 0.48 + 0.32 * verticalImpact
            markTouched(r, c)
            heights[i] += rimBand * rimUnits * rimWeight
          }
        }

        if (skidLength > 0) {
          const skidStart = -majorRadius * 0.25
          const skidEnd = skidLength
          if (forward >= skidStart && forward <= skidEnd) {
            const along = 1 - clamp((forward - skidStart) / (skidEnd - skidStart), 0, 1)
            const lateralFactor = 1 - clamp(Math.abs(lateral) / (minorRadius * 0.9 + 1e-4), 0, 1)
            if (along > 0 && lateralFactor > 0) {
              const gouge = Math.pow(along, 1.25) * Math.pow(lateralFactor, 1.5)
              markTouched(r, c)
              heights[i] -= gouge * depthUnits * (0.7 + 0.35 * glancing)
              if (rimUnits > 0) {
                const berm = Math.pow(along, 1.05) * (1 - Math.pow(lateralFactor, 0.7)) * 0.3
                markTouched(r, c)
                heights[i] += berm * rimUnits * (0.4 + 0.3 * verticalImpact)
              }
            }
          }
        }

        if (glancing > 0.08) {
          const collapseBand = smoothstep(0.55, 1.35, radial)
          if (collapseBand > 0) {
            const forwardNorm = clamp(
              (forward + majorRadius * 0.25) /
                ((majorRadius + skidLength * 0.6 + 1e-4) * 1.1),
              0,
              1,
            )
            if (forwardNorm > 0) {
              const lateralSpread = 1 - clamp(Math.abs(lateral) / (minorRadius * 1.4 + 1e-4), 0, 1)
              const collapseStrength =
                collapseBand * Math.pow(forwardNorm, 1.4) * Math.pow(lateralSpread, 0.9)
              if (collapseStrength > 0) {
                markTouched(r, c)
                heights[i] -= collapseStrength * depthUnits * (0.45 + 0.5 * glancing)
              }
            }
          }
        }

        if (shockFactor > 0 && planarDistance > baseRadius) {
          const shock = 1 - smoothstep(baseRadius, shockOuter, planarDistance)
          if (shock > 0) {
            markTouched(r, c)
            const shockScale = 0.1 + 0.15 * shockFactor + 0.1 * glancing
            heights[i] -= shock * depthUnits * shockScale
          }
        }
      }
    }

    // Mark collider and normals update
    needsColliderUpdateRef.current = true

    if (touched) {
      const padding = 2
      const smoothRowStart = Math.max(0, rowMin - padding)
      const smoothRowEnd = Math.min(rows - 1, rowMax + padding)
      const smoothColStart = Math.max(0, colMin - padding)
      const smoothColEnd = Math.min(cols - 1, colMax + padding)
      const snapshot = heights.slice()
      const smoothingStrength = clamp(0.2 + shockFactor * 0.28 + glancing * 0.38, 0.14, 0.58)
      const compactionRadius = baseRadius + skidLength * 0.6 + rimHeight * 0.5
      const compactionStrength = depthUnits * (0.025 + 0.09 * shockFactor + 0.06 * glancing)

      for (let r = smoothRowStart; r <= smoothRowEnd; r++) {
        const worldX = sampleWorldZ[r]
        const dz = worldX - cz
        for (let c = smoothColStart; c <= smoothColEnd; c++) {
          const worldZ = sampleWorldX[c]
          const dx = worldZ - cx
          const planarDistance = Math.hypot(dx, dz)
          if (planarDistance > influence * 1.1) continue

          const idx = r * cols + c
          let sum = 0
          let count = 0
          for (let dr = -1; dr <= 1; dr++) {
            const rr = r + dr
            if (rr < 0 || rr >= rows) continue
            for (let dc = -1; dc <= 1; dc++) {
              const cc = c + dc
              if (cc < 0 || cc >= cols) continue
              const neighborIdx = rr * cols + cc
              sum += snapshot[neighborIdx]
              count++
            }
          }

          if (count === 0) continue
          const average = sum / count
          const falloff = 1 - clamp(planarDistance / (influence * 1.1), 0, 1)
          const blend = smoothingStrength * falloff
          heights[idx] = THREE.MathUtils.lerp(snapshot[idx], average, blend)

          const compactionFalloff = 1 - clamp(planarDistance / (compactionRadius + 1e-4), 0, 1)
          if (compactionFalloff > 0) {
            heights[idx] -= compactionStrength * compactionFalloff
          }
        }
      }
    }
  }, [sampleWorldX, sampleWorldZ, rows, cols, scaleY])

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

  const applyMeteorImpact = useCallback((impact: MeteorImpact): MeteorImpactResponse | void => {
    const velocity = impact.velocity
    const speed = velocity.length()
    if (speed < 0.1) return

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z)
    const horizontalRatio = speed > 0 ? horizontalSpeed / speed : 0
    const verticalRatio = speed > 0 ? Math.abs(velocity.y) / speed : 1
    const energy = 0.5 * impact.mass * speed * speed
    const energyScale = clamp(Math.cbrt(Math.max(energy, 1) / ENERGY_BASELINE), 0.35, 5)

    const baseRadius = Math.max(
      MIN_CRATER_RADIUS,
      impact.radius * (1.25 + 0.55 * energyScale),
    )
    const baseDepth = Math.max(
      MIN_CRATER_DEPTH,
      impact.radius * (0.36 + 0.28 * energyScale) * (0.7 + 0.3 * verticalRatio),
    )

    const elongation = 1 + horizontalRatio * (1 + 0.45 * energyScale)
    const majorRadius = baseRadius * elongation
    const minorRadius = baseRadius * Math.max(0.5, 1 - 0.32 * horizontalRatio)
    const rimHeight =
      baseDepth * Math.min(0.72, 0.28 + 0.2 * energyScale) * (0.58 + 0.42 * verticalRatio)

    let skidLength = 0
    if (horizontalRatio > SKID_ANGLE_THRESHOLD && horizontalSpeed > 0.2) {
      skidLength =
        (horizontalSpeed * 0.18 + baseRadius * 0.65 * energyScale) *
        (0.8 + 0.2 * horizontalRatio)
      skidLength = Math.min(skidLength, baseRadius * 7.5)
    }

    const craterPosition = impact.position.clone()
    if (horizontalSpeed > 1e-3) {
      const offsetDir = new THREE.Vector3(velocity.x, 0, velocity.z)
      const len = offsetDir.length()
      if (len > 1e-4) {
        offsetDir.divideScalar(len)
        const push = baseRadius * (0.45 + 0.25 * energyScale) * horizontalRatio
        craterPosition.add(offsetDir.multiplyScalar(push))
      }
    }

    const direction =
      horizontalSpeed > 1e-3
        ? new THREE.Vector2(velocity.z, velocity.x)
        : new THREE.Vector2(0, 1)

    const shockFactor = clamp(0.24 + energyScale * 0.22 + horizontalRatio * 0.25, 0.25, 0.85)

    carveCrater({
      position: craterPosition,
      majorRadius,
      minorRadius,
      depth: baseDepth,
      rimHeight,
      skidLength,
      direction,
      shockFactor,
      horizontalRatio,
      verticalRatio,
    })

    const craterNormal = surfaceNormalAt(craterPosition)
    const normalComponent = velocity.dot(craterNormal)
    const tangential = velocity
      .clone()
      .sub(craterNormal.clone().multiplyScalar(normalComponent))
    const tangentialSpeed = tangential.length()
    const horizontalDirection =
      horizontalSpeed > 1e-3
        ? new THREE.Vector3(velocity.x, 0, velocity.z).normalize()
        : new THREE.Vector3(0, 0, 1)

    const skidRatio = skidLength > 0 ? clamp(skidLength / (baseRadius * 5 + 1e-4), 0, 1) : 0
    const craterLoss = clamp(
      0.35 + 0.25 * verticalRatio + 0.2 * shockFactor + 0.15 * skidRatio,
      0.35,
      0.9,
    )
    const plowLoss = clamp(horizontalRatio * (0.25 + 0.25 * energyScale), 0, 0.55)
    const totalLoss = Math.min(0.95, craterLoss + plowLoss)
    const residualEnergy = energy * (1 - totalLoss)
    let residualSpeed = residualEnergy > 0 ? Math.sqrt((2 * residualEnergy) / impact.mass) : 0
    if (!Number.isFinite(residualSpeed)) residualSpeed = 0
    residualSpeed = Math.min(residualSpeed, tangentialSpeed)

    let tangentialVelocity = new THREE.Vector3()
    if (residualSpeed > 0.02) {
      const tangentDir =
        tangentialSpeed > 1e-5 ? tangential.clone().normalize() : horizontalDirection
      tangentialVelocity = tangentDir.multiplyScalar(residualSpeed)
    }

    const embedSpeed = THREE.MathUtils.clamp(
      normalComponent * (0.08 + 0.18 * verticalRatio) -
        (0.4 + 0.25 * shockFactor + 0.3 * horizontalRatio),
      -3.5,
      -0.25,
    )

    const postImpactVelocity = tangentialVelocity
      .clone()
      .add(craterNormal.clone().multiplyScalar(embedSpeed))
      .clampLength(0, speed * 0.6)

    return {
      postImpactVelocity,
      linearDamping: 1.1 + 0.9 * horizontalRatio,
      angularDamping: 1.4 + 0.4 * shockFactor,
      angularVelocityScale: 0.3,
    }
  }, [carveCrater, surfaceNormalAt])

  return (
    <>
      {/* Ground heightfield (physics + visual) */}
      <RigidBody
        type="fixed"
        position={[0, 0, 0]}
        colliders={false}
        name="CraterTerrain"
        friction={1}
        restitution={0.01}
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
        onImpact={applyMeteorImpact}
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
  onImpact,
}: {
  groundName: string
  spawnWidth: number
  spawnDepth: number
  spawnHeight?: number
  numMeteors?: number
  onImpact: (impact: MeteorImpact) => MeteorImpactResponse | void
}) {
  const bodyRefs = useRef<Map<number, RapierRigidBody | null>>(new Map())
  const processingIdsRef = useRef<Set<number>>(new Set())
  const objectIdRef = useRef(0)

  const randomSpawnPosition = useCallback((): [number, number, number] => {
    const x = (Math.random() - 0.5) * spawnWidth
    const z = (Math.random() - 0.5) * spawnDepth
    const y = spawnHeight + Math.random() * 6
    return [x, y, z]
  }, [spawnWidth, spawnDepth, spawnHeight])

  type MeteorTraits = {
    color: string
    radius: number
    density: number
    mass: number
    initialVelocity: THREE.Vector3
    spin: THREE.Vector3
  }

  type Meteor = MeteorTraits & {
    id: number
    position: THREE.Vector3
  }

  const randomMeteorTraits = useCallback((): MeteorTraits => {
    const radius = THREE.MathUtils.lerp(0.18, 0.65, Math.random() ** 0.6)
    const density = THREE.MathUtils.lerp(900, 3200, Math.random() ** 0.7)
    const volume = (4 / 3) * Math.PI * radius * radius * radius
    const mass = density * volume

    const entrySpeed = THREE.MathUtils.lerp(12, 36, Math.random() ** 0.5)
    const angleFromVertical = Math.pow(Math.random(), 1.8) * (Math.PI / 2 * 0.9)
    const azimuth = Math.random() * Math.PI * 2
    const horizontalSpeed = Math.sin(angleFromVertical) * entrySpeed
    const verticalSpeed = Math.cos(angleFromVertical) * entrySpeed

    const vx = Math.cos(azimuth) * horizontalSpeed
    const vz = Math.sin(azimuth) * horizontalSpeed
    const vy = -Math.abs(verticalSpeed)

    const initialVelocity = new THREE.Vector3(vx, vy, vz)
    const spin = new THREE.Vector3(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 6,
    )

    const color = METEOR_COLORS[Math.floor(Math.random() * METEOR_COLORS.length)]

    return { color, radius, density, mass, initialVelocity, spin }
  }, [])

  const computeSpawnPosition = useCallback((traits: MeteorTraits) => {
    let [x, y, z] = randomSpawnPosition()
    const horizontal = new THREE.Vector2(traits.initialVelocity.x, traits.initialVelocity.z)
    const horizontalMag = horizontal.length()
    if (horizontalMag > 1e-3) {
      horizontal.divideScalar(horizontalMag)
      const travelBias = clamp(horizontalMag / 32, 0, 1)
      const halfWidth = spawnWidth / 2
      const halfDepth = spawnDepth / 2
      x = clamp(x - horizontal.x * halfWidth * 0.6 * travelBias, -halfWidth, halfWidth)
      z = clamp(z - horizontal.y * halfDepth * 0.6 * travelBias, -halfDepth, halfDepth)
      y += travelBias * 3
    }
    return new THREE.Vector3(x, y, z)
  }, [randomSpawnPosition, spawnWidth, spawnDepth])

  const createMeteor = useCallback((): Meteor => {
    const traits = randomMeteorTraits()
    const position = computeSpawnPosition(traits)
    const id = ++objectIdRef.current
    return { id, position, ...traits }
  }, [computeSpawnPosition, randomMeteorTraits])

  const [meteors, setMeteors] = useState<Array<Meteor>>(() => {
    const next: Array<Meteor> = []
    for (let i = 0; i < numMeteors; i++) {
      next.push(createMeteor())
    }
    return next
  })
  const meteorsRef = useRef(meteors)
  meteorsRef.current = meteors

  const recycleBody = useCallback(
    (id: number, delayMs = 0) => {
      const execute = () => {
        const rb = bodyRefs.current.get(id)
        if (!rb) {
          processingIdsRef.current.delete(id)
          return
        }
        const traits = randomMeteorTraits()
        const position = computeSpawnPosition(traits)
        setMeteors((prev) =>
          prev.map((meteor) => (meteor.id === id ? { ...meteor, position, ...traits } : meteor)),
        )
        try {
          rb.setTranslation({ x: position.x, y: position.y, z: position.z }, true)
          rb.setLinvel(
            {
              x: traits.initialVelocity.x,
              y: traits.initialVelocity.y,
              z: traits.initialVelocity.z,
            },
            true,
          )
          rb.setAngvel({ x: traits.spin.x, y: traits.spin.y, z: traits.spin.z }, true)
          rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
          rb.setLinearDamping(BASE_LINEAR_DAMPING)
          rb.setAngularDamping(BASE_ANGULAR_DAMPING)
          rb.enableCcd(true)
        } catch {}
        setTimeout(() => {
          processingIdsRef.current.delete(id)
        }, 10)
      }

      if (delayMs > 0) {
        setTimeout(execute, delayMs)
      } else {
        execute()
      }
    },
    [computeSpawnPosition, randomMeteorTraits],
  )

  const handleCollisionEnter = useCallback((id: number, event: CollisionEnterPayload) => {
    if (processingIdsRef.current.has(id)) return
    const otherName = event.other?.rigidBodyObject?.name
    if (otherName !== groundName) return

    const rb = event.target.rigidBody
    if (!rb) return
    const meteor = meteorsRef.current.find((m) => m.id === id)
    if (!meteor) return

    const translation = rb.translation()
    const linvel = rb.linvel()
    if (!translation || !linvel) return

    processingIdsRef.current.add(id)

    const position = new THREE.Vector3(translation.x, translation.y, translation.z)
    const velocity = new THREE.Vector3(linvel.x, linvel.y, linvel.z)

    const response = onImpact({ position, radius: meteor.radius, mass: meteor.mass, velocity })
    if (response && rb) {
      if (response.postImpactVelocity) {
        const next = response.postImpactVelocity
        rb.setLinvel({ x: next.x, y: next.y, z: next.z }, true)
      }
      if (response.angularVelocityScale !== undefined) {
        const angvel = rb.angvel()
        if (angvel) {
          rb.setAngvel(
            {
              x: angvel.x * response.angularVelocityScale,
              y: angvel.y * response.angularVelocityScale,
              z: angvel.z * response.angularVelocityScale,
            },
            true,
          )
        }
      }
      if (response.linearDamping !== undefined) {
        rb.setLinearDamping(response.linearDamping)
      }
      if (response.angularDamping !== undefined) {
        rb.setAngularDamping(response.angularDamping)
      }
    }

    recycleBody(id, IMPACT_RESPAWN_DELAY)
  }, [groundName, onImpact, recycleBody])

  useFrame(() => {
    bodyRefs.current.forEach((rb, id) => {
      if (!rb || processingIdsRef.current.has(id)) return
      const translation = rb.translation()
      if (!translation) return
      if (translation.y < RESPAWN_Y_THRESHOLD) {
        processingIdsRef.current.add(id)
        recycleBody(id)
      }
    })
  })

  return (
    <>
      {meteors.map((m) => (
        <RigidBody
          key={m.id}
          type="dynamic"
          position={m.position}
          colliders={false}
          canSleep={false}
          density={m.density}
          ref={(rb) => {
            bodyRefs.current.set(m.id, rb as unknown as RapierRigidBody)
            if (rb) {
              try {
                rb.setLinvel(
                  { x: m.initialVelocity.x, y: m.initialVelocity.y, z: m.initialVelocity.z },
                  true,
                )
                rb.setAngvel({ x: m.spin.x, y: m.spin.y, z: m.spin.z }, true)
                rb.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
                rb.setLinearDamping(BASE_LINEAR_DAMPING)
                rb.setAngularDamping(BASE_ANGULAR_DAMPING)
                rb.enableCcd(true)
              } catch {}
            }
          }}
          onCollisionEnter={(event) => handleCollisionEnter(m.id, event)}
          name={`Meteor-${m.id}`}
          friction={1}
          restitution={0.01}
          linearDamping={BASE_LINEAR_DAMPING}
          angularDamping={BASE_ANGULAR_DAMPING}
        >
          <BallCollider args={[m.radius]} />
          <mesh castShadow>
            <sphereGeometry args={[m.radius, 16, 16]} />
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


