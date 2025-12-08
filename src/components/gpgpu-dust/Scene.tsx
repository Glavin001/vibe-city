"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { IUniform } from "three";
import Stats from "stats-gl";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  GPUComputationRenderer,
  type Variable,
} from "three/examples/jsm/misc/GPUComputationRenderer.js";

const MAX_COLLIDERS = 64;
const PIXELS_PER_COLLIDER = 4;
const DATA_TEXTURE_WIDTH = MAX_COLLIDERS * PIXELS_PER_COLLIDER;

const TYPE_BOX = 1;

const simplexNoise = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) { 
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;
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
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  float n1 = snoise(p + vec3(0, 0, 0));
  float n2 = snoise(p + vec3(12.3, 4.5, 6.7));
  float n3 = snoise(p + vec3(50.1, 20.2, 90.3));
  
  return vec3(n2 - n3, n3 - n1, n1 - n2);
}
`;

const sdfScene = /* glsl */ `
float sdBox( vec3 p, vec3 b ) {
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}
float sdSphere( vec3 p, float s ) {
  return length(p)-s;
}
vec3 rotateVectorInv( vec3 v, vec4 q ) {
  vec4 invQ = vec4(-q.xyz, q.w);
  return v + 2.0 * cross(invQ.xyz, cross(invQ.xyz, v) + invQ.w * v);
}
uniform sampler2D uColliderTexture;
uniform int uColliderCount;
uniform vec2 uColliderTextureSize;
vec2 map(vec3 p) {
  float d = 1e10;
  float id = -1.0;
  
  for (int i = 0; i < ${MAX_COLLIDERS}; i++) {
    if (i >= uColliderCount) break;
    float stride = 4.0;
    float texWidth = uColliderTextureSize.x;
    
    vec2 uv0 = vec2((float(i)*stride + 0.5) / texWidth, 0.5);
    vec4 data0 = texture2D(uColliderTexture, uv0);
    vec3 objPos = data0.xyz;
    float objType = data0.w;
    
    vec2 uv1 = vec2((float(i)*stride + 1.5) / texWidth, 0.5);
    vec4 objRot = texture2D(uColliderTexture, uv1);
    
    vec2 uv2 = vec2((float(i)*stride + 2.5) / texWidth, 0.5);
    vec3 objScale = texture2D(uColliderTexture, uv2).xyz;
    
    float objDist = 1e10;
    vec3 localP = p - objPos;
    
    if (objType < 0.5) {
      objDist = sdSphere(localP, objScale.x);
    } else {
      vec3 rotatedP = rotateVectorInv(localP, objRot);
      objDist = sdBox(rotatedP, objScale);
    }
    if (objDist < d) {
      d = objDist;
      id = float(i);
    }
  }
  
  return vec2(d, id);
}
vec3 getColliderVelocity(float id) {
  if (id < -0.5) return vec3(0.0);
  float stride = 4.0;
  float texWidth = uColliderTextureSize.x;
  vec2 uv = vec2((id*stride + 3.5) / texWidth, 0.5);
  return texture2D(uColliderTexture, uv).xyz;
}
vec3 calcNormal(vec3 p) {
    const float h = 0.0001; 
    const vec2 k = vec2(1,-1);
    return normalize(k.xyy*map(p + k.xyy*h).x + 
                     k.yyx*map(p + k.yyx*h).x + 
                     k.yxy*map(p + k.yxy*h).x + 
                     k.xxx*map(p + k.xxx*h).x);
}
`;

const fragmentShaderVelocity = /* glsl */ `
uniform vec2 texResolution;
uniform float time;
uniform float delta;
uniform float uGravity;
uniform float uDrag;
uniform float uTurbulence;
uniform float uSize;

${simplexNoise}
${sdfScene}

