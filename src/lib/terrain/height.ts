import * as THREE from "three";
import { createNoise2D } from "simplex-noise";

export function createMulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Single, deterministic noise function for ground and grass sampling
const rng = createMulberry32(123456789);
const noise2D = createNoise2D(rng);

export function getTerrainHeight(x: number, z: number) {
  let y = 2 * noise2D(x / 50, z / 50);
  y += 4 * noise2D(x / 100, z / 100);
  y += 0.2 * noise2D(x / 10, z / 10);
  return y;
}

export function makeGroundGeometry(width: number, segments: number, origin: THREE.Vector2) {
  const geo = new THREE.PlaneGeometry(width, width, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + origin.x;
    const z = pos.getZ(i) + origin.y;
    const y = getTerrainHeight(x, z);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}



