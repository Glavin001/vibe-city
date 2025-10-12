import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import type { Vec3 } from '../../lib/bunker-world'

export function FacingArrow({ origin, yaw, length = 1.5, color = '#22d3ee' }: { 
  origin: Vec3
  yaw: number
  length?: number
  color?: string 
}) {
  const forward = useMemo(() => {
    const dir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return dir
  }, [yaw])
  
  const end: Vec3 = useMemo(() => [
    origin[0] + forward.x * length, 
    origin[1], 
    origin[2] + forward.z * length
  ], [origin, forward, length])
  
  return <Line points={[origin, end]} color={color} lineWidth={2} dashed={false} />
}

