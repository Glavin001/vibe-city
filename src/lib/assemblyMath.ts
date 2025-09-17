import { Euler, Quaternion, Vector3 } from 'three'
import type { Transform } from '../types/assembly'

export const IDENTITY_QUAT: [number, number, number, number] = [0, 0, 0, 1]

export const degToRad = (deg: number) => (deg * Math.PI) / 180
export const radToDeg = (rad: number) => (rad * 180) / Math.PI

export const quatArrayToQuaternion = (quat: [number, number, number, number]) => {
  const [x, y, z, w] = quat
  return new Quaternion(x, y, z, w)
}

export const quaternionToArray = (quat: Quaternion): [number, number, number, number] => [
  quat.x,
  quat.y,
  quat.z,
  quat.w,
]

export const transformPoint = (transform: Transform, localPoint: [number, number, number]) => {
  const quat = quatArrayToQuaternion(transform.rotationQuat)
  const worldPos = new Vector3().fromArray(localPoint).applyQuaternion(quat)
  worldPos.add(new Vector3().fromArray(transform.position))
  return worldPos
}

export const multiplyTransforms = (a: Transform, b: Transform): Transform => {
  const qa = quatArrayToQuaternion(a.rotationQuat)
  const qb = quatArrayToQuaternion(b.rotationQuat)
  const combinedQuat = qa.clone().multiply(qb)
  const rotatedPosition = new Vector3().fromArray(b.position).applyQuaternion(qa)
  const combinedPosition = rotatedPosition.add(new Vector3().fromArray(a.position))
  return {
    position: [combinedPosition.x, combinedPosition.y, combinedPosition.z],
    rotationQuat: [combinedQuat.x, combinedQuat.y, combinedQuat.z, combinedQuat.w],
  }
}

export const quatToEulerDeg = (quat: [number, number, number, number]): [number, number, number] => {
  const q = quatArrayToQuaternion(quat)
  const euler = new Euler().setFromQuaternion(q, 'XYZ')
  return [radToDeg(euler.x), radToDeg(euler.y), radToDeg(euler.z)]
}

export const eulerDegToQuat = (eulerDeg: [number, number, number]): [number, number, number, number] => {
  const [x, y, z] = eulerDeg
  const euler = new Euler(degToRad(x), degToRad(y), degToRad(z), 'XYZ')
  const quat = new Quaternion().setFromEuler(euler)
  return [quat.x, quat.y, quat.z, quat.w]
}

export const normalizeQuat = (quat: [number, number, number, number]): [number, number, number, number] => {
  const q = quatArrayToQuaternion(quat)
  q.normalize()
  return [q.x, q.y, q.z, q.w]
}

export const quatToEulerRad = (quat: [number, number, number, number]): [number, number, number] => {
  const q = quatArrayToQuaternion(quat)
  const euler = new Euler().setFromQuaternion(q, 'XYZ')
  return [euler.x, euler.y, euler.z]
}

export const rotateVectorByQuat = (
  vector: [number, number, number],
  quat: [number, number, number, number],
): [number, number, number] => {
  const q = quatArrayToQuaternion(quat)
  const result = new Vector3().fromArray(vector).applyQuaternion(q)
  return [result.x, result.y, result.z]
}

export const ensureQuaternionNormalized = (
  quat: [number, number, number, number],
): [number, number, number, number] => {
  const q = quatArrayToQuaternion(quat)
  if (Math.abs(q.lengthSq() - 1) < 1e-5) {
    return quat
  }
  q.normalize()
  return [q.x, q.y, q.z, q.w]
}

export const vectorToArray = (vector: Vector3): [number, number, number] => [vector.x, vector.y, vector.z]
