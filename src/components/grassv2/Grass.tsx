"use client";

import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { ThreeElements } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { createNoise2D } from "simplex-noise";
import "./GrassMaterial";

type GrassOptions = {
  bW?: number;
  bH?: number;
  joints?: number;
};

export function Grass({
  options = { bW: 0.12, bH: 1, joints: 5 },
  width = 60,
  instances = 80_000,
  ...props
}: {
  options?: GrassOptions;
  width?: number;
  instances?: number;
} & ThreeElements["group"]) {
  const { bW = 0.12, bH = 1, joints = 5 } = options;
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  const { offsets, orientations, stretches, halfRootAngleSin, halfRootAngleCos } = useMemo(
    () => getAttributeData(instances, width),
    [instances, width],
  );

  const baseGeom = useMemo(() => {
    const g = new THREE.PlaneGeometry(bW, bH, 1, joints);
    g.translate(0, bH / 2, 0);
    return g;
  }, [bW, bH, joints]);

  const groundGeo = useMemo(() => makeGroundGeometry(width, 48), [width]);

  const { diffuseTexture, alphaTexture } = useMemo(() => createBladeTextures(), []);

  useFrame((state) => {
    if (materialRef.current) materialRef.current.uniforms.time.value = state.clock.elapsedTime / 4;
  });

  return (
    <group {...props}>
      <mesh frustumCulled>
        {/* Base blade geometry with per-instance attributes */}
        <instancedBufferGeometry
          index={baseGeom.index}
          attributes-position={baseGeom.attributes.position}
          attributes-uv={baseGeom.attributes.uv}
          instanceCount={instances}
        >
          <instancedBufferAttribute attach={"attributes-offset"} args={[offsets, 3]} />
          <instancedBufferAttribute attach={"attributes-orientation"} args={[orientations, 4]} />
          <instancedBufferAttribute attach={"attributes-stretch"} args={[stretches, 1]} />
          <instancedBufferAttribute attach={"attributes-halfRootAngleSin"} args={[halfRootAngleSin, 1]} />
          <instancedBufferAttribute attach={"attributes-halfRootAngleCos"} args={[halfRootAngleCos, 1]} />
        </instancedBufferGeometry>
        <grassMaterial ref={materialRef} map={diffuseTexture} alphaMap={alphaTexture} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0]} geometry={groundGeo} receiveShadow>
        <meshStandardMaterial color="#0a2a0a" />
      </mesh>
    </group>
  );
}

function getAttributeData(instances: number, width: number) {
  const offsets = new Float32Array(instances * 3);
  const orientations = new Float32Array(instances * 4);
  const stretches = new Float32Array(instances);
  const halfRootAngleSin = new Float32Array(instances);
  const halfRootAngleCos = new Float32Array(instances);

  const min = -0.25;
  const max = 0.25;

  for (let i = 0; i < instances; i++) {
    const offsetX = Math.random() * width - width / 2;
    const offsetZ = Math.random() * width - width / 2;
    const offsetY = getYPosition(offsetX, offsetZ);
    offsets[i * 3 + 0] = offsetX;
    offsets[i * 3 + 1] = offsetY;
    offsets[i * 3 + 2] = offsetZ;

    // around Y
    let angle = Math.PI - Math.random() * (2 * Math.PI);
    halfRootAngleSin[i] = Math.sin(0.5 * angle);
    halfRootAngleCos[i] = Math.cos(0.5 * angle);
    let q0 = quatFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

    // tilt around X
    angle = Math.random() * (max - min) + min;
    let q1 = quatFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
    q0 = multiplyQuaternions(q0, q1);

    // tilt around Z
    angle = Math.random() * (max - min) + min;
    q1 = quatFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    q0 = multiplyQuaternions(q0, q1);

    orientations[i * 4 + 0] = q0.x;
    orientations[i * 4 + 1] = q0.y;
    orientations[i * 4 + 2] = q0.z;
    orientations[i * 4 + 3] = q0.w;

    stretches[i] = i < instances / 3 ? Math.random() * 1.8 : Math.random();
  }

  return { offsets, orientations, stretches, halfRootAngleCos, halfRootAngleSin };
}

function quatFromAxisAngle(axis: THREE.Vector3, angle: number) {
  const s = Math.sin(angle / 2.0);
  const c = Math.cos(angle / 2.0);
  const v = new THREE.Vector4(axis.x * s, axis.y * s, axis.z * s, c);
  // normalize
  const len = Math.hypot(v.x, v.y, v.z, v.w);
  v.set(v.x / len, v.y / len, v.z / len, v.w / len);
  return v;
}

function multiplyQuaternions(q1: THREE.Vector4, q2: THREE.Vector4) {
  const x = q1.x * q2.w + q1.y * q2.z - q1.z * q2.y + q1.w * q2.x;
  const y = -q1.x * q2.z + q1.y * q2.w + q1.z * q2.x + q1.w * q2.y;
  const z = q1.x * q2.y - q1.y * q2.x + q1.z * q2.w + q1.w * q2.z;
  const w = -q1.x * q2.x - q1.y * q2.y - q1.z * q2.z + q1.w * q2.w;
  return new THREE.Vector4(x, y, z, w);
}

const noise2D = createNoise2D(Math.random);

function getYPosition(x: number, z: number) {
  // Match original starter's terrain profile
  let y = 2 * noise2D(x / 50, z / 50);
  y += 4 * noise2D(x / 100, z / 100);
  y += 0.2 * noise2D(x / 10, z / 10);
  return y;
}

function makeGroundGeometry(width: number, segments: number) {
  const geo = new THREE.PlaneGeometry(width, width, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = getYPosition(x, z);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createBladeTextures() {
  const W = 64;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const texture = new THREE.CanvasTexture(canvas);
    const alpha = new THREE.CanvasTexture(canvas);
    return { diffuseTexture: texture, alphaTexture: alpha };
  }

  // diffuse: soft green with slight vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#3a9b3a");
  grad.addColorStop(1, "#0e4c0e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const diffuseTexture = new THREE.CanvasTexture(canvas);
  diffuseTexture.wrapS = diffuseTexture.wrapT = THREE.RepeatWrapping;
  diffuseTexture.minFilter = THREE.LinearMipMapLinearFilter;
  diffuseTexture.magFilter = THREE.LinearFilter;
  diffuseTexture.anisotropy = 4;

  // alpha blade mask: narrower towards the tip
  const aCanvas = document.createElement("canvas");
  aCanvas.width = W;
  aCanvas.height = H;
  const aCtx = aCanvas.getContext("2d");
  if (!aCtx) {
    const diffuseTexture = new THREE.CanvasTexture(canvas);
    const alphaTexture = new THREE.CanvasTexture(aCanvas);
    return { diffuseTexture, alphaTexture };
  }
  const imgData = aCtx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const half = 0.5 * (1 - Math.pow(t, 1.25));
    const minX = Math.floor((0.5 - half) * W);
    const maxX = Math.ceil((0.5 + half) * W);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = x >= minX && x <= maxX;
      imgData.data[i + 0] = 255;
      imgData.data[i + 1] = 255;
      imgData.data[i + 2] = 255;
      imgData.data[i + 3] = inside ? 255 : 0;
    }
  }
  aCtx.putImageData(imgData, 0, 0);
  const alphaTexture = new THREE.CanvasTexture(aCanvas);
  alphaTexture.wrapS = alphaTexture.wrapT = THREE.RepeatWrapping;
  alphaTexture.minFilter = THREE.LinearFilter;
  alphaTexture.magFilter = THREE.LinearFilter;

  return { diffuseTexture, alphaTexture };
}

export default Grass;


