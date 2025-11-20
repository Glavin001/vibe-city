import * as THREE from "three";

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

export function createGrassGeometry({
  segments,
  numInstances,
  patchSize,
  seed = 42,
}: {
  segments: number;
  numInstances: number;
  patchSize: number;
  seed?: number;
}) {
  const vertices = (segments + 1) * 2;
  const indices = new Uint16Array(segments * 12);

  for (let i = 0; i < segments; i++) {
    const vi = i * 2;
    const indexOffset = i * 12;
    indices[indexOffset + 0] = vi + 0;
    indices[indexOffset + 1] = vi + 1;
    indices[indexOffset + 2] = vi + 2;

    indices[indexOffset + 3] = vi + 2;
    indices[indexOffset + 4] = vi + 1;
    indices[indexOffset + 5] = vi + 3;

    const fi = vertices + vi;
    indices[indexOffset + 6] = fi + 2;
    indices[indexOffset + 7] = fi + 1;
    indices[indexOffset + 8] = fi + 0;

    indices[indexOffset + 9] = fi + 3;
    indices[indexOffset + 10] = fi + 1;
    indices[indexOffset + 11] = fi + 2;
  }

  const vertIndex = new Uint8Array(vertices * 2);
  for (let i = 0; i < vertIndex.length; i++) {
    vertIndex[i] = i;
  }

  const offsets = new Float32Array(numInstances * 3);
  const random = mulberry32(seed);
  for (let i = 0; i < numInstances; i++) {
    const x = (random() - 0.5) * patchSize;
    const z = (random() - 0.5) * patchSize;
    offsets[i * 3 + 0] = x;
    offsets[i * 3 + 1] = 0;
    offsets[i * 3 + 2] = z;
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.instanceCount = numInstances;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("vertIndex", new THREE.Uint8BufferAttribute(vertIndex, 1));
  geometry.setAttribute("position", new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1 + patchSize * 2);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-patchSize * 0.5, -patchSize, -patchSize * 0.5),
    new THREE.Vector3(patchSize * 0.5, patchSize, patchSize * 0.5),
  );

  return geometry;
}
