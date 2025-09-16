"use client";

import type { ThreeElements } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { type MutableRefObject, type RefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  getTerrainHeight,
  makeGroundGeometry as makeGroundGeometryLib,
} from "@/lib/terrain/height";
import "./GrassMaterial";

const GRASS_ROOT_LIFT = 0; // 0.12; //0.12; // Small lift to keep blade bases above ground
const GROUND_SEGMENTS = 128; // Higher resolution ground to better match height field

const baseGeometryCache = new Map<string, THREE.BufferGeometry>();
let sharedBladeTextures: {
  diffuseTexture: THREE.Texture;
  alphaTexture: THREE.Texture;
} | null = null;
let sharedWindTexture: THREE.Texture | null = null;

type GrassOptions = {
  bW?: number;
  bH?: number;
  joints?: number;
  useCards?: boolean; // use crossed cards tuft for far LOD
};

export function Grass({
  options = { bW: 0.12, bH: 1, joints: 5 },
  width = 60,
  instances = 80_000,
  capacity,
  instanceCount,
  interactionTexture,
  useInteract = true,
  boundsMin: boundsMinProp,
  boundsSize: boundsSizeProp,
  flattenStrength = 0.9,
  origin = new THREE.Vector2(0, 0),
  seed,
  windTexture,
  windScale = 0.02,
  windSpeed = 0.2,
  renderGround = true,
  tipColorOverride,
  bottomColorOverride,
  groundRef,
  ...props
}: {
  options?: GrassOptions;
  width?: number;
  instances?: number;
  capacity?: number;
  instanceCount?: number;
  interactionTexture?: THREE.Texture | null;
  useInteract?: boolean;
  boundsMin?: THREE.Vector2;
  boundsSize?: THREE.Vector2;
  flattenStrength?: number;
  origin?: THREE.Vector2;
  seed?: number;
  windTexture?: THREE.Texture | null;
  windScale?: number;
  windSpeed?: number;
  renderGround?: boolean;
  tipColorOverride?: THREE.ColorRepresentation;
  bottomColorOverride?: THREE.ColorRepresentation;
  groundRef?:
    | RefObject<THREE.Mesh | null>
    | MutableRefObject<THREE.Mesh | null>;
} & ThreeElements["group"]) {
  const { bW = 0.12, bH = 1, joints = 5 } = options;
  const useCards = options.useCards ?? false;
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  const effectiveCapacity = useMemo(
    () => capacity ?? instances,
    [capacity, instances],
  );
  const drawCount = useMemo(
    () => Math.min(instanceCount ?? instances, effectiveCapacity),
    [instanceCount, instances, effectiveCapacity],
  );

  const originX = origin?.x ?? 0;
  const originZ = origin?.y ?? 0;
  const {
    offsets,
    orientations,
    stretches,
    halfRootAngleSin,
    halfRootAngleCos,
  } = useMemo(
    () => getAttributeData(effectiveCapacity, width, originX, originZ, seed),
    [effectiveCapacity, width, originX, originZ, seed],
  );

  const safeCount = useMemo(() => {
    const counts = [
      drawCount,
      Math.floor(offsets.length / 3),
      Math.floor(orientations.length / 4),
      stretches.length,
      halfRootAngleSin.length,
      halfRootAngleCos.length,
    ];
    return Math.max(0, Math.min(...counts));
  }, [
    drawCount,
    offsets.length,
    orientations.length,
    stretches.length,
    halfRootAngleSin.length,
    halfRootAngleCos.length,
  ]);

  const baseGeom = useMemo(
    () => getBaseGeometry({ useCards, bW, bH, joints }),
    [useCards, bW, bH, joints],
  );

  const groundGeo = useMemo(
    () =>
      makeGroundGeometryLib(
        width,
        GROUND_SEGMENTS,
        new THREE.Vector2(originX, originZ),
      ),
    [width, originX, originZ],
  );

  const { diffuseTexture, alphaTexture } = useMemo(
    () => getSharedBladeTextures(),
    [],
  );

  const windTex = useMemo(
    () => windTexture ?? getSharedWindTexture(128),
    [windTexture],
  );

  // Interaction uniforms
  const boundsMin = useMemo(
    () => boundsMinProp ?? new THREE.Vector2(-width / 2, -width / 2),
    [boundsMinProp, width],
  );
  const boundsSize = useMemo(
    () => boundsSizeProp ?? new THREE.Vector2(width, width),
    [boundsSizeProp, width],
  );
  const interactInvSize = useMemo(() => {
    const img = interactionTexture?.image as
      | { width?: number; height?: number }
      | undefined;
    const iw = img?.width ?? 512;
    const ih = img?.height ?? 512;
    return new THREE.Vector2(1 / iw, 1 / ih);
  }, [interactionTexture]);

  useFrame((state) => {
    if (materialRef.current)
      materialRef.current.uniforms.time.value = state.clock.elapsedTime / 4;
  });

  const instGeomRef = useRef<THREE.InstancedBufferGeometry>(null);

  useEffect(() => {
    const g = instGeomRef.current;
    if (!g) return;
    const half = width / 2;
    const maxY = 8 + bH; // conservative terrain variance + blade height
    const radius = Math.sqrt(half * half + maxY * maxY + half * half);
    g.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, bH * 0.5, 0),
      radius,
    );
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(-half, -2, -half),
      new THREE.Vector3(half, maxY, half),
    );
  }, [width, bH]);

  return (
    <group position={[origin.x, 0, origin.y]} {...props}>
      <mesh frustumCulled>
        {/* Base blade geometry with per-instance attributes */}
        <instancedBufferGeometry
          ref={instGeomRef}
          index={baseGeom.index}
          attributes-position={baseGeom.attributes.position}
          attributes-uv={baseGeom.attributes.uv}
          instanceCount={safeCount}
        >
          <instancedBufferAttribute
            attach={"attributes-offset"}
            args={[offsets, 3]}
          />
          <instancedBufferAttribute
            attach={"attributes-orientation"}
            args={[orientations, 4]}
          />
          <instancedBufferAttribute
            attach={"attributes-stretch"}
            args={[stretches, 1]}
          />
          <instancedBufferAttribute
            attach={"attributes-halfRootAngleSin"}
            args={[halfRootAngleSin, 1]}
          />
          <instancedBufferAttribute
            attach={"attributes-halfRootAngleCos"}
            args={[halfRootAngleCos, 1]}
          />
        </instancedBufferGeometry>
        <grassMaterial
          ref={materialRef}
          map={diffuseTexture}
          alphaMap={alphaTexture}
          toneMapped={false}
          bladeHeight={bH}
          windTex={windTex}
          windScale={windScale}
          windSpeed={windSpeed}
          tileOrigin={origin}
          tipColor={tipColorOverride}
          bottomColor={bottomColorOverride}
          boundsMin={boundsMin}
          boundsSize={boundsSize}
          interactTex={interactionTexture ?? null}
          useInteract={interactionTexture && useInteract ? 1 : 0}
          interactInvSize={interactInvSize}
          flattenStrength={flattenStrength}
        />
      </mesh>
      {renderGround ? (
        <mesh
          ref={groundRef}
          position={[0, 0, 0]}
          geometry={groundGeo}
          receiveShadow
        >
          <meshStandardMaterial color="#0a2a0a" />
        </mesh>
      ) : null}
    </group>
  );
}

