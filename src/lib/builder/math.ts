import { Euler, Quaternion, Vector3 } from "three";
import type { Transform } from "./model";

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function toQuaternion(quat: Transform["rotationQuat"]): Quaternion {
  const [x, y, z, w] = quat;
  return new Quaternion(x, y, z, w);
}

export function toVector(vec: Transform["position"]): Vector3 {
  const [x, y, z] = vec;
  return new Vector3(x, y, z);
}

export function transformPoint(
  transform: Transform,
  localPoint: [number, number, number],
): Vector3 {
  const point = toVector(localPoint);
  return point.applyQuaternion(toQuaternion(transform.rotationQuat)).add(
    toVector(transform.position),
  );
}

export function transformQuaternion(
  transform: Transform,
  localRotation: [number, number, number, number],
): Quaternion {
  const parent = toQuaternion(transform.rotationQuat);
  const child = toQuaternion(localRotation);
  return parent.multiply(child);
}

export function multiplyTransforms(
  parent: Transform,
  child: Transform,
): Transform {
  const position = transformPoint(parent, child.position);
  const rotation = transformQuaternion(parent, child.rotationQuat);
  return {
    position: [position.x, position.y, position.z],
    rotationQuat: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

export function quaternionToEuler(quat: Transform["rotationQuat"]): [number, number, number] {
  const q = toQuaternion(quat);
  const euler = new Euler().setFromQuaternion(q, "XYZ");
  return [euler.x, euler.y, euler.z];
}

export function eulerToQuaternion(euler: [number, number, number]): Transform["rotationQuat"] {
  const [x, y, z] = euler;
  const q = new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"));
  return [q.x, q.y, q.z, q.w];
}

export function vectorToArray(vec: Vector3): [number, number, number] {
  return [vec.x, vec.y, vec.z];
}

export function quaternionToArray(q: Quaternion): [number, number, number, number] {
  return [q.x, q.y, q.z, q.w];
}
