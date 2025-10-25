"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { createNoise2D } from "simplex-noise";

const SIM_SIZE = 512;
const TERRAIN_SIZE = 180;
const HEIGHTMAP_SIZE = 256;
const HEIGHT_SCALE = 8;
const BURST_DEFAULT = 8000;
const MAX_SPHERES = 4;
const MAX_BOXES = 6;

const velocityFragment = /* glsl */ `
precision highp float;
precision highp sampler2D;

#include <common>

uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uTime;
uniform float uDelta;

uniform vec3  uGravity;
uniform float uDrag;
uniform float uBounce;
uniform float uFriction;

uniform sampler2D uHeightTex;
uniform vec2  uTerrainMin;
uniform vec2  uTerrainMax;
uniform float uHeightScale;
uniform vec2  uHeightTexel;

uniform int uSphereCount;
uniform vec4 uSpheres[${MAX_SPHERES}];
uniform int uBoxCount;
uniform vec4 uBoxesMin[${MAX_BOXES}];
uniform vec4 uBoxesMax[${MAX_BOXES}];

uniform int uCapacity;
uniform ivec2 uResolution;
uniform int uSpawnStartA, uSpawnCountA;
uniform int uSpawnStartB, uSpawnCountB;
uniform vec3 uSpawnPos;
uniform vec3 uSpawnDir;
uniform vec2 uSpawnSpeedRange;
uniform float uSpawnSpread;
uniform float uSpawnTTL;
uniform int uSpawnType;

int indexOfFrag() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  return pix.x + pix.y * uResolution.x;
}

float hash12(vec2 p) {
  vec3 p3  = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 worldToHeightUV(vec2 xz) {
  vec2 uv = (xz - uTerrainMin) / (uTerrainMax - uTerrainMin);
  return clamp(uv, 0.0, 1.0);
}

float terrainHeight(vec2 xz) {
  vec2 uv = worldToHeightUV(xz);
  return texture2D(uHeightTex, uv).r * uHeightScale;
}

vec3 terrainNormal(vec2 xz) {
  vec2 uv = worldToHeightUV(xz);
  float hL = texture2D(uHeightTex, uv - vec2(uHeightTexel.x, 0.0)).r * uHeightScale;
  float hR = texture2D(uHeightTex, uv + vec2(uHeightTexel.x, 0.0)).r * uHeightScale;
  float hD = texture2D(uHeightTex, uv - vec2(0.0, uHeightTexel.y)).r * uHeightScale;
  float hU = texture2D(uHeightTex, uv + vec2(0.0, uHeightTexel.y)).r * uHeightScale;
  vec3 n = normalize(vec3(hL - hR, 2.0, hD - hU));
  return n;
}

void collideTerrain(inout vec3 p, inout vec3 v) {
  float h = terrainHeight(p.xz);
  if (p.y < h) {
    vec3 n = terrainNormal(p.xz);
    p.y = h + 0.001;
    float vn = dot(v, n);
    if (vn < 0.0) v -= (1.0 + uBounce) * vn * n;
    v -= uFriction * (v - dot(v, n) * n);
  }
}

void collideSphere(inout vec3 p, inout vec3 v, vec3 c, float r) {
  vec3 d = p - c;
  float dist = length(d);
  if (dist < r) {
    vec3 n = d / max(dist, 1e-6);
    p = c + n * (r + 0.001);
    float vn = dot(v, n);
    if (vn < 0.0) v -= (1.0 + uBounce) * vn * n;
    v -= uFriction * (v - dot(v, n) * n);
  }
}

float sdBox(vec3 p, vec3 c, vec3 b) {
  vec3 d = abs(p - c) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

vec3 boxNormal(vec3 p, vec3 c, vec3 b) {
  float eps = 0.01;
  float d0 = sdBox(p, c, b);
  vec3 n;
  n.x = sdBox(p + vec3(eps,0,0), c, b) - d0;
  n.y = sdBox(p + vec3(0,eps,0), c, b) - d0;
  n.z = sdBox(p + vec3(0,0,eps), c, b) - d0;
  return normalize(n);
}

void collideAABB(inout vec3 p, inout vec3 v, vec3 bmin, vec3 bmax) {
  vec3 c = 0.5 * (bmin + bmax);
  vec3 half = 0.5 * (bmax - bmin);
  float d = sdBox(p, c, half);
  if (d < 0.0) {
    vec3 n = boxNormal(p, c, half);
    p -= n * (d - 0.001);
    float vn = dot(v, n);
    if (vn < 0.0) v -= (1.0 + uBounce) * vn * n;
    v -= uFriction * (v - dot(v, n) * n);
  }
}

vec3 randDirInCone(vec3 dir, float spread, float rnd1, float rnd2) {
  float cosT = mix(1.0, cos(spread), rnd1);
  float sinT = sqrt(max(0.0, 1.0 - cosT*cosT));
  float phi = 6.2831853 * rnd2;
  vec3 w = normalize(dir);
  vec3 u = normalize(abs(w.y) < 0.999 ? cross(vec3(0,1,0), w) : cross(vec3(1,0,0), w));
  vec3 v = cross(w, u);
  return normalize(u * cos(phi) * sinT + v * sin(phi) * sinT + w * cosT);
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(uResolution);
  vec4 pos4 = texture2D(texturePosition, uv);
  vec4 vel4 = texture2D(textureVelocity, uv);
  vec3 p = pos4.xyz;
  vec3 v = vel4.xyz;
  float type = vel4.w;

  int idx = indexOfFrag();
  bool spawnHere = false;
  if (uSpawnCountA > 0 && idx >= uSpawnStartA && idx < (uSpawnStartA + uSpawnCountA)) spawnHere = true;
  if (uSpawnCountB > 0 && idx >= uSpawnStartB && idx < (uSpawnStartB + uSpawnCountB)) spawnHere = true;

  if (spawnHere) {
    float r1 = hash12(vec2(float(idx), uTime));
    float r2 = hash12(vec2(float(idx) + 17.0, uTime * 0.73));
    float r3 = hash12(vec2(float(idx) + 31.0, uTime * 1.37));
    vec3 dir = randDirInCone(normalize(uSpawnDir), uSpawnSpread, r1, r2);
    float speed = mix(uSpawnSpeedRange.x, uSpawnSpeedRange.y, r3);
    v = dir * speed;
    type = float(uSpawnType);
    gl_FragColor = vec4(v, type);
    return;
  }

  v += uGravity * uDelta;
  float drag = clamp(uDrag, 0.0, 20.0);
  v *= exp(-drag * uDelta);

  collideTerrain(p, v);

  for (int i=0; i<${MAX_SPHERES}; ++i) {
    if (i >= uSphereCount) break;
    vec3 c = uSpheres[i].xyz;
    float r = uSpheres[i].w;
    collideSphere(p, v, c, r);
  }

  for (int i=0; i<${MAX_BOXES}; ++i) {
    if (i >= uBoxCount) break;
    vec3 bmin = uBoxesMin[i].xyz;
    vec3 bmax = uBoxesMax[i].xyz;
    collideAABB(p, v, bmin, bmax);
  }

  gl_FragColor = vec4(v, type);
}
`;

