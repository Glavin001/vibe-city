"use client";

import { Environment, OrbitControls, StatsGl } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";

/**
 * Utility: Build a simple blade geometry
 */
function makeBladeGeometry({
  segments = 7,
  width = 0.035,
  height = 0.6,
  tipTaper = 0.9,
}: {
  segments?: number;
  width?: number;
  height?: number;
  tipTaper?: number;
}) {
  const geo = new THREE.BufferGeometry();
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let v = 0;
  for (let i = 0; i < segments; i++) {
    const y0 = (i / segments) * height;
    const y1 = ((i + 1) / segments) * height;
    const t0 = 1 - (i / segments) ** 1.2 * tipTaper;
    const t1 = 1 - ((i + 1) / segments) ** 1.2 * tipTaper;
    const w0 = width * t0 * 0.5;
    const w1 = width * t1 * 0.5;

    verts.push(-w0, y0, 0, w0, y0, 0, -w1, y1, 0, w1, y1, 0);
    uvs.push(
      0,
      i / segments,
      1,
      i / segments,
      0,
      (i + 1) / segments,
      1,
      (i + 1) / segments,
    );

    indices.push(v + 0, v + 1, v + 2, v + 1, v + 3, v + 2);
    v += 4;
  }

  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Utility: jittered grid distribution
 */
function jitteredGridPositions(
  count: number,
  width: number,
  depth: number,
  center = new THREE.Vector3(),
) {
  const positions = new Float32Array(count * 3);
  const aspect = width / depth;
  const cols = Math.ceil(Math.sqrt(count * aspect));
  const rows = Math.ceil(count / cols);
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && i < count; c++, i++) {
      const u = (c + Math.random()) / cols;
      const v = (r + Math.random()) / rows;
      const x = (u - 0.5) * width + center.x;
      const z = (v - 0.5) * depth + center.z;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = center.y;
      positions[i * 3 + 2] = z;
    }
  }
  return positions;
}

/**
 * Interaction texture for flattening
 */
function useInteractionTexture({ size = 512, decay = 0.94 } = {}) {
  const canvas = useMemo(
    () =>
      Object.assign(document.createElement("canvas"), {
        width: size,
        height: size,
      }),
    [size],
  );
  const prevCanvas = useMemo(
    () =>
      Object.assign(document.createElement("canvas"), {
        width: size,
        height: size,
      }),
    [size],
  );
  const ctx = useMemo(
    () =>
      canvas.getContext("2d", {
        willReadFrequently: false,
      }) as CanvasRenderingContext2D,
    [canvas],
  );
  const prevCtx = useMemo(
    () => prevCanvas.getContext("2d") as CanvasRenderingContext2D,
    [prevCanvas],
  );
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [canvas]);
  const prevTexture = useMemo(() => {
    const t = new THREE.CanvasTexture(prevCanvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [prevCanvas]);

  const fade = () => {
    prevCtx.save();
    prevCtx.globalCompositeOperation = "copy";
    prevCtx.drawImage(canvas, 0, 0);
    prevCtx.restore();
    prevTexture.needsUpdate = true;

    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(0,0,0,${1 - decay})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    texture.needsUpdate = true;
  };

  const makeStamper =
    (boundsMin: THREE.Vector2, boundsSize: THREE.Vector2) =>
    (x: number, z: number, radiusWorld: number, strength = 1) => {
      const u = (x - boundsMin.x) / boundsSize.x;
      const v = (z - boundsMin.y) / boundsSize.y;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      const r =
        (radiusWorld / Math.max(boundsSize.x, boundsSize.y)) * canvas.width;
      const gx = u * canvas.width;
      const gy = (1 - v) * canvas.height;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.85 * strength})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      texture.needsUpdate = true;
    };

  return { texture, prevTexture, fade, makeStamper, size };
}