function getBaseGeometry({
  useCards,
  bW,
  bH,
  joints,
}: {
  useCards: boolean;
  bW: number;
  bH: number;
  joints: number;
}) {
  const key = `${useCards ? "cards" : "blade"}|${bW}|${bH}|${joints}`;
  const cached = baseGeometryCache.get(key);
  if (cached) return cached;
  let geometry: THREE.BufferGeometry;
  if (!useCards) {
    const g = new THREE.PlaneGeometry(bW, bH, 1, joints);
    g.translate(0, bH / 2, 0);
    geometry = g;
  } else {
    const card = new THREE.PlaneGeometry(bW * 1.8, bH, 1, 1);
    card.translate(0, bH / 2, 0);
    const g = new THREE.BufferGeometry();
    const mats: THREE.Matrix4[] = [];
    for (let i = 0; i < 3; i++)
      mats.push(new THREE.Matrix4().makeRotationY((i * Math.PI) / 3));
    const posArray: number[] = [];
    const uvArray: number[] = [];
    const idxArray: number[] = [];
    let vertOffset = 0;
    for (let i = 0; i < 3; i++) {
      const positions = (card.attributes.position as THREE.BufferAttribute)
        .array as ArrayLike<number>;
      const uvs = (card.attributes.uv as THREE.BufferAttribute)
        .array as ArrayLike<number>;
      for (let v = 0; v < positions.length; v += 3) {
        const vx = positions[v + 0];
        const vy = positions[v + 1];
        const vz = positions[v + 2];
        const rotated = new THREE.Vector3(vx, vy, vz).applyMatrix4(mats[i]);
        posArray.push(rotated.x, rotated.y, rotated.z);
      }
      for (let t = 0; t < uvs.length; t++) uvArray.push(uvs[t] as number);
      const indices = (card.index as THREE.BufferAttribute)
        .array as ArrayLike<number>;
      for (let k = 0; k < indices.length; k++)
        idxArray.push(Number(indices[k]) + vertOffset);
      vertOffset += (card.attributes.position as THREE.BufferAttribute).count;
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(posArray, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvArray, 2));
    g.setIndex(idxArray);
    g.computeVertexNormals();
    geometry = g;
  }
  baseGeometryCache.set(key, geometry);
  return geometry;
}