const positionFragment = /* glsl */ `
precision highp float;
precision highp sampler2D;

uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;

uniform float uDelta;
uniform float uBaseTTL;
uniform float uRestKillRate;
uniform float uRestSpeed;

uniform int uCapacity;
uniform ivec2 uResolution;
uniform int uSpawnStartA, uSpawnCountA;
uniform int uSpawnStartB, uSpawnCountB;
uniform vec3 uSpawnPos;
uniform float uSpawnTTL;

int indexOfFrag() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  return pix.x + pix.y * uResolution.x;
}

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(uResolution);
  vec4 pos4 = texture2D(texturePosition, uv);
  vec4 vel4 = texture2D(textureVelocity, uv);

  vec3 p = pos4.xyz;
  float ttl = pos4.w;
  vec3 v = vel4.xyz;

  int idx = indexOfFrag();
  bool spawnHere = false;
  if (uSpawnCountA > 0 && idx >= uSpawnStartA && idx < (uSpawnStartA + uSpawnCountA)) spawnHere = true;
  if (uSpawnCountB > 0 && idx >= uSpawnStartB && idx < (uSpawnStartB + uSpawnCountB)) spawnHere = true;

  if (spawnHere) {
    p = uSpawnPos;
    ttl = uSpawnTTL;
    gl_FragColor = vec4(p, ttl);
    return;
  }

  p += v * uDelta;

  float speed = length(v);
  float drain = uDelta;
  if (speed < uRestSpeed) drain += uRestKillRate * uDelta;
  ttl = max(0.0, ttl - drain);

  if (ttl <= 0.0) {
    p.y = -9999.0;
  }

  gl_FragColor = vec4(p, ttl);
}
`;