function createHeightMapTexture(size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const perlin = new ImprovedNoise();
  const z = Math.random() * 100;
  let ptr = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = (perlin.noise(x / 64, y / 64, z) + 1) * 0.5;
      const col = v * 255;
      data[ptr++] = col;
      data[ptr++] = col;
      data[ptr++] = col;
      data[ptr++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */ `
precision highp float;
attribute vec3 aOffset;
attribute float aScale;
attribute float aRotation;
attribute float aCurv;
attribute float aRand;
attribute vec2 aTilt;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindAmp;
uniform float uWindFreq;
uniform float uBladeBase;
uniform vec2 uBoundsMin;
uniform vec2 uBoundsSize;
uniform sampler2D uHeightMap;
uniform float uUseHeightMap;
uniform float uHeightScale;
uniform sampler2D uInteractTex;
uniform sampler2D uInteractPrevTex;
uniform float uUseInteract;
uniform vec2 uInteractInvSize;
uniform float uBendStrength;
varying vec3 vWorldPos;
varying float vHeight01;
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x){ return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0) );
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
mat2 rot2(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
void main() {
  vec3 p = position;
  float h01 = clamp(p.y / uBladeBase, 0.0, 1.0);
  vec2 windU = (aOffset.xz * uWindFreq * 0.15) + uTime * 0.15;
  float gust = snoise(windU + aRand * 37.0);
  float sway = uWindAmp * mix(0.5, 1.0, aRand) * gust;
  vec2 dir = normalize(uWindDir + vec2(snoise((aOffset.xz + 2.7) * 0.05)));
  p.xz += aTilt * p.y;
  vec2 worldXZ = aOffset.xz + rot2(aRotation) * p.xz;
  vec2 uvWorld = (worldXZ - uBoundsMin) / uBoundsSize;
  float interact = 0.0;
  vec2 bendFromInteract = vec2(0.0);
  if (uUseInteract > 0.5) {
    float c = texture2D(uInteractTex, uvWorld).r;
    float cxp = texture2D(uInteractTex, uvWorld + vec2(uInteractInvSize.x, 0.0)).r;
    float cxm = texture2D(uInteractTex, uvWorld - vec2(uInteractInvSize.x, 0.0)).r;
    float cyp = texture2D(uInteractTex, uvWorld + vec2(0.0, uInteractInvSize.y)).r;
    float cym = texture2D(uInteractTex, uvWorld - vec2(0.0, uInteractInvSize.y)).r;
    float pxp = texture2D(uInteractPrevTex, uvWorld + vec2(uInteractInvSize.x, 0.0)).r;
    float pxm = texture2D(uInteractPrevTex, uvWorld - vec2(uInteractInvSize.x, 0.0)).r;
    float pyp = texture2D(uInteractPrevTex, uvWorld + vec2(0.0, uInteractInvSize.y)).r;
    float pym = texture2D(uInteractPrevTex, uvWorld - vec2(0.0, uInteractInvSize.y)).r;
    vec2 gradCurr = vec2(cxp - cxm, cyp - cym);
    vec2 gradPrev = vec2(pxp - pxm, pyp - pym);
    vec2 motion = gradCurr - gradPrev;
    bendFromInteract = (length(motion) > 1e-5) ? -normalize(motion) : vec2(0.0);
    interact = c;
  }
  float bendAmt = (aCurv * 0.35 + sway * 0.25) * (h01 * h01);
  bendAmt += interact * uBendStrength * h01;
  vec2 bendDir = normalize(dir + bendFromInteract);
  p.xz += bendDir * bendAmt * uBladeBase;
  p.y *= aScale;
  p.xz = rot2(aRotation) * p.xz;
  float baseY = 0.0;
  if (uUseHeightMap > 0.5) {
    float h = texture2D(uHeightMap, uvWorld).r;
    baseY = h * uHeightScale;
  }
  vec3 world = vec3(worldXZ.x, baseY + p.y + aOffset.y, worldXZ.y);
  vWorldPos = world;
  vHeight01 = h01;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying float vHeight01;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uSunDir;
uniform float uAmbient;
vec3 computeNormal() {
  vec3 dx = dFdx(vWorldPos);
  vec3 dy = dFdy(vWorldPos);
  vec3 n = normalize(cross(dx, dy));
  return (dot(n, uSunDir) < 0.0) ? -n : n;
}
void main() {
  vec3 n = computeNormal();
  float NdotL = max(dot(n, uSunDir), 0.0);
  vec3 base = mix(uColorA, uColorB, clamp(vHeight01 * 1.1, 0.0, 1.0));
  vec3 col = base * (uAmbient + (1.0 - uAmbient) * NdotL);
  gl_FragColor = vec4(col, 1.0);
}
`;

interface GrassFieldProps {
  size?: [number, number];
  center?: [number, number, number];
  count?: number;
  bladeHeight?: number;
  bladeWidth?: number;
  segments?: number;
  windAmp?: number;
  windDir?: [number, number];
  windFreq?: number;
  heightMap?: THREE.Texture | null;
  heightScale?: number;
  interaction?: boolean;
  interactionTexture?: ReturnType<typeof useInteractionTexture>;
  bendStrength?: number;
  colorA?: string;
  colorB?: string;
}

function GrassField({
  size = [20, 20],
  center = [0, 0, 0],
  count = 120_000,
  bladeHeight = 0.6,
  bladeWidth = 0.035,
  segments = 5,
  windAmp = 0.8,
  windDir = [1, 0],
  windFreq = 0.7,
  heightMap = null,
  heightScale = 2.5,
  interaction = true,
  interactionTexture,
  bendStrength = 0.9,
  colorA = "#446c3a",
  colorB = "#8bcf4a",
}: GrassFieldProps) {
  const [W, D] = size;
  const boundsMin = useMemo(
    () => new THREE.Vector2(center[0] - W / 2, center[2] - D / 2),
    [W, D, center],
  );
  const boundsSize = useMemo(() => new THREE.Vector2(W, D), [W, D]);
  const bladeGeo = useMemo(
    () =>
      makeBladeGeometry({ segments, width: bladeWidth, height: bladeHeight }),
    [segments, bladeWidth, bladeHeight],
  );
  const geo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = bladeGeo.index;
    for (const name in bladeGeo.attributes) {
      g.setAttribute(name, bladeGeo.attributes[name]);
    }
    g.instanceCount = count;
    const offsets = jitteredGridPositions(
      count,
      W,
      D,
      new THREE.Vector3(center[0], center[1], center[2]),
    );
    const scales = new Float32Array(count);
    const yaws = new Float32Array(count);
    const curvs = new Float32Array(count);
    const rands = new Float32Array(count);
    const tilts = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      scales[i] = 0.75 + Math.random() * 0.7;
      yaws[i] = Math.random() * Math.PI * 2;
      curvs[i] = 0.3 + Math.random() * 0.7;
      rands[i] = Math.random();
      const tiltAngle = Math.random() * Math.PI * 2;
      const tiltAmt = Math.random() * 0.3;
      tilts[i * 2 + 0] = Math.cos(tiltAngle) * tiltAmt;
      tilts[i * 2 + 1] = Math.sin(tiltAngle) * tiltAmt;
    }
    g.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    g.setAttribute("aScale", new THREE.InstancedBufferAttribute(scales, 1));
    g.setAttribute("aRotation", new THREE.InstancedBufferAttribute(yaws, 1));
    g.setAttribute("aCurv", new THREE.InstancedBufferAttribute(curvs, 1));
    g.setAttribute("aRand", new THREE.InstancedBufferAttribute(rands, 1));
    g.setAttribute("aTilt", new THREE.InstancedBufferAttribute(tilts, 2));
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(boundsMin.x, center[1], boundsMin.y),
      new THREE.Vector3(
        boundsMin.x + boundsSize.x,
        center[1] + heightScale + bladeHeight * 1.5,
        boundsMin.y + boundsSize.y,
      ),
    );
    g.computeBoundingSphere();
    return g;
  }, [
    bladeGeo,
    count,
    W,
    D,
    center,
    heightScale,
    bladeHeight,
    boundsMin,
    boundsSize,
  ]);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uWindDir: {
            value: new THREE.Vector2().fromArray(windDir).normalize(),
          },
          uWindAmp: { value: windAmp },
          uWindFreq: { value: windFreq },
          uBladeBase: { value: bladeHeight },
          uBoundsMin: { value: boundsMin },
          uBoundsSize: { value: boundsSize },
          uHeightMap: { value: heightMap },
          uUseHeightMap: { value: heightMap ? 1 : 0 },
          uHeightScale: { value: heightScale },
          uInteractTex: {
            value:
              interaction && interactionTexture
                ? interactionTexture.texture
                : null,
          },
          uInteractPrevTex: {
            value:
              interaction && interactionTexture
                ? interactionTexture.prevTexture
                : null,
          },
          uUseInteract: { value: interaction && interactionTexture ? 1 : 0 },
          uInteractInvSize: {
            value: new THREE.Vector2(
              interaction && interactionTexture
                ? 1 / interactionTexture.size
                : 1,
              interaction && interactionTexture
                ? 1 / interactionTexture.size
                : 1,
            ),
          },
          uBendStrength: { value: bendStrength },
          uColorA: { value: new THREE.Color(colorA) },
          uColorB: { value: new THREE.Color(colorB) },
          uSunDir: { value: new THREE.Vector3(0.5, 1.0, 0.2).normalize() },
          uAmbient: { value: 0.35 },
        },
        side: THREE.DoubleSide,
        dithering: true,
      }),
    [
      windDir,
      windAmp,
      windFreq,
      bladeHeight,
      boundsMin,
      boundsSize,
      heightMap,
      heightScale,
      interaction,
      interactionTexture,
      bendStrength,
      colorA,
      colorB,
    ],
  );

  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
    if (interaction && interactionTexture) interactionTexture.fade();
  });

  return <mesh geometry={geo} material={mat} frustumCulled />;
}

