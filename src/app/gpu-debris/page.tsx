"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";
import { createNoise2D } from "simplex-noise";

import velocityFragment from "./shaders/velocity.frag.glsl";
import positionFragment from "./shaders/position.frag.glsl";
import pointsVert from "./shaders/points.vert.glsl";
import pointsFrag from "./shaders/points.frag.glsl";

const SIM_SIZE = 512;
const TERRAIN_SIZE = 180;
const HEIGHTMAP_SIZE = 256;
const HEIGHT_SCALE = 8;
const BURST_DEFAULT = 8000;
const MAX_SPHERES = 4;
const MAX_BOXES = 6;

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

      velUniforms.uTime.value = now;
      velUniforms.uDelta.value = dt;
      posUniforms.uDelta.value = dt;

      gpu.compute();

      posUniforms.uSpawnCountA.value = 0;
      posUniforms.uSpawnCountB.value = 0;
      velUniforms.uSpawnCountA.value = 0;
      velUniforms.uSpawnCountB.value = 0;

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
