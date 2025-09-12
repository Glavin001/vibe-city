'use client'

import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Geometry, Base, Subtraction } from '@react-three/csg'
import type { Vec3 } from './bunker-world'

export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      <meshStandardMaterial color="#1f2937" />
    </mesh>
  )
}

export function BoxMarker({ position, color = '#34495e', label }: { position: Vec3; color?: string; label: string }) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2, 0.4, 2]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <LabelSprite position={[0, 0.9, 0]} text={label} />
    </group>
  )
}

export function AgentMesh({ getPos }: { getPos: () => Vec3 }) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame(() => {
    const [x, y, z] = getPos()
    ref.current.position.set(x, y, z)
  })
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.35, 24, 24]} />
      <meshStandardMaterial color="#4ade80" />
    </mesh>
  )
}

export function LabelSprite({ position, text, color = '#ffffff', bg = 'rgba(0,0,0,0.55)' }: { position: Vec3; text: string; color?: string; bg?: string }) {
  const textureRef = useRef<THREE.CanvasTexture | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [scale, setScale] = useState<[number, number, number]>([2.4, 0.6, 1])

  if (textureRef.current == null) {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 128
    canvasRef.current = canvas
    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.needsUpdate = true
    textureRef.current = tex
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const lines = String(text ?? '').split('\n')
    if (lines.length <= 1) {
      // Single-line label: use fixed, readable size like before
      const fixedWidth = 512
      const fixedHeight = 128
      if (canvas.width !== fixedWidth || canvas.height !== fixedHeight) {
        canvas.width = fixedWidth
        canvas.height = fixedHeight
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = color
      ctx.font = 'bold 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(lines[0] || '', canvas.width / 2, canvas.height / 2 + 6)
      textureRef.current!.needsUpdate = true
      setScale([2.4, 0.6, 1])
    } else {
      // Multi-line action step label: dynamic sizing
      const fontSize = 48
      const lineHeight = Math.floor(fontSize * 1.25)
      const padX = 32
      const padY = 24
      ctx.font = `bold ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
      const maxLineWidth = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
      const nextWidth = Math.min(2048, Math.max(256, Math.ceil(maxLineWidth + padX * 2)))
      const nextHeight = Math.min(1024, Math.max(128, Math.ceil(lines.length * lineHeight + padY * 2)))
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth
        canvas.height = nextHeight
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      let y = padY
      for (const l of lines) {
        ctx.fillText(l, canvas.width / 2, y)
        y += lineHeight
      }
      textureRef.current!.needsUpdate = true
      const desiredHeight = Math.min(1.6, 0.7 + Math.max(0, lines.length - 1) * 0.14)
      const aspect = canvas.width / canvas.height
      const desiredWidth = desiredHeight * aspect
      setScale([desiredWidth, desiredHeight, 1])
    }
  }, [text, color, bg])

  useEffect(() => () => textureRef.current?.dispose(), [])

  return (
    <sprite position={position} scale={scale}>
      <spriteMaterial map={textureRef.current!} transparent depthWrite={false} />
    </sprite>
  )
}

type Face = 'north' | 'south' | 'east' | 'west'

export function Building({
  center,
  size,
  color = '#4b5563',
  label,
  doorFace,
  doorSize,
  doorColor = '#a78bfa',
  showDoor = true,
  opacity = 1,
  debug = false,
}: {
  center: Vec3
  size: [number, number, number]
  color?: string
  label: string
  doorFace: Face
  doorSize: [number, number]
  doorColor?: string
  showDoor?: boolean
  opacity?: number
  debug?: boolean
}) {
  const [dx, dy, dz] = size
  const wallThickness = 0.2
  const doorThickness = 0.15

  function getDoorGeometry(face: Face): { position: Vec3; rotation: [number, number, number] } {
    const surfaceOffset = wallThickness / 2 + 0.01
    const y = -dy / 2 + doorSize[1] / 2
    switch (face) {
      case 'east':
        return { position: [dx / 2 + surfaceOffset, y, 0], rotation: [0, Math.PI / 2, 0] }
      case 'west':
        return { position: [-dx / 2 - surfaceOffset, y, 0], rotation: [0, Math.PI / 2, 0] }
      case 'south':
        return { position: [0, y, dz / 2 + surfaceOffset], rotation: [0, 0, 0] }
      case 'north':
      default:
        return { position: [0, y, -dz / 2 - surfaceOffset], rotation: [0, 0, 0] }
    }
  }

  const doorGeom = getDoorGeometry(doorFace)
  const isOpen = !showDoor

  const debugColors = {
    floor: '#ff9500',
    roof: '#8e44ad',
    north: '#e74c3c',
    south: '#3498db',
    east: '#2ecc71',
    west: '#f1c40f',
  }
  const floorColor = debugColors.floor

  return (
    <group position={[center[0], dy / 2, center[2]]}>
      <mesh position={[0, -dy / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[dx, wallThickness, dz]} />
        <meshStandardMaterial color={debug ? debugColors.floor : floorColor} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, dy / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[dx, wallThickness, dz]} />
        <meshStandardMaterial color={debug ? debugColors.roof : color} transparent opacity={opacity} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0, -(dz / 2 - wallThickness / 2)]}>
        <Geometry>
          <Base>
            <boxGeometry args={[dx, dy, wallThickness]} />
          </Base>
          {doorFace === 'north' && isOpen && (
            <Subtraction position={[0, -dy / 2 + doorSize[1] / 2, 0]}>
              <boxGeometry args={[doorSize[0], doorSize[1], wallThickness + 0.1]} />
            </Subtraction>
          )}
        </Geometry>
        <meshStandardMaterial color={debug ? debugColors.north : color} transparent opacity={opacity} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 0, dz / 2 - wallThickness / 2]}>
        <Geometry>
          <Base>
            <boxGeometry args={[dx, dy, wallThickness]} />
          </Base>
          {doorFace === 'south' && isOpen && (
            <Subtraction position={[0, -dy / 2 + doorSize[1] / 2, 0]}>
              <boxGeometry args={[doorSize[0], doorSize[1], wallThickness + 0.1]} />
            </Subtraction>
          )}
        </Geometry>
        <meshStandardMaterial color={debug ? debugColors.south : color} transparent opacity={opacity} />
      </mesh>
      <mesh castShadow receiveShadow position={[dx / 2 - wallThickness / 2, 0, 0]}>
        <Geometry>
          <Base>
            <boxGeometry args={[wallThickness, dy, dz - wallThickness]} />
          </Base>
          {doorFace === 'east' && isOpen && (
            <Subtraction position={[0, -dy / 2 + doorSize[1] / 2, 0]}>
              <boxGeometry args={[wallThickness + 0.1, doorSize[1], doorSize[0]]} />
            </Subtraction>
          )}
        </Geometry>
        <meshStandardMaterial color={debug ? debugColors.east : color} transparent opacity={opacity} />
      </mesh>
      <mesh castShadow receiveShadow position={[-(dx / 2 - wallThickness / 2), 0, 0]}>
        <Geometry>
          <Base>
            <boxGeometry args={[wallThickness, dy, dz - wallThickness]} />
          </Base>
          {doorFace === 'west' && isOpen && (
            <Subtraction position={[0, -dy / 2 + doorSize[1] / 2, 0]}>
              <boxGeometry args={[wallThickness + 0.1, doorSize[1], doorSize[0]]} />
            </Subtraction>
          )}
        </Geometry>
        <meshStandardMaterial color={debug ? debugColors.west : color} transparent opacity={opacity} />
      </mesh>
      {showDoor && (
        <mesh position={doorGeom.position} rotation={doorGeom.rotation} castShadow>
          <boxGeometry args={[doorSize[0], doorSize[1], doorThickness]} />
          <meshStandardMaterial color={doorColor} metalness={0.3} roughness={0.7} />
        </mesh>
      )}
      {showDoor && (
        <group position={doorGeom.position} rotation={doorGeom.rotation}>
          <mesh castShadow>
            <boxGeometry args={[doorSize[0] + 0.1, doorSize[1] + 0.1, doorThickness * 0.5]} />
            <meshStandardMaterial color="#2d3748" metalness={0.5} roughness={0.3} />
          </mesh>
        </group>
      )}
      <LabelSprite position={[0, dy / 2 + 0.6, 0]} text={label} />
    </group>
  )
}

export function SmallSphere({ position, color = 'gold', visible = true, size = 0.18 }: { position: Vec3; color?: string; visible?: boolean; size?: number }) {
  if (!visible) return null
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[size, 16, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
    </mesh>
  )
}

export function EnhancedObject({ position, color, type, visible = true, size = 0.25 }: { position: Vec3; color: string; type: 'key' | 'c4' | 'star'; visible?: boolean; size?: number; }) {
  if (!visible) return null
  return (
    <group position={position}>
      <mesh castShadow>
        <sphereGeometry args={[size, 20, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} metalness={type === 'key' ? 0.8 : 0.2} roughness={type === 'key' ? 0.2 : 0.4} />
      </mesh>
      <mesh>
        <sphereGeometry args={[size * 1.3, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1} transparent opacity={0.3} />
      </mesh>
      <AnimatedFloat yOffset={0.1} speed={2}>
        <mesh position={[0, 0.05, 0]}>
          <sphereGeometry args={[size * 0.7, 8, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} transparent opacity={0.6} />
        </mesh>
      </AnimatedFloat>
    </group>
  )
}

export function AnimatedFloat({ children, yOffset = 0.1, speed = 1 }: { children: React.ReactNode; yOffset?: number; speed?: number }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame((state) => {
    if (ref.current) {
      ref.current.position.y = Math.sin(state.clock.elapsedTime * speed) * yOffset
      ref.current.rotation.y = state.clock.elapsedTime * 0.5
    }
  })
  return <group ref={ref}>{children}</group>
}

export function InventoryItem({ agentPos, type, color, index, size = 0.15 }: { agentPos: Vec3; type: 'key' | 'c4' | 'star'; color: string; index: number; size?: number; }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame((state) => {
    if (ref.current) {
      const angle = (index * Math.PI * 2) / 3 + state.clock.elapsedTime * 0.5
      const radius = 0.8
      const height = 1.8 + Math.sin(state.clock.elapsedTime * 2 + index) * 0.1
      ref.current.position.set(
        agentPos[0] + Math.cos(angle) * radius,
        agentPos[1] + height,
        agentPos[2] + Math.sin(angle) * radius
      )
    }
  })
  return (
    <group ref={ref}>
      <mesh castShadow>
        <sphereGeometry args={[size, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} metalness={type === 'key' ? 0.8 : 0.2} roughness={type === 'key' ? 0.2 : 0.4} />
      </mesh>
      <mesh>
        <sphereGeometry args={[size * 1.2, 8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} transparent opacity={0.4} />
      </mesh>
    </group>
  )
}

export function PickupAnimation({ animation, onComplete }: { animation: { active: boolean; startPos: Vec3; endPos: Vec3; startTime: number; duration: number; type: 'key' | 'c4' | 'star'; color: string; }; onComplete: () => void; }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame(() => {
    if (!animation.active || !ref.current) return
    const now = performance.now()
    const elapsed = now - animation.startTime
    const progress = Math.min(elapsed / animation.duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    const start = new THREE.Vector3(...animation.startPos)
    const end = new THREE.Vector3(...animation.endPos)
    const mid = start.clone().lerp(end, 0.5)
    mid.y += 1.5
    let currentPos: THREE.Vector3
    if (eased < 0.5) currentPos = start.clone().lerp(mid, eased * 2)
    else currentPos = mid.clone().lerp(end, (eased - 0.5) * 2)
    ref.current.position.copy(currentPos)
    ref.current.scale.setScalar(1 - eased * 0.3)
    if (progress >= 1) onComplete()
  })
  if (!animation.active) return null
  return (
    <group ref={ref}>
      <mesh castShadow>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshStandardMaterial color={animation.color} emissive={animation.color} emissiveIntensity={0.6} />
      </mesh>
    </group>
  )
}