interface RollingBallProps {
  stamper: ReturnType<ReturnType<typeof useInteractionTexture>["makeStamper"]>;
  boundsMin: THREE.Vector2;
  boundsSize: THREE.Vector2;
  radius?: number;
  speed?: number;
}

function RollingBall({
  stamper,
  boundsMin,
  boundsSize,
  radius = 0.6,
  speed = 1,
}: RollingBallProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * speed;
    const x = boundsMin.x + (0.5 + 0.5 * Math.sin(t * 0.35)) * boundsSize.x;
    const z = boundsMin.y + (0.5 + 0.5 * Math.cos(t * 0.5)) * boundsSize.y;
    if (ref.current) ref.current.position.set(x, 0.4, z);
    if (stamper) stamper(x, z, radius * 2.2, 1.0);
  });
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <sphereGeometry args={[radius, 32, 32]} />
      <meshStandardMaterial color="#cccccc" metalness={0.2} roughness={0.6} />
    </mesh>
  );
}

interface CursorBallProps {
  stamper: ReturnType<ReturnType<typeof useInteractionTexture>["makeStamper"]>;
  boundsMin: THREE.Vector2;
  boundsSize: THREE.Vector2;
  radius?: number;
}

function CursorBall({ stamper, boundsMin, boundsSize, radius = 0.6 }: CursorBallProps) {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const mouse = useRef(new THREE.Vector2());
  useEffect(() => {
    const handle = (e: PointerEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("pointermove", handle);
    return () => window.removeEventListener("pointermove", handle);
  }, []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    ray.setFromCamera(mouse.current, camera);
    ray.ray.intersectPlane(plane, pos);
    const x = THREE.MathUtils.clamp(pos.x, boundsMin.x, boundsMin.x + boundsSize.x);
    const z = THREE.MathUtils.clamp(pos.z, boundsMin.y, boundsMin.y + boundsSize.y);
    if (ref.current) ref.current.position.set(x, radius, z);
    if (stamper) stamper(x, z, radius * 2.2, 1.0);
  });
  return (
    <mesh ref={ref} castShadow receiveShadow>
      <sphereGeometry args={[radius, 32, 32]} />
      <meshStandardMaterial color="#dd3333" metalness={0.2} roughness={0.6} />
    </mesh>
  );
}

