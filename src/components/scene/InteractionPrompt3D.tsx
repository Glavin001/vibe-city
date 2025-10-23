import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Vec3 } from '@/lib/bunker-world'

export function InteractionPrompt3D({ 
  text, 
  target, 
  onActivate, 
  visible = true 
}: { 
  text: string
  target: Vec3 | null
  onActivate?: () => void
  visible?: boolean 
}) {
  const groupRef = useRef<THREE.Group | null>(null)
  const camera = useThree((s) => s.camera)
  const cleanText = useMemo(() => (text || '').replace(/^\s*press\s*[eE]\s*to\s*/i, ''), [text])

  useEffect(() => {
    function tick() {
      if (!groupRef.current || !target || !visible) return
      const cam = camera.position
      const t = new THREE.Vector3(target[0], target[1], target[2])
      const dirToTarget = new THREE.Vector3().copy(t).sub(cam)
      const dist = dirToTarget.length() || 1
      dirToTarget.normalize()
      const nudge = Math.min(0.5, Math.max(0.18, dist * 0.06))
      const pos = new THREE.Vector3().copy(t).addScaledVector(dirToTarget, -nudge)
      pos.y += 0.2
      groupRef.current.position.copy(pos)
    }
    const id = setInterval(tick, 16)
    return () => clearInterval(id)
  }, [camera, target, visible])

  if (!visible || !target) return null
  return (
    <group ref={groupRef}>
      <Html sprite center distanceFactor={8} style={{ pointerEvents: 'auto', transform: 'translateZ(0) scale(0.78)' }}>
        <button
          type="button"
          onClick={() => onActivate?.()}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/70 text-gray-100 border border-white/10 shadow-md backdrop-blur-sm max-w-[180px] whitespace-normal"
        >
          <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-200 border border-white/10 text-[10px] leading-none">E</span>
          <span className="text-[11px] leading-tight">{cleanText || 'Interact'}</span>
        </button>
      </Html>
    </group>
  )
}


