import { RigidBody, CuboidCollider } from '@react-three/rapier'
import type { BuildingConfig } from '../../lib/bunker-world'

export function BuildingColliders({ config, wallThickness = 0.25 }: { config: BuildingConfig; wallThickness?: number }) {
  const { center, size, doorFace, doorSize } = config
  const [dx, dy, dz] = size
  const hx = dx / 2
  const hy = dy / 2
  const hz = dz / 2
  const t = wallThickness
  const [doorWidth, doorHeight] = doorSize

  // Helper to create wall segments with door opening
  const createWallWithDoor = (face: 'north' | 'south' | 'east' | 'west') => {
    const hasDoor = doorFace === face
    
    if (face === 'north' || face === 'south') {
      const zPos = face === 'north' ? -(hz - t / 2) : (hz - t / 2)
      
      if (!hasDoor) {
        // Solid wall (no door)
        return <CuboidCollider key={face} args={[hx, hy, t / 2]} position={[0, hy, zPos]} />
      }
      
      // Wall with door opening: create segments above and to sides of door
      const doorHalfWidth = doorWidth / 2
      const sideWallWidth = (dx - doorWidth) / 2
      
      return (
        <>
          {/* Left wall segment */}
          {sideWallWidth > 0.1 && (
            <CuboidCollider
              key={`${face}-left`}
              args={[sideWallWidth / 2, hy, t / 2]}
              position={[-(hx - sideWallWidth / 2), hy, zPos]}
            />
          )}
          {/* Right wall segment */}
          {sideWallWidth > 0.1 && (
            <CuboidCollider
              key={`${face}-right`}
              args={[sideWallWidth / 2, hy, t / 2]}
              position={[hx - sideWallWidth / 2, hy, zPos]}
            />
          )}
          {/* Top wall segment above door */}
          {doorHeight < dy - 0.1 && (
            <CuboidCollider
              key={`${face}-top`}
              args={[doorHalfWidth, (dy - doorHeight) / 2, t / 2]}
              position={[0, doorHeight + (dy - doorHeight) / 2, zPos]}
            />
          )}
        </>
      )
    } else {
      // East or West wall
      const xPos = face === 'east' ? (hx - t / 2) : -(hx - t / 2)
      
      if (!hasDoor) {
        // Solid wall (no door)
        return <CuboidCollider key={face} args={[t / 2, hy, hz - t]} position={[xPos, hy, 0]} />
      }
      
      // Wall with door opening
      const doorHalfWidth = doorWidth / 2
      const sideWallDepth = (dz - doorWidth) / 2
      
      return (
        <>
          {/* Front wall segment */}
          {sideWallDepth > 0.1 && (
            <CuboidCollider
              key={`${face}-front`}
              args={[t / 2, hy, sideWallDepth / 2]}
              position={[xPos, hy, -(hz - t - sideWallDepth / 2)]}
            />
          )}
          {/* Back wall segment */}
          {sideWallDepth > 0.1 && (
            <CuboidCollider
              key={`${face}-back`}
              args={[t / 2, hy, sideWallDepth / 2]}
              position={[xPos, hy, hz - t - sideWallDepth / 2]}
            />
          )}
          {/* Top wall segment above door */}
          {doorHeight < dy - 0.1 && (
            <CuboidCollider
              key={`${face}-top`}
              args={[t / 2, (dy - doorHeight) / 2, doorHalfWidth]}
              position={[xPos, doorHeight + (dy - doorHeight) / 2, 0]}
            />
          )}
        </>
      )
    }
  }

  return (
    <RigidBody type="fixed" position={[center[0], 0, center[2]]} colliders={false}>
      {createWallWithDoor('north')}
      {createWallWithDoor('south')}
      {createWallWithDoor('east')}
      {createWallWithDoor('west')}
    </RigidBody>
  )
}