export function GrassDemo({
  fieldSize = [200, 200],
  bladeCount = 800_000,
  useHeightMap = true,
  heightScale = 3.0,
}) {
  const [W, D] = fieldSize;
  const boundsMin = new THREE.Vector2(-W / 2, -D / 2);
  const boundsSize = new THREE.Vector2(W, D);
  const heightMap = useMemo(() => createHeightMapTexture(1024), []);
  const interact = useInteractionTexture({ size: 512, decay: 0.97 });
  const stamper = interact.makeStamper(
    new THREE.Vector2(boundsMin.x, boundsMin.y),
    new THREE.Vector2(boundsSize.x, boundsSize.y),
  );
  return (
    <Canvas shadows camera={{ position: [30, 20, 30], fov: 45 }}>
      <color attach="background" args={["#9fd6ff"]} />
      <hemisphereLight intensity={0.5} groundColor="#7aa07a" />
      <directionalLight position={[20, 25, 20]} intensity={1.2} castShadow />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        position={[0, -0.01, 0]}
      >
        <planeGeometry args={[W, D, 256, 256]} />
        <meshStandardMaterial
          color="#7cac65"
          displacementMap={useHeightMap ? heightMap : null}
          displacementScale={heightScale}
        />
      </mesh>
      <GrassField
        size={[W, D]}
        count={bladeCount}
        center={[0, 0, 0]}
        windAmp={0.85}
        windDir={[1, 0]}
        windFreq={0.8}
        heightMap={useHeightMap ? heightMap : null}
        heightScale={heightScale}
        interaction
        interactionTexture={interact}
        bendStrength={0.9}
      />
      <RollingBall
        stamper={stamper}
        boundsMin={boundsMin}
        boundsSize={boundsSize}
        radius={0.65}
        speed={1.0}
      />
      <CursorBall
        stamper={stamper}
        boundsMin={boundsMin}
        boundsSize={boundsSize}
        radius={0.65}
      />
      <Environment preset="sunset" />
      <OrbitControls makeDefault />
      <StatsGl />
    </Canvas>
  );
}

export default GrassDemo;