const pointsVert = /* glsl */ `
precision highp float;
attribute vec2 aRef;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform float uSizeBase;
uniform float uSizeConcrete;
uniform float uSizeSparks;
uniform float uSizeDust;

varying float vType;
varying float vLife;

void main() {
  vec4 pos4 = texture2D(uPosTex, aRef);
  vec4 vel4 = texture2D(uVelTex, aRef);
  vec3 pos = pos4.xyz;
  float ttl = pos4.w;
  float type = vel4.w;

  vType = type;
  vLife = ttl;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = uSizeBase;
  if (type < 0.5) size = uSizeConcrete;
  else if (type < 1.5) size = uSizeSparks;
  else size = uSizeDust;

  gl_PointSize = size * (300.0 / -mv.z);
}
`;

const pointsFrag = /* glsl */ `
precision highp float;
varying float vType;
varying float vLife;

void main() {
  vec2 r = gl_PointCoord * 2.0 - 1.0;
  float d = dot(r, r);
  if (d > 1.0) discard;

  vec3 col;
  if (vType < 0.5) {
    col = vec3(0.75, 0.74, 0.72);
  } else if (vType < 1.5) {
    col = mix(vec3(1.0,0.5,0.1), vec3(1.0,0.9,0.2), clamp(1.0 - d, 0.0, 1.0));
  } else {
    col = vec3(0.62, 0.55, 0.45);
  }

  float alpha = smoothstep(1.0, 0.0, d);
  alpha *= clamp(vLife * 0.5, 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
}
`;

type DebrisMode = "concrete" | "sparks" | "dust";

type SphereCollider = {
  mesh: THREE.Mesh;
  radius: number;
};

type BoxCollider = {
  mesh: THREE.Mesh;
};

type UniformRecord = Record<string, { value: unknown }>;