void main() {
  vec2 uv = gl_FragCoord.xy / texResolution.xy;
  vec4 posData = texture2D( texturePosition, uv );
  vec4 velData = texture2D( textureVelocity, uv );
  vec3 pos = posData.xyz;
  vec3 vel = velData.xyz;
  float life = velData.w;
  float age = posData.w;
  if (age > life) {
    vel = vec3(0.0); 
  } else {
    vel.y -= uGravity * delta; 
    vel *= uDrag; 
    vel += curlNoise(pos * 0.4 + time * 0.2) * uTurbulence * delta;
    float progress = clamp(age / life, 0.0, 1.0);
    float growth = smoothstep(0.0, 0.1, progress);
    float collRadius = uSize * 1.5 * growth;
    vec2 mapRes = map(pos);
    float dist = mapRes.x;
    float colliderID = mapRes.y;
    float surfaceDist = dist - collRadius;
    if (surfaceDist < 1.0) { 
      vec3 n = calcNormal(pos);
      vec3 colliderVel = getColliderVelocity(colliderID);
      vec3 randDir = curlNoise(pos * 15.0) * 0.8; 
      if (surfaceDist < 0.0) {
        float approachSpeed = dot(colliderVel, n);
        float escapeSpeed = 2.0; 
        if (approachSpeed > 0.0) escapeSpeed += approachSpeed;
        vec3 escapeDir = normalize(n + randDir * 0.5);
        vel = colliderVel + escapeDir * escapeSpeed;
        float penetrationDepth = collRadius - dist; 
        vel += n * (penetrationDepth / max(delta, 0.001)) * 0.5;
      } else {
        float approachSpeed = dot(colliderVel, n);
        if (approachSpeed > 0.1) {
          float factor = (1.0 - clamp(surfaceDist, 0.0, 1.0));
          vec3 pushVel = colliderVel + (n + randDir * 0.3) * (approachSpeed * 0.8 + 2.0);
          vel = mix(vel, pushVel, factor * delta * 8.0);
        } else {
          float vDotN = dot(vel - colliderVel, n);
          if (vDotN < 0.0) {
            vel -= n * vDotN;
            vel *= 0.95;
          }
        }
      }
    }
  }
  gl_FragColor = vec4( vel, life );
}
`;

const fragmentShaderPosition = /* glsl */ `
uniform vec2 texResolution;
uniform float delta;
void main() {
  vec2 uv = gl_FragCoord.xy / texResolution.xy;
  vec4 posData = texture2D( texturePosition, uv );
  vec4 velData = texture2D( textureVelocity, uv );
  vec3 pos = posData.xyz;
  vec3 vel = velData.xyz;
  float age = posData.w;
  float life = velData.w;
  age += delta;
  if (age < life) {
    pos += vel * delta;
  } else {
    pos = vec3(0.0, -1000.0, 0.0);
  }
  gl_FragColor = vec4( pos, age );
}
`;

const vertexShaderVisual = /* glsl */ `
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uPixelRatio;
uniform float uSize;
uniform float uBaseScale; 
varying float vLife;
varying float vAge;
varying float vRandom;
void main() {
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);
  vec3 worldPos = posData.xyz;
  float age = posData.w;
  float life = velData.w;
  vAge = age;
  vLife = life;
  vRandom = fract(sin(dot(uv.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float progress = clamp(age / life, 0.0, 1.0);
  float baseSize = (500.0 + 4000.0 * smoothstep(0.0, 0.1, progress)) * uSize * uBaseScale; 
  gl_PointSize = (baseSize * uPixelRatio) / -mvPosition.z;
}
`;

const fragmentShaderVisual = /* glsl */ `
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform vec2 resolution; 
uniform float uOpacity;
uniform float uDetail;
uniform float uBrightness;
varying float vAge;
varying float vLife;
varying float vRandom;
#include <packing>
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
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
float fbm(vec2 p) {
  float f = 0.0;
  float w = 0.5;
  float scale = 1.0;
  for (int i = 0; i < 3; i++) {
    f += w * snoise(p * scale);
    p *= 2.0;
    w *= 0.5;
  }
  return f;
}
float getViewZ(float depth) {
  return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
}
void main() {
  float angle = vAge * (0.1 + vRandom * 0.2) * (vRandom > 0.5 ? 1.0 : -1.0);
  float c = cos(angle);
  float s = sin(angle);
  vec2 center = gl_PointCoord - 0.5;
  vec2 rotatedUv = mat2(c, -s, s, c) * center;
  float dist = length(rotatedUv);
  float alpha = smoothstep(0.5, 0.0, dist); 
  float noiseVal = fbm(rotatedUv * uDetail + vRandom * 10.0); 
  float density = alpha * (0.5 + 0.5 * noiseVal);
  if (density < 0.01) discard;
  float z = sqrt(max(0.0, 1.0 - dist * 2.0));
  vec3 normal = normalize(vec3(rotatedUv.x + noiseVal*0.2, rotatedUv.y + noiseVal*0.2, z));
  vec3 lightDir = normalize(vec3(0.5, 1.0, 0.8));
  float diff = max(0.0, dot(normal, lightDir));
  float sceneDepth = texture2D(tDepth, gl_FragCoord.xy / resolution).r;
  float linearSceneDepth = getViewZ(sceneDepth);
  float linearParticleDepth = getViewZ(gl_FragCoord.z);
  float diffZ = linearParticleDepth - linearSceneDepth;
  float softFactor = clamp(diffZ * 0.5, 0.0, 1.0);
  vec3 colShadow = vec3(0.25, 0.23, 0.21) * uBrightness; 
  vec3 colMid = vec3(0.6, 0.58, 0.55) * uBrightness;     
  vec3 colHigh = vec3(0.9, 0.88, 0.85) * uBrightness;    
  vec3 finalColor = mix(colShadow, colMid, diff);
  finalColor = mix(finalColor, colHigh, pow(diff, 3.0)); 
  float progress = vAge / vLife;
  float fade = smoothstep(0.0, 0.1, progress) * (1.0 - smoothstep(0.6, 1.0, progress));
  gl_FragColor = vec4(finalColor, density * fade * softFactor * uOpacity);
}
`;

type SimulationParams = {
  gravity: number;
  drag: number;
  turbulence: number;
  opacity: number;
  size: number;
  detail: number;
  brightness: number;
  lifeTime: number;
  roofHeight: number;
  vehicleSpeed: number;
};

export type SceneProps = SimulationParams & {
  trigger: number;
  resolution: number;
};

interface RigidBody {
  mesh: THREE.Mesh;
  type: number;
  scale: THREE.Vector3;
  velocity: THREE.Vector3;
  update?: (time: number) => void;
}

interface ThreeRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  gpuCompute: GPUComputationRenderer;
  velocityVariable: Variable;
  positionVariable: Variable;
  velUniforms: Record<string, IUniform>;
  posUniforms: Record<string, IUniform>;
  material: THREE.ShaderMaterial;
  particleMesh: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  depthRenderTarget: THREE.WebGLRenderTarget;
  depthMaterial: THREE.MeshDepthMaterial;
  rigidBodies: RigidBody[];
  colliderTexture: THREE.DataTexture;
  colliderData: Float32Array;
  WIDTH: number;
  animationFrameId: number;
  clock: THREE.Clock;
  stats?: Stats;
}

const buildInitialParams = (params: SimulationParams): SimulationParams => ({ ...params });

const createColliderBuffer = () => new Float32Array(MAX_COLLIDERS * PIXELS_PER_COLLIDER * 4);

const fillInitialTextures = (dtPosition: THREE.DataTexture, dtVelocity: THREE.DataTexture) => {
  const posArr = dtPosition.image.data;
  const velArr = dtVelocity.image.data;
  for (let i = 0; i < posArr.length; i += 4) {
    posArr[i] = 0;
    posArr[i + 1] = -9999;
    posArr[i + 2] = 0;
    posArr[i + 3] = 100.0;

    velArr[i] = 0;
    velArr[i + 1] = 0;
    velArr[i + 2] = 0;
    velArr[i + 3] = 1.0;
  }
  dtPosition.needsUpdate = true;
  dtVelocity.needsUpdate = true;
};

const serializeRigidBodies = (rigidBodies: RigidBody[], colliderData: Float32Array) => {
  rigidBodies.forEach((rb, index) => {
    const ptr = index * PIXELS_PER_COLLIDER * 4;
    colliderData[ptr + 0] = rb.mesh.position.x;
    colliderData[ptr + 1] = rb.mesh.position.y;
    colliderData[ptr + 2] = rb.mesh.position.z;
    colliderData[ptr + 3] = rb.type;
    colliderData[ptr + 4] = rb.mesh.quaternion.x;
    colliderData[ptr + 5] = rb.mesh.quaternion.y;
    colliderData[ptr + 6] = rb.mesh.quaternion.z;
    colliderData[ptr + 7] = rb.mesh.quaternion.w;
    colliderData[ptr + 8] = rb.scale.x;
    colliderData[ptr + 9] = rb.scale.y;
    colliderData[ptr + 10] = rb.scale.z;
    colliderData[ptr + 11] = 0.0;
    colliderData[ptr + 12] = rb.velocity.x;
    colliderData[ptr + 13] = rb.velocity.y;
    colliderData[ptr + 14] = rb.velocity.z;
    colliderData[ptr + 15] = 0.0;
  });
};

export default function GPUDustScene({
  trigger,
  resolution,
  gravity,
  drag,
  turbulence,
  opacity,
  size,
  detail,
  brightness,
  lifeTime,
  roofHeight,
  vehicleSpeed,
}: SceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ThreeRuntime | null>(null);
  const paramsRef = useRef<SimulationParams>(
    buildInitialParams({
      gravity,
      drag,
      turbulence,
      opacity,
      size,
      detail,
      brightness,
      lifeTime,
      roofHeight,
      vehicleSpeed,
    }),
  );

  paramsRef.current = {
    gravity,
    drag,
    turbulence,
    opacity,
    size,
    detail,
    brightness,
    lifeTime,
    roofHeight,
    vehicleSpeed,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const initialParams = paramsRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 15, 40);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const stats = new Stats({
      trackGPU: true,
      logsPerSecond: 20,
      graphsPerSecond: 30,
      minimal: true,
    });
    stats.init(renderer);
    stats.dom.style.position = "absolute";
    stats.dom.style.top = "12px";
    stats.dom.style.left = "12px";
    stats.dom.style.pointerEvents = "none";
    stats.dom.style.zIndex = "5";
    container.appendChild(stats.dom);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 5, 0);
    controls.enableDamping = true;

    const depthRenderTarget = new THREE.WebGLRenderTarget(width, height);
    depthRenderTarget.texture.minFilter = THREE.NearestFilter;
    depthRenderTarget.texture.magFilter = THREE.NearestFilter;
    depthRenderTarget.texture.generateMipmaps = false;
    depthRenderTarget.depthTexture = new THREE.DepthTexture(width, height);
    depthRenderTarget.depthTexture.type = THREE.UnsignedShortType;

    const depthMaterial = new THREE.MeshDepthMaterial();
    depthMaterial.depthPacking = THREE.BasicDepthPacking;

    const obstacles = new THREE.Group();
    const rigidBodies: RigidBody[] = [];

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 60),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    obstacles.add(floor);

    const addCollider = (mesh: THREE.Mesh, type: number, scale: THREE.Vector3, update?: (t: number) => void) => {
      obstacles.add(mesh);
      rigidBodies.push({ mesh, type, scale, velocity: new THREE.Vector3(), update });
    };

    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(40, 12, 2),
      new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.6 }),
    );
    backWall.position.set(0, 6, -10);
    addCollider(backWall, TYPE_BOX, new THREE.Vector3(20, 6, 1));

    for (let i = -1; i <= 1; i += 2) {
      const barrier = new THREE.Mesh(
        new THREE.BoxGeometry(60, 2, 1),
        new THREE.MeshStandardMaterial({ color: 0xff4444, roughness: 0.7 }),
      );
      barrier.position.set(0, 1, i * 8);
      addCollider(barrier, TYPE_BOX, new THREE.Vector3(30, 1, 0.5));
    }

    const vehicleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(12, 7.5, 7.0),
      new THREE.MeshStandardMaterial({ color: 0x00ffcc, roughness: 0.3, metalness: 0.4 }),
    );
    vehicleMesh.position.y = 3.75;

    const wheelGeo = new THREE.CylinderGeometry(1.5, 1.5, 1.0, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wheelPositions: [number, number, number][] = [
      [-4.0, -2.25, 3.6],
      [4.0, -2.25, 3.6],
      [-4.0, -2.25, -3.6],
      [4.0, -2.25, -3.6],
    ];
    wheelPositions.forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, y, z);
      vehicleMesh.add(wheel);
    });

    addCollider(vehicleMesh, TYPE_BOX, new THREE.Vector3(6, 3.75, 3.5), (t) => {
      const speed = paramsRef.current.vehicleSpeed;
      const range = 40.0;
      vehicleMesh.position.x = ((t * speed) % (range * 2)) - range;
    });

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(30, 1, 15),
      new THREE.MeshStandardMaterial({ color: 0x4488ff, roughness: 0.5 }),
    );
    roof.position.set(0, paramsRef.current.roofHeight, 0);
    addCollider(roof, TYPE_BOX, new THREE.Vector3(15, 0.5, 7.5), () => {
      roof.position.y = paramsRef.current.roofHeight;
    });

    scene.add(obstacles);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const colliderData = createColliderBuffer();
    const colliderTexture = new THREE.DataTexture(
      colliderData,
      DATA_TEXTURE_WIDTH,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    colliderTexture.needsUpdate = true;

    const WIDTH = resolution;
    const gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);
    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    fillInitialTextures(dtPosition, dtVelocity);

    const velocityVariable = gpuCompute.addVariable("textureVelocity", fragmentShaderVelocity, dtVelocity);
    const positionVariable = gpuCompute.addVariable("texturePosition", fragmentShaderPosition, dtPosition);
    gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);
    gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);

    const velUniforms = velocityVariable.material.uniforms as Record<string, IUniform>;
    velUniforms["time"] = { value: 0.0 };
    velUniforms["delta"] = { value: 0.0 };
    velUniforms["texResolution"] = { value: new THREE.Vector2(WIDTH, WIDTH) };
    velUniforms["uGravity"] = { value: initialParams.gravity };
    velUniforms["uDrag"] = { value: initialParams.drag };
    velUniforms["uTurbulence"] = { value: initialParams.turbulence };
    velUniforms["uSize"] = { value: initialParams.size };
    velUniforms["uColliderTexture"] = { value: colliderTexture };
    velUniforms["uColliderCount"] = { value: rigidBodies.length };
    velUniforms["uColliderTextureSize"] = { value: new THREE.Vector2(DATA_TEXTURE_WIDTH, 1) };

    const posUniforms = positionVariable.material.uniforms as Record<string, IUniform>;
    posUniforms["delta"] = { value: 0.0 };
    posUniforms["texResolution"] = { value: new THREE.Vector2(WIDTH, WIDTH) };

    const error = gpuCompute.init();
    if (error) {
      console.error("GPUComputationRenderer init error:", error);
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(WIDTH * WIDTH * 3);
    const uvs = new Float32Array(WIDTH * WIDTH * 2);
    let p = 0;
    for (let j = 0; j < WIDTH; j++) {
      for (let i = 0; i < WIDTH; i++) {
        const u = (i + 0.5) / WIDTH;
        const v = (j + 0.5) / WIDTH;
        uvs[p * 2] = u;
        uvs[p * 2 + 1] = v;
        positions[p * 3] = 0;
        positions[p * 3 + 1] = 0;
        positions[p * 3 + 2] = 0;
        p++;
      }
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    const baseScale = Math.sqrt(256 / WIDTH);

    const material = new THREE.ShaderMaterial({
      vertexShader: vertexShaderVisual,
      fragmentShader: fragmentShaderVisual,
      uniforms: {
        texturePosition: { value: null },
        textureVelocity: { value: null },
        tDepth: { value: null },
        uPixelRatio: { value: Math.min(window.devicePixelRatio ?? 1, 2) },
        uOpacity: { value: initialParams.opacity },
        uSize: { value: initialParams.size },
        uDetail: { value: initialParams.detail },
        uBrightness: { value: initialParams.brightness },
        uBaseScale: { value: baseScale },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
        resolution: { value: new THREE.Vector2(width, height) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const particleMesh = new THREE.Points(geometry, material);
    particleMesh.frustumCulled = false;
    scene.add(particleMesh);

    const clock = new THREE.Clock();

    const runtime: ThreeRuntime = {
      scene,
      camera,
      renderer,
      controls,
      gpuCompute,
      velocityVariable,
      positionVariable,
      velUniforms,
      posUniforms,
      material,
      particleMesh,
      depthRenderTarget,
      depthMaterial,
      rigidBodies,
      colliderTexture,
      colliderData,
      WIDTH,
      animationFrameId: 0,
      clock,
      stats,
    };

    runtimeRef.current = runtime;

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      depthRenderTarget.setSize(w, h);
      material.uniforms.resolution.value.set(w, h);
      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio ?? 1, 2);
    };

    window.addEventListener("resize", handleResize);

    const animate = () => {
      runtime.animationFrameId = requestAnimationFrame(animate);
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.1);
      const time = clock.getElapsedTime();

      controls.update();

      rigidBodies.forEach((rb) => {
        const prevPos = rb.mesh.position.clone();
        if (rb.update) rb.update(time);
        if (dt > 0.0001) {
          rb.velocity.copy(rb.mesh.position).sub(prevPos).divideScalar(dt);
        } else {
          rb.velocity.set(0, 0, 0);
        }
      });

      serializeRigidBodies(rigidBodies, colliderData);
      colliderTexture.needsUpdate = true;

      velUniforms["time"].value = time;
      velUniforms["delta"].value = dt;
      posUniforms["delta"].value = dt;
      velUniforms["uGravity"].value = paramsRef.current.gravity;
      velUniforms["uDrag"].value = paramsRef.current.drag;
      velUniforms["uTurbulence"].value = paramsRef.current.turbulence;
      velUniforms["uSize"].value = paramsRef.current.size;
      material.uniforms.uOpacity.value = paramsRef.current.opacity;
      material.uniforms.uSize.value = paramsRef.current.size;
      material.uniforms.uDetail.value = paramsRef.current.detail;
      material.uniforms.uBrightness.value = paramsRef.current.brightness;

      gpuCompute.compute();

      particleMesh.visible = false;
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(depthRenderTarget);
      renderer.render(scene, camera);

      renderer.setRenderTarget(null);
      scene.overrideMaterial = null;
      particleMesh.visible = true;

      material.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;
      material.uniforms.textureVelocity.value = gpuCompute.getCurrentRenderTarget(velocityVariable).texture;
      material.uniforms.tDepth.value = depthRenderTarget.depthTexture;

      renderer.render(scene, camera);
      runtime.stats?.update();
    };

    animate();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(runtime.animationFrameId);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      depthRenderTarget.dispose();
      depthRenderTarget.depthTexture?.dispose();
      colliderTexture.dispose();
      gpuCompute.dispose();
      renderer.dispose();
      scene.clear();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
      stats.dom.remove();
      runtimeRef.current = null;
    };
  }, [resolution]);

  useEffect(() => {
    if (trigger === 0) return;
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const { gpuCompute, velocityVariable, positionVariable } = runtime;
    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    const posData = dtPosition.image.data;
    const velData = dtVelocity.image.data;
    const lifeScale = paramsRef.current.lifeTime;

    for (let i = 0; i < posData.length; i += 4) {
      const r = 1.5 * Math.cbrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = 5.0 + r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      posData[i] = x;
      posData[i + 1] = y;
      posData[i + 2] = z;
      posData[i + 3] = 0.0;

      const speed = 15.0 + Math.random() * 45.0;
      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.sin(phi) * Math.sin(theta);
      const dirZ = Math.cos(phi);
      velData[i] = dirX * speed;
      velData[i + 1] = dirY * speed;
      velData[i + 2] = dirZ * speed;
      velData[i + 3] = (3.0 + Math.random() * 2.0) * lifeScale;
    }

    dtPosition.needsUpdate = true;
    dtVelocity.needsUpdate = true;

    gpuCompute.renderTexture(dtPosition, positionVariable.renderTargets[0]);
    gpuCompute.renderTexture(dtPosition, positionVariable.renderTargets[1]);
    gpuCompute.renderTexture(dtVelocity, velocityVariable.renderTargets[0]);
    gpuCompute.renderTexture(dtVelocity, velocityVariable.renderTargets[1]);
  }, [trigger]);

  return <div ref={containerRef} className="h-full w-full" />;
}


