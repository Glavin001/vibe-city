/**
 * Rotates a 3D vector by a quaternion.
 * Implements quaternion rotation: v' = q * v * q^-1
 *
 * @param vec - The 3D vector to rotate [x, y, z]
 * @param quat - The quaternion rotation {x, y, z, w}
 * @returns The rotated vector [x, y, z]
 */
export function rotateVectorByQuaternion(
  vec: [number, number, number],
  quat: { x: number; y: number; z: number; w: number },
): [number, number, number] {
  const [lx, ly, lz] = vec;
  const { x: qx, y: qy, z: qz, w: qw } = quat;

  // Quaternion rotation: v' = q * v * q^-1
  // q * v
  const tx = qw * lx + qy * lz - qz * ly;
  const ty = qw * ly + qz * lx - qx * lz;
  const tz = qw * lz + qx * ly - qy * lx;
  const tw = -qx * lx - qy * ly - qz * lz;

  // (q * v) * q^-1 where q^-1 = conjugate
  const rx = tw * -qx + tx * qw + ty * -qz - tz * -qy;
  const ry = tw * -qy + ty * qw + tz * -qx - tx * -qz;
  const rz = tw * -qz + tz * qw + tx * -qy - ty * -qx;

  return [rx, ry, rz];
}