export default function GPUDebrisPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const burstRef = useRef(BURST_DEFAULT);
  const modeRef = useRef<DebrisMode>("concrete");
  const [burst, setBurst] = useState(BURST_DEFAULT);
  const [mode, setMode] = useState<DebrisMode>("concrete");

  useEffect(() => {
    burstRef.current = burst;
  }, [burst]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1115);
    scene.fog = new THREE.Fog(0x0f1115, 120, 260);

    const camera = new THREE.PerspectiveCamera(60, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 1000);
    camera.position.set(0, 30, 80);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 15, 0);
    controls.enableDamping = true;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.7);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 100, 20);
    scene.add(dir);

    const { heightTexture, heightData, min: terrMin, max: terrMax } = makeHeightmap(HEIGHTMAP_SIZE, HEIGHTMAP_SIZE, TERRAIN_SIZE, TERRAIN_SIZE, HEIGHT_SCALE);
    const terrainGeom = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, HEIGHTMAP_SIZE - 1, HEIGHTMAP_SIZE - 1);
    applyHeightToPlane(terrainGeom, heightData, HEIGHTMAP_SIZE, HEIGHTMAP_SIZE, HEIGHT_SCALE);
    terrainGeom.rotateX(-Math.PI / 2);
    terrainGeom.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.0, roughness: 0.9 });
    const terrain = new THREE.Mesh(terrainGeom, terrainMat);
    scene.add(terrain);

    const wallGeom = new THREE.BoxGeometry(40, 20, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x7f7f7f, roughness: 0.8, metalness: 0.0 });
    const wall = new THREE.Mesh(wallGeom, wallMat);
    wall.position.set(0, 10, -25);
    scene.add(wall);

    const colliders = {
      spheres: [] as SphereCollider[],
      boxes: [] as BoxCollider[],
    };

    const sphereMat = new THREE.MeshStandardMaterial({ color: 0x5b8cff, roughness: 0.6, metalness: 0.1 });
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 16), sphereMat);
    s1.position.set(-18, 5.5, -5);
    scene.add(s1);
    colliders.spheres.push({ mesh: s1, radius: 5 });

    const s2 = new THREE.Mesh(new THREE.SphereGeometry(3.5, 24, 16), sphereMat);
    s2.position.set(8, 4, 2);
    scene.add(s2);
    colliders.spheres.push({ mesh: s2, radius: 3.5 });

    const boxMat = new THREE.MeshStandardMaterial({ color: 0xffa66f, roughness: 0.7, metalness: 0.0 });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 8), boxMat);
    b1.position.set(-2, 2, 10);
    scene.add(b1);
    colliders.boxes.push(makeBoxCollider(b1));

    const b2 = new THREE.Mesh(new THREE.BoxGeometry(6, 10, 6), boxMat);
    b2.position.set(16, 5, -2);
    scene.add(b2);
    colliders.boxes.push(makeBoxCollider(b2));

    const WIDTH = SIM_SIZE;
    const HEIGHT = SIM_SIZE;
    const gpu = new GPUComputationRenderer(WIDTH, HEIGHT, renderer);

    const dtPos = gpu.createTexture();
    const dtVel = gpu.createTexture();
    seedInitialTextures(dtPos, dtVel, WIDTH, HEIGHT);

    const posVar = gpu.addVariable("texturePosition", positionFragment, dtPos);
    const velVar = gpu.addVariable("textureVelocity", velocityFragment, dtVel);

    gpu.setVariableDependencies(posVar, [posVar, velVar]);
    gpu.setVariableDependencies(velVar, [posVar, velVar]);

    const posUniforms = posVar.material.uniforms as UniformRecord;
    const velUniforms = velVar.material.uniforms as UniformRecord;

    posUniforms.uDelta = { value: 0 };
    posUniforms.uBaseTTL = { value: 6.0 };
    posUniforms.uRestKillRate = { value: 3.0 };
    posUniforms.uRestSpeed = { value: 0.6 };
    posUniforms.uCapacity = { value: WIDTH * HEIGHT };
    posUniforms.uResolution = { value: new THREE.Vector2(WIDTH, HEIGHT) };
    posUniforms.uSpawnStartA = { value: 0 };
    posUniforms.uSpawnCountA = { value: 0 };
    posUniforms.uSpawnStartB = { value: 0 };
    posUniforms.uSpawnCountB = { value: 0 };
    posUniforms.uSpawnPos = { value: new THREE.Vector3() };
    posUniforms.uSpawnTTL = { value: 5.0 };

    velUniforms.texturePosition = { value: null };
    velUniforms.textureVelocity = { value: null };
    velUniforms.uTime = { value: 0 };
    velUniforms.uDelta = { value: 0 };
    velUniforms.uGravity = { value: new THREE.Vector3(0, -25, 0) };
    velUniforms.uDrag = { value: 0.6 };
    velUniforms.uBounce = { value: 0.25 };
    velUniforms.uFriction = { value: 0.35 };
    velUniforms.uHeightTex = { value: heightTexture };
    velUniforms.uTerrainMin = { value: new THREE.Vector2(terrMin.x, terrMin.y) };
    velUniforms.uTerrainMax = { value: new THREE.Vector2(terrMax.x, terrMax.y) };
    velUniforms.uHeightScale = { value: HEIGHT_SCALE };
    velUniforms.uHeightTexel = { value: new THREE.Vector2(1 / HEIGHTMAP_SIZE, 1 / HEIGHTMAP_SIZE) };
    velUniforms.uSphereCount = { value: 0 };
    velUniforms.uSpheres = { value: createVector4Array(MAX_SPHERES) };
    velUniforms.uBoxCount = { value: 0 };
    velUniforms.uBoxesMin = { value: createVector4Array(MAX_BOXES) };
    velUniforms.uBoxesMax = { value: createVector4Array(MAX_BOXES) };
    velUniforms.uCapacity = { value: WIDTH * HEIGHT };
    velUniforms.uResolution = { value: new THREE.Vector2(WIDTH, HEIGHT) };
    velUniforms.uSpawnStartA = { value: 0 };
    velUniforms.uSpawnCountA = { value: 0 };
    velUniforms.uSpawnStartB = { value: 0 };
    velUniforms.uSpawnCountB = { value: 0 };
    velUniforms.uSpawnPos = { value: new THREE.Vector3() };
    velUniforms.uSpawnDir = { value: new THREE.Vector3() };
    velUniforms.uSpawnSpeedRange = { value: new THREE.Vector2(10, 45) };
    velUniforms.uSpawnSpread = { value: THREE.MathUtils.degToRad(28) };
    velUniforms.uSpawnTTL = { value: 5.0 };
    velUniforms.uSpawnType = { value: 0 };

    const initError = gpu.init();
    if (initError) {
      console.error(initError);
    }

    const pointsGeom = new THREE.BufferGeometry();
    const refs = new Float32Array(WIDTH * HEIGHT * 2);
    let ptr = 0;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        refs[ptr] = (x + 0.5) / WIDTH;
        refs[ptr + 1] = (y + 0.5) / HEIGHT;
        ptr += 2;
      }
    }
    pointsGeom.setAttribute("aRef", new THREE.BufferAttribute(refs, 2));
    pointsGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(WIDTH * HEIGHT * 3), 3));
    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null },
        uVelTex: { value: null },
        uSizeBase: { value: 1.0 },
        uSizeConcrete: { value: 2.0 },
        uSizeSparks: { value: 1.4 },
        uSizeDust: { value: 2.2 },
      },
      vertexShader: pointsVert,
      fragmentShader: pointsFrag,
      blending: THREE.NormalBlending,
      depthWrite: false,
      transparent: true,
    });
    const points = new THREE.Points(pointsGeom, pointsMat);
    scene.add(points);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let spawnHead = 0;

    const onPointerDown = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObject(wall, false)[0];
      if (!hit) {
        return;
      }

      const point = hit.point.clone();
      const dirNorm = hit.face
        ? hit.face.normal.clone().transformDirection(wall.matrixWorld)
        : raycaster.ray.direction.clone();

      applyModeToUniforms(velUniforms, posUniforms, points, modeRef.current);
      uploadColliders(colliders, velUniforms);

      const capacity = WIDTH * HEIGHT;
      const burstSize = Math.min(burstRef.current, capacity);
      const startA = spawnHead;
      const end = startA + burstSize;
      const overflow = Math.max(0, end - capacity);
      const countA = overflow > 0 ? burstSize - overflow : burstSize;
      const startB = 0;
      const countB = overflow;

      (posUniforms.uSpawnPos.value as THREE.Vector3).copy(point);
      posUniforms.uSpawnTTL.value = velUniforms.uSpawnTTL.value;

      posUniforms.uSpawnStartA.value = startA;
      posUniforms.uSpawnCountA.value = countA;
      posUniforms.uSpawnStartB.value = startB;
      posUniforms.uSpawnCountB.value = countB;

      (velUniforms.uSpawnPos.value as THREE.Vector3).copy(point);
      (velUniforms.uSpawnDir.value as THREE.Vector3).copy(dirNorm);
      velUniforms.uSpawnStartA.value = startA;
      velUniforms.uSpawnCountA.value = countA;
      velUniforms.uSpawnStartB.value = startB;
      velUniforms.uSpawnCountB.value = countB;
      velUniforms.uSpawnType.value = modeToType(modeRef.current);

      spawnHead = (startA + burstSize) % capacity;
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    let lastT = performance.now() * 0.001;
    let raf = 0;

    const animate = () => {
      const now = performance.now() * 0.001;
      const dt = Math.min(0.033, Math.max(0.001, now - lastT));
      lastT = now;

      controls.update();

      posUniforms.uSpawnCountA.value = 0;
      posUniforms.uSpawnCountB.value = 0;
      velUniforms.uSpawnCountA.value = 0;
      velUniforms.uSpawnCountB.value = 0;

      velUniforms.uTime.value = now;
      velUniforms.uDelta.value = dt;
      posUniforms.uDelta.value = dt;

      gpu.compute();

      const currPos = gpu.getCurrentRenderTarget(posVar).texture;
      const currVel = gpu.getCurrentRenderTarget(velVar).texture;
      pointsMat.uniforms.uPosTex.value = currPos;
      pointsMat.uniforms.uVelTex.value = currVel;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    animate();

    const onResize = () => {
      if (!containerRef.current) {
        return;
      }
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      cancelAnimationFrame(raf);
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100vh", overflow: "hidden" }}
    >
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          padding: "10px 12px",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          borderRadius: 8,
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          lineHeight: 1.4,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>GPU Debris (Three.js + GPGPU)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <label htmlFor="debris-mode">Mode:</label>
          <select
            id="debris-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as DebrisMode)}
          >
            <option value="concrete">Concrete</option>
            <option value="sparks">Sparks</option>
            <option value="dust">Dust</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <label htmlFor="burst-range">Burst size:</label>
          <input
            id="burst-range"
            type="range"
            min={500}
            max={20000}
            step={500}
            value={burst}
            onChange={(event) => setBurst(Number.parseInt(event.target.value, 10))}
          />
          <span style={{ minWidth: 50, textAlign: "right" }}>{burst}</span>
        </div>
        <div style={{ opacity: 0.8 }}>Click the wall to spawn particles.</div>
        <div style={{ opacity: 0.65, fontSize: 12, marginTop: 4 }}>
          Resolution fixed at {SIM_SIZE}×{SIM_SIZE}. Increase constant for ~1M particles.
        </div>
      </div>
    </div>
  );
}

