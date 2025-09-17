'use client';

import { shaderMaterial } from '@react-three/drei';
import { extend, type Object3DNode, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

const noiseGLSL = /* glsl */ `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 =   v - i + dot(i, C.xxx) ;

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww ;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}
`;

const fireVertexShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSpeed;
uniform float uRise;
uniform float uDistortion;
uniform float uNoiseScale;
uniform float uSize;
uniform float uFlowStrength;

attribute float aScale;
attribute float aSeed;
attribute vec3 aFlow;

varying float vLife;
varying float vSeed;
varying float vNoise;

${noiseGLSL}

void main() {
  float t = uTime * uSpeed;
  float progress = fract(t + aSeed);
  float life = 1.0 - progress;

  vec3 pos = position;
  vec3 noiseSample = pos * uNoiseScale + vec3(0.0, t * 0.5, aSeed * 10.0);
  float n1 = snoise(noiseSample);
  float n2 = snoise(noiseSample + 11.0);

  pos.xz += vec2(n1, n2) * uDistortion;
  pos.y += n1 * 0.5 * uDistortion;

  pos.xz += normalize(vec2(aFlow.x, aFlow.z) + 0.0001) * uFlowStrength * progress * progress;
  pos.y += progress * uRise;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float size = (aScale * 0.6 + life) * uSize;
  gl_PointSize = clamp(size * (1.0 / -mvPosition.z), 6.0, 140.0);
  gl_Position = projectionMatrix * mvPosition;

  vLife = life;
  vSeed = aSeed;
  vNoise = n1;
}
`;

const fireFragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uOpacity;
uniform float uIntensity;
uniform float uFlickerStrength;
uniform vec3 uColorInner;
uniform vec3 uColorOuter;

varying float vLife;
varying float vSeed;
varying float vNoise;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);
  float falloff = smoothstep(1.0, 0.0, dist);
  if (falloff <= 0.0) discard;

  float flame = pow(falloff, uIntensity) * vLife;
  float flicker = 0.85 + 0.15 * sin(uTime * 30.0 + vSeed * 40.0);
  flicker += vNoise * 0.25 * uFlickerStrength;
  flicker = clamp(flicker, 0.0, 1.6);

  vec3 color = mix(uColorOuter, uColorInner, pow(vLife, 2.2));
  color *= 1.2;

  gl_FragColor = vec4(color * flame * flicker, flame * uOpacity);
}
`;

const smokeVertexShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSpeed;
uniform float uRise;
uniform float uSize;
uniform float uNoiseScale;
uniform float uDrift;

attribute float aScale;
attribute float aSeed;
attribute vec3 aFlow;

varying float vAlpha;

${noiseGLSL}

void main() {
  float t = uTime * uSpeed;
  float progress = fract(t + aSeed);
  vec3 pos = position;
  float height = progress * uRise;
  pos.y += height;

  vec3 noiseSample = pos * uNoiseScale + vec3(aSeed * 10.0, t * 0.25, t * 0.5);
  float driftX = snoise(noiseSample);
  float driftZ = snoise(noiseSample + 19.5);
  pos.x += (driftX + aFlow.x * 0.5) * uDrift;
  pos.z += (driftZ + aFlow.z * 0.5) * uDrift;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float size = (aScale + progress * 2.0) * uSize;
  gl_PointSize = clamp(size * (1.0 / -mvPosition.z), 4.0, 120.0);
  gl_Position = projectionMatrix * mvPosition;

  vAlpha = 1.0 - progress;
}
`;

const smokeFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform float uOpacity;

varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);
  float alpha = smoothstep(1.0, 0.0, dist) * vAlpha * uOpacity;
  if (alpha <= 0.0) discard;

  gl_FragColor = vec4(uColor, alpha);
}
`;

const FireParticlesMaterial = shaderMaterial(
  {
    uTime: 0,
    uSpeed: 0.65,
    uRise: 3.0,
    uDistortion: 1.1,
    uNoiseScale: 0.35,
    uSize: 60.0,
    uFlowStrength: 0.6,
    uOpacity: 0.95,
    uIntensity: 2.2,
    uFlickerStrength: 1.0,
    uColorInner: new THREE.Color('#ffd1a9'),
    uColorOuter: new THREE.Color('#ff4d00'),
  },
  fireVertexShader,
  fireFragmentShader,
);

const SmokeParticlesMaterial = shaderMaterial(
  {
    uTime: 0,
    uSpeed: 0.15,
    uRise: 5.0,
    uSize: 45.0,
    uNoiseScale: 0.25,
    uDrift: 0.6,
    uColor: new THREE.Color('#8d8d8d'),
    uOpacity: 0.45,
  },
  smokeVertexShader,
  smokeFragmentShader,
);

extend({ FireParticlesMaterial, SmokeParticlesMaterial });

type FireParticlesMaterialType = InstanceType<typeof FireParticlesMaterial>;
type SmokeParticlesMaterialType = InstanceType<typeof SmokeParticlesMaterial>;

type FireMaterialInstance = FireParticlesMaterialType & {
  uTime: number;
  uSpeed: number;
  uRise: number;
  uDistortion: number;
  uNoiseScale: number;
  uSize: number;
  uFlowStrength: number;
  uOpacity: number;
  uIntensity: number;
  uFlickerStrength: number;
  uColorInner: THREE.Color;
  uColorOuter: THREE.Color;
};

type SmokeMaterialInstance = SmokeParticlesMaterialType & {
  uTime: number;
  uSpeed: number;
  uRise: number;
  uSize: number;
  uNoiseScale: number;
  uDrift: number;
  uColor: THREE.Color;
  uOpacity: number;
};

export type FireShape =
  | { kind: 'plane'; width: number; height: number }
  | { kind: 'sphere'; radius: number }
  | { kind: 'box'; width: number; height: number; depth: number }
  | {
      kind: 'torus';
      radius: number;
      tube: number;
      tubularSegments?: number;
      radialSegments?: number;
      p?: number;
      q?: number;
    };

export interface FlameControls {
  speed: number;
  rise: number;
  size: number;
  distortion: number;
  flow: number;
  intensity: number;
  flicker: number;
  opacity: number;
  noiseScale: number;
  innerColor: string;
  outerColor: string;
}

export interface SmokeControls {
  enabled: boolean;
  speed: number;
  rise: number;
  size: number;
  opacity: number;
  noiseScale: number;
  drift: number;
  color: string;
}

export interface VolumetricFireProps extends JSX.IntrinsicElements['group'] {
  shape: FireShape;
  flameCount?: number;
  smokeCount?: number;
  spread?: number;
  heightSpread?: number;
  flameControls: FlameControls;
  smokeControls?: SmokeControls;
}

type FireGeometryAttributes = {
  position: THREE.BufferAttribute;
  aScale: THREE.BufferAttribute;
  aSeed: THREE.BufferAttribute;
  aFlow: THREE.BufferAttribute;
};

function createShapeMesh(shape: FireShape): THREE.Mesh {
  switch (shape.kind) {
    case 'plane': {
      const geometry = new THREE.PlaneGeometry(shape.width, shape.height, 64, 64);
      return new THREE.Mesh(geometry);
    }
    case 'sphere': {
      const geometry = new THREE.SphereGeometry(shape.radius, 128, 64);
      return new THREE.Mesh(geometry);
    }
    case 'box': {
      const geometry = new THREE.BoxGeometry(
        shape.width,
        shape.height,
        shape.depth,
        48,
        48,
        48,
      );
      return new THREE.Mesh(geometry);
    }
    case 'torus': {
      const geometry = new THREE.TorusKnotGeometry(
        shape.radius,
        shape.tube,
        shape.tubularSegments ?? 180,
        shape.radialSegments ?? 24,
        shape.p ?? 2,
        shape.q ?? 3,
      );
      return new THREE.Mesh(geometry);
    }
    default: {
      const _exhaustive: never = shape;
      return new THREE.Mesh();
    }
  }
}

function buildParticleGeometry(
  shape: FireShape,
  count: number,
  spread: number,
  heightSpread: number,
): THREE.BufferGeometry<THREE.NormalBufferAttributes> {
  const mesh = createShapeMesh(shape);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const geometry = new THREE.BufferGeometry();

  const positions = new Float32Array(count * 3);
  const flows = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const seeds = new Float32Array(count);

  const tempPosition = new THREE.Vector3();
  const tempNormal = new THREE.Vector3();

  for (let i = 0; i < count; i += 1) {
    sampler.sample(tempPosition, tempNormal);

    const surfaceJitter = (Math.random() - 0.25) * spread;
    tempPosition.addScaledVector(tempNormal, surfaceJitter);
    tempPosition.x += (Math.random() - 0.5) * spread;
    tempPosition.z += (Math.random() - 0.5) * spread;
    tempPosition.y += (Math.random() - 0.5) * spread * heightSpread;

    positions[i * 3] = tempPosition.x;
    positions[i * 3 + 1] = tempPosition.y;
    positions[i * 3 + 2] = tempPosition.z;

    flows[i * 3] = (Math.random() - 0.5) * 2.0;
    flows[i * 3 + 1] = Math.random();
    flows[i * 3 + 2] = (Math.random() - 0.5) * 2.0;

    scales[i] = 0.5 + Math.random();
    seeds[i] = Math.random();
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 3));
  geometry.setAttribute('aScale', new THREE.Float32BufferAttribute(scales, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

  mesh.geometry.dispose();

  return geometry;
}

function buildSmokeGeometry(
  shape: FireShape,
  count: number,
  spread: number,
): THREE.BufferGeometry<THREE.NormalBufferAttributes> {
  const mesh = createShapeMesh(shape);
  const sampler = new MeshSurfaceSampler(mesh).build();
  const geometry = new THREE.BufferGeometry();

  const positions = new Float32Array(count * 3);
  const flows = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const seeds = new Float32Array(count);

  const tempPosition = new THREE.Vector3();
  const tempNormal = new THREE.Vector3();

  let generated = 0;
  while (generated < count) {
    sampler.sample(tempPosition, tempNormal);
    if (tempNormal.y < -0.1 && Math.random() > 0.2) {
      continue;
    }

    const offset = spread * (0.2 + Math.random() * 0.8);
    tempPosition.addScaledVector(tempNormal, offset * 0.5 + Math.abs(tempNormal.y) * spread);
    tempPosition.x += (Math.random() - 0.5) * spread * 0.7;
    tempPosition.z += (Math.random() - 0.5) * spread * 0.7;
    tempPosition.y += offset * 0.5;

    positions[generated * 3] = tempPosition.x;
    positions[generated * 3 + 1] = tempPosition.y;
    positions[generated * 3 + 2] = tempPosition.z;

    flows[generated * 3] = (Math.random() - 0.5) * 1.2;
    flows[generated * 3 + 1] = Math.random();
    flows[generated * 3 + 2] = (Math.random() - 0.5) * 1.2;

    scales[generated] = 0.6 + Math.random() * 0.8;
    seeds[generated] = Math.random();

    generated += 1;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 3));
  geometry.setAttribute('aScale', new THREE.Float32BufferAttribute(scales, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

  mesh.geometry.dispose();

  return geometry;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      fireParticlesMaterial: Object3DNode<FireParticlesMaterialType, typeof FireParticlesMaterial>;
      smokeParticlesMaterial: Object3DNode<SmokeParticlesMaterialType, typeof SmokeParticlesMaterial>;
    }
  }
}

export function VolumetricFire({
  shape,
  flameCount = 1600,
  smokeCount = 600,
  spread = 1.1,
  heightSpread = 0.7,
  flameControls,
  smokeControls,
  ...groupProps
}: VolumetricFireProps) {
  const flameGeometry = useMemo(
    () => buildParticleGeometry(shape, flameCount, spread, heightSpread),
    [shape, flameCount, spread, heightSpread],
  );

  const smokeGeometry = useMemo(() => {
    if (!smokeControls?.enabled || smokeCount <= 0) {
      return null;
    }
    return buildSmokeGeometry(shape, smokeCount, spread * 0.9);
  }, [shape, smokeControls?.enabled, smokeCount, spread]);

  const flameMaterialRef = useRef<FireMaterialInstance>(null);
  const smokeMaterialRef = useRef<SmokeMaterialInstance>(null);

  useFrame(({ clock }) => {
    if (flameMaterialRef.current) {
      flameMaterialRef.current.uTime = clock.elapsedTime;
    }
    if (smokeMaterialRef.current) {
      smokeMaterialRef.current.uTime = clock.elapsedTime;
    }
  });

  useEffect(() => () => flameGeometry.dispose(), [flameGeometry]);
  useEffect(() => () => smokeGeometry?.dispose(), [smokeGeometry]);

  useEffect(() => {
    if (!flameMaterialRef.current) {
      return;
    }
    const material = flameMaterialRef.current;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;
  }, []);

  useEffect(() => {
    if (!smokeMaterialRef.current) {
      return;
    }
    const material = smokeMaterialRef.current;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.side = THREE.DoubleSide;
  }, [smokeGeometry]);

  useEffect(() => {
    if (!flameMaterialRef.current) {
      return;
    }
    const material = flameMaterialRef.current;
    material.uSpeed = flameControls.speed;
    material.uRise = flameControls.rise;
    material.uSize = flameControls.size;
    material.uDistortion = flameControls.distortion;
    material.uFlowStrength = flameControls.flow;
    material.uIntensity = flameControls.intensity;
    material.uFlickerStrength = flameControls.flicker;
    material.uOpacity = flameControls.opacity;
    material.uNoiseScale = flameControls.noiseScale;
    material.uColorInner = new THREE.Color(flameControls.innerColor);
    material.uColorOuter = new THREE.Color(flameControls.outerColor);
  }, [flameControls]);

  useEffect(() => {
    if (!smokeMaterialRef.current || !smokeControls) {
      return;
    }
    const material = smokeMaterialRef.current;
    material.uSpeed = smokeControls.speed;
    material.uRise = smokeControls.rise;
    material.uSize = smokeControls.size;
    material.uOpacity = smokeControls.opacity;
    material.uNoiseScale = smokeControls.noiseScale;
    material.uDrift = smokeControls.drift;
    material.uColor = new THREE.Color(smokeControls.color);
  }, [smokeControls]);

  return (
    <group {...groupProps}>
      <points
        geometry={flameGeometry}
        frustumCulled={false}
        renderOrder={2}
      >
        <fireParticlesMaterial ref={flameMaterialRef} />
      </points>
      {smokeGeometry && smokeControls?.enabled ? (
        <points geometry={smokeGeometry} frustumCulled={false} renderOrder={1}>
          <smokeParticlesMaterial ref={smokeMaterialRef} />
        </points>
      ) : null}
    </group>
  );
}

export type { FireGeometryAttributes };

