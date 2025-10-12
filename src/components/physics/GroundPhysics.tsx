import { RigidBody, CuboidCollider } from '@react-three/rapier'

export function GroundPhysics() {
  // Large static ground plane collider
  return (
    <RigidBody type="fixed" colliders={false} position={[0, 0, 0]}>
      <CuboidCollider args={[60, 0.05, 60]} position={[0, -0.05, 0]} />
    </RigidBody>
  )
}