function modeToType(mode: DebrisMode) {
  if (mode === "sparks") {
    return 1;
  }
  if (mode === "dust") {
    return 2;
  }
  return 0;
}

function createVector4Array(length: number) {
  return Array.from({ length }, () => new THREE.Vector4());
}

function makeBoxCollider(mesh: THREE.Mesh) {
  return { mesh } satisfies BoxCollider;
}

function uploadColliders(
  colliders: { spheres: SphereCollider[]; boxes: BoxCollider[] },
  velUniforms: UniformRecord,
) {
  const sphereCount = Math.min(colliders.spheres.length, MAX_SPHERES);
  const boxCount = Math.min(colliders.boxes.length, MAX_BOXES);

  velUniforms.uSphereCount.value = sphereCount;
  velUniforms.uBoxCount.value = boxCount;

  for (let i = 0; i < MAX_SPHERES; i += 1) {
    const target = velUniforms.uSpheres.value as THREE.Vector4[];
    if (i < sphereCount) {
      const sphere = colliders.spheres[i];
      target[i].set(sphere.mesh.position.x, sphere.mesh.position.y, sphere.mesh.position.z, sphere.radius);
    } else {
      target[i].set(0, 0, 0, -1);
    }
  }

  for (let i = 0; i < MAX_BOXES; i += 1) {
    const minTarget = velUniforms.uBoxesMin.value as THREE.Vector4[];
    const maxTarget = velUniforms.uBoxesMax.value as THREE.Vector4[];
    if (i < boxCount) {
      const box = colliders.boxes[i];
      const bounds = new THREE.Box3().setFromObject(box.mesh);
      minTarget[i].set(bounds.min.x, bounds.min.y, bounds.min.z, 0);
      maxTarget[i].set(bounds.max.x, bounds.max.y, bounds.max.z, 0);
    } else {
      minTarget[i].set(0, 0, 0, 0);
      maxTarget[i].set(0, 0, 0, 0);
    }
  }
}

