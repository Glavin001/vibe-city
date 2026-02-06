import * as THREE from "three";
import { createNoise2D } from "simplex-noise";

export interface HeightmapData {
  size: number;
  dims: number;
  height: number;
  offset: number;
  texture: THREE.DataTexture;
  getHeight: (x: number, z: number) => number;
}

function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createHeightmapData({
  size = 256,
  dims = 300,
  height = 14,
  offset = height * 0.5,
  seed = 1337,
}: {
  size?: number;
  dims?: number;
  height?: number;
  offset?: number;
  seed?: number;
} = {}): HeightmapData {
  const random = mulberry32(seed);
  const noise2D = createNoise2D(random);
  const data = new Float32Array(size * size);
  const textureData = new Uint8Array(size * size * 4);

  const octaveWeights = [1, 0.5, 0.25, 0.125];
  let maxWeight = 0;
  for (const w of octaveWeights) maxWeight += w;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let value = 0;
      let frequency = 1;
      for (const weight of octaveWeights) {
        const n = noise2D(u * frequency, v * frequency) * 0.5 + 0.5;
        value += n * weight;
        frequency *= 2;
      }
      value /= maxWeight;
      const idx = y * size + x;
      data[idx] = value;
      const byte = Math.floor(THREE.MathUtils.clamp(value, 0, 1) * 255);
      const offsetIdx = idx * 4;
      textureData[offsetIdx + 0] = byte;
      textureData[offsetIdx + 1] = byte;
      textureData[offsetIdx + 2] = byte;
      textureData[offsetIdx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(textureData, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;

  const getHeight = (x: number, z: number) => {
    const xn = THREE.MathUtils.clamp((x + dims * 0.5) / dims, 0, 1);
    const zn = THREE.MathUtils.clamp((z + dims * 0.5) / dims, 0, 1);

    const px = xn * (size - 1);
    const py = (1 - zn) * (size - 1);

    const x1 = Math.floor(px);
    const x2 = Math.min(x1 + 1, size - 1);
    const y1 = Math.floor(py);
    const y2 = Math.min(y1 + 1, size - 1);

    const fx = px - x1;
    const fy = py - y1;

    const idx11 = y1 * size + x1;
    const idx12 = y2 * size + x1;
    const idx21 = y1 * size + x2;
    const idx22 = y2 * size + x2;

    const v11 = data[idx11];
    const v21 = data[idx21];
    const v12 = data[idx12];
    const v22 = data[idx22];

    const top = THREE.MathUtils.lerp(v11, v21, fx);
    const bottom = THREE.MathUtils.lerp(v12, v22, fx);
    const value = THREE.MathUtils.lerp(top, bottom, fy);

    return value * height - offset;
  };

  return {
    size,
    dims,
    height,
    offset,
    texture,
    getHeight,
  };
}