function getSharedBladeTextures() {
  if (!sharedBladeTextures) sharedBladeTextures = createBladeTextures();
  return sharedBladeTextures;
}

function getSharedWindTexture(size = 128) {
  if (!sharedWindTexture) sharedWindTexture = createWindTexture(size);
  return sharedWindTexture;
}

function getAttributeData(
  instances: number,
  width: number,
  originX: number,
  originZ: number,
  seed?: number,
) {
  const offsets = new Float32Array(instances * 3);
  const orientations = new Float32Array(instances * 4);
  const stretches = new Float32Array(instances);
  const halfRootAngleSin = new Float32Array(instances);
  const halfRootAngleCos = new Float32Array(instances);

  const min = -0.25;
  const max = 0.25;

  const rng = createMulberry32(
    (seed ?? 1337) ^
      (Math.round(originX * 131) << 1) ^
      Math.round(originZ * 197),
  );
  const gridRes = Math.ceil(Math.sqrt(instances));
  const cell = width / gridRes;

  // Create a list of cell indices and deterministically shuffle it so any prefix is spatially uniform
  const cellCount = gridRes * gridRes;
  const order = new Uint32Array(cellCount);
  for (let k = 0; k < cellCount; k++) order[k] = k;
  for (let k = cellCount - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    const tmp = order[k];
    order[k] = order[j];
    order[j] = tmp;
  }

  for (let i = 0; i < instances; i++) {
    const idx = order[i];
    const gx = idx % gridRes;
    const gz = Math.floor(idx / gridRes);

    const jx = (rng() - 0.5) * cell;
    const jz = (rng() - 0.5) * cell;
    const xWorld = originX - width / 2 + (gx + 0.5) * cell + jx;
    const zWorld = originZ - width / 2 + (gz + 0.5) * cell + jz;
    const y = getTerrainHeight(xWorld, zWorld) + GRASS_ROOT_LIFT;

    offsets[i * 3 + 0] = xWorld - originX;
    offsets[i * 3 + 1] = y;
    offsets[i * 3 + 2] = zWorld - originZ;

    // around Y
    let angle = Math.PI - rng() * (2 * Math.PI);
    halfRootAngleSin[i] = Math.sin(0.5 * angle);
    halfRootAngleCos[i] = Math.cos(0.5 * angle);
    let q0 = quatFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

    // tilt around X
    angle = rng() * (max - min) + min;
    let q1 = quatFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
    q0 = multiplyQuaternions(q0, q1);

    // tilt around Z
    angle = rng() * (max - min) + min;
    q1 = quatFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    q0 = multiplyQuaternions(q0, q1);

    orientations[i * 4 + 0] = q0.x;
    orientations[i * 4 + 1] = q0.y;
    orientations[i * 4 + 2] = q0.z;
    orientations[i * 4 + 3] = q0.w;

    stretches[i] = i < instances / 3 ? rng() * 1.8 : rng();
  }

  return {
    offsets,
    orientations,
    stretches,
    halfRootAngleCos,
    halfRootAngleSin,
  };
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
    const half = 0.5 * (1 - t ** 1.25);
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

function createMulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createWindTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const rng = createMulberry32(12345);
  const data = ctx.createImageData(size, size);
  // Simple value noise + 2 octaves
  const base = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      base[y * size + x] = rng();
    }
  }
  const sample = (x: number, y: number, s: number) => {
    const xi = Math.floor((((x / s) % size) + size) % size);
    const yi = Math.floor((((y / s) % size) + size) % size);
    return base[yi * size + xi];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        0.6 * sample(x, y, 4) +
        0.3 * sample(x + 17.3, y + 5.9, 8) +
        0.1 * sample(x + 123.4, y + 87.1, 16);
      const v = Math.max(0, Math.min(255, Math.floor(n * 255)));
      const i = (y * size + x) * 4;
      data.data[i + 0] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export default Grass;