function seedInitialTextures(dtPos: THREE.DataTexture, dtVel: THREE.DataTexture, width: number, height: number) {
  const pxPos = dtPos.image.data as Float32Array;
  const pxVel = dtVel.image.data as Float32Array;
  const total = width * height;
  for (let i = 0; i < total; i += 1) {
    pxPos[i * 4 + 0] = 0;
    pxPos[i * 4 + 1] = -9999;
    pxPos[i * 4 + 2] = 0;
    pxPos[i * 4 + 3] = 0;

    pxVel[i * 4 + 0] = 0;
    pxVel[i * 4 + 1] = 0;
    pxVel[i * 4 + 2] = 0;
    pxVel[i * 4 + 3] = 0;
  }
}

function applyModeToUniforms(
  velUniforms: UniformRecord,
  posUniforms: UniformRecord,
  points: THREE.Points,
  mode: DebrisMode,
) {
  let drag = 0.6;
  let bounce = 0.25;
  let friction = 0.5;
  let ttl = 5.0;
  let spread = THREE.MathUtils.degToRad(28);
  let speedMin = 12;
  let speedMax = 42;

  if (mode === "sparks") {
    drag = 0.15;
    bounce = 0.35;
    friction = 0.15;
    ttl = 2.0;
    spread = THREE.MathUtils.degToRad(20);
    speedMin = 25;
    speedMax = 80;
    (points.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;
  } else {
    (points.material as THREE.ShaderMaterial).blending = THREE.NormalBlending;
  }

  if (mode === "dust") {
    drag = 1.4;
    bounce = 0.05;
    friction = 0.2;
    ttl = 7.0;
    spread = THREE.MathUtils.degToRad(45);
    speedMin = 5;
    speedMax = 18;
  }

  velUniforms.uDrag.value = drag;
  velUniforms.uBounce.value = bounce;
  velUniforms.uFriction.value = friction;
  velUniforms.uSpawnSpread.value = spread;
  (velUniforms.uSpawnSpeedRange.value as THREE.Vector2).set(speedMin, speedMax);
  velUniforms.uSpawnTTL.value = ttl;
  posUniforms.uSpawnTTL.value = ttl;
}

function makeHeightmap(
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
  heightScale: number,
) {
  const noise2D = createNoise2D(makeSeededRandom("gpu-debris"));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      let e =
        1.0 * noise2D(nx * 0.7, ny * 0.7) +
        0.5 * noise2D(nx * 1.4 + 100.0, ny * 1.4 + 100.0) +
        0.25 * noise2D(nx * 2.8 + 200.0, ny * 2.8 + 200.0);
      e = e / (1.0 + 0.5 + 0.25);
      const heightValue = e * 0.5 + 0.5;
      data[x + y * width] = heightValue;
    }
  }

  const texture = new THREE.DataTexture(new Float32Array(width * height * 4), width, height, THREE.RGBAFormat, THREE.FloatType);
  const arr = texture.image.data as Float32Array;
  for (let i = 0; i < width * height; i += 1) {
    const value = data[i];
    arr[i * 4 + 0] = value;
    arr[i * 4 + 1] = 0;
    arr[i * 4 + 2] = 0;
    arr[i * 4 + 3] = 1;
  }
  texture.needsUpdate = true;

  return {
    heightTexture: texture,
    heightData: data,
    min: new THREE.Vector2(-worldWidth / 2, -worldHeight / 2),
    max: new THREE.Vector2(worldWidth / 2, worldHeight / 2),
  };
}

function applyHeightToPlane(
  geom: THREE.PlaneGeometry,
  heightData: Float32Array,
  width: number,
  height: number,
  heightScale: number,
) {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = x + y * width;
      const attributeIndex = index * 3;
      const elevation = heightData[index] * heightScale;
      pos.array[attributeIndex + 2] = elevation;
    }
  }
  pos.needsUpdate = true;
}

function makeSeededRandom(seed: string) {
  let hash = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return mulberry32(hash >>> 0);
}

function mulberry32(seed: number) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
