import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { FractureOptions, fracture } from '@dgreenheck/three-pinata';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ScenarioDesc, Vec3, ColliderDescBuilder } from '@/lib/stress/core/types';

type FragmentInfo = {
  worldPosition: THREE.Vector3;
  halfExtents: THREE.Vector3;
  geometry: THREE.BufferGeometry;
  isSupport: boolean;
};

function projectExtentsOnAxisWorld(geometry: THREE.BufferGeometry, worldPos: THREE.Vector3, axis: THREE.Vector3): { min: number; max: number } {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const ax = axis;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i += 1) {
    const x = (pos.getX(i) as number) + worldPos.x;
    const y = (pos.getY(i) as number) + worldPos.y;
    const z = (pos.getZ(i) as number) + worldPos.z;
    const p = x * ax.x + y * ax.y + z * ax.z;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

function overlap1D(a: { min: number; max: number }, b: { min: number; max: number }) {
  return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
}

function computeBondsFromFragments(fragments: FragmentInfo[]): Array<{ a: number; b: number; centroid: Vec3; normal: Vec3; area: number }> {
  const bonds: Array<{ a: number; b: number; centroid: Vec3; normal: Vec3; area: number }> = [];
  if (fragments.length === 0) return bonds;

  const globalTol = 0.12 * Math.min(...fragments.map((f) => Math.min(f.halfExtents.x, f.halfExtents.z)));

  for (let i = 0; i < fragments.length; i += 1) {
    for (let j = i + 1; j < fragments.length; j += 1) {
      const A = fragments[i];
      const B = fragments[j];

      // Skip bonds between two supports; allow support <-> fragment
      if (A.isSupport && B.isSupport) continue;

      const n = B.worldPosition.clone().sub(A.worldPosition).normalize();
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue;

      // Require small separation along the normal direction (nearly touching)
      const aN = projectExtentsOnAxisWorld(A.geometry, A.worldPosition, n);
      const bN = projectExtentsOnAxisWorld(B.geometry, B.worldPosition, n);
      const separation = bN.min - aN.max; // positive if B is in +n direction away from A

      // Use two tangents for overlap area test
      const up = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const t1 = new THREE.Vector3().crossVectors(n, up).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();

      const a1 = projectExtentsOnAxisWorld(A.geometry, A.worldPosition, t1);
      const b1 = projectExtentsOnAxisWorld(B.geometry, B.worldPosition, t1);
      const a2 = projectExtentsOnAxisWorld(A.geometry, A.worldPosition, t2);
      const b2 = projectExtentsOnAxisWorld(B.geometry, B.worldPosition, t2);

      const o1 = overlap1D(a1, b1);
      const o2 = overlap1D(a2, b2);
      const size1 = Math.min(a1.max - a1.min, b1.max - b1.min);
      const size2 = Math.min(a2.max - a2.min, b2.max - b2.min);

      // Pair-relative gap threshold to avoid long-range bonds across thin gaps
      const pairMin = Math.max(1e-6, Math.min(size1, size2));
      const epsGap = Math.max(0.006, Math.min(globalTol, pairMin * 0.15));
      if (separation > epsGap) continue;

      if (o1 < size1 * 0.22 || o2 < size2 * 0.22) continue;

      const contactArea = o1 * o2;
      if (!(contactArea > 0)) continue;

      // Contact centroid: the center of the overlap rectangle in the (n, t1, t2) basis
      const cN = 0.5 * (Math.max(aN.min, bN.min) + Math.min(aN.max, bN.max));
      const c1 = 0.5 * (Math.max(a1.min, b1.min) + Math.min(a1.max, b1.max));
      const c2 = 0.5 * (Math.max(a2.min, b2.min) + Math.min(a2.max, b2.max));
      const mid = new THREE.Vector3()
        .addScaledVector(n, cN)
        .addScaledVector(t1, c1)
        .addScaledVector(t2, c2);

      bonds.push({
        a: i,
        b: j,
        centroid: { x: mid.x, y: mid.y, z: mid.z },
        normal: { x: n.x, y: n.y, z: n.z },
        area: contactArea,
      });
    }
  }
  return bonds;
}

function normalizeFractureAreasByAxis(
  list: Array<{ a?: number; b?: number; centroid: Vec3; normal: Vec3; area: number }>,
  dims: { span: number; height: number; thickness: number }
) {
  const target = { x: dims.height * dims.thickness, y: dims.span * dims.thickness, z: dims.span * dims.height };
  const sum = { x: 0, y: 0, z: 0 } as { x: number; y: number; z: number };
  const pick = (n: Vec3): 'x' | 'y' | 'z' => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    return ax >= ay && ax >= az ? 'x' : (ay >= az ? 'y' : 'z');
  };
  for (const b of list) sum[pick(b.normal)] += b.area;
  const scale = {
    x: sum.x > 0 ? target.x / sum.x : 1,
    y: sum.y > 0 ? target.y / sum.y : 1,
    z: sum.z > 0 ? target.z / sum.z : 1,
  } as const;
  return list.map((b) => {
    const axis = pick(b.normal);
    const area = Math.max(b.area * scale[axis], 1e-8);
    return { ...b, area };
  });
}

function uniformizeBondAreasByAxis(
  list: Array<{ a?: number; b?: number; centroid: Vec3; normal: Vec3; area: number }>,
  dims: { span: number; height: number; thickness: number }
) {
  const target = { x: dims.height * dims.thickness, y: dims.span * dims.thickness, z: dims.span * dims.height };
  const pick = (n: Vec3): 'x' | 'y' | 'z' => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    return ax >= ay && ax >= az ? 'x' : (ay >= az ? 'y' : 'z');
  };
  const counts = { x: 0, y: 0, z: 0 } as { x: number; y: number; z: number };
  for (const b of list) counts[pick(b.normal)] += 1;
  const areaPerAxis = {
    x: counts.x > 0 ? Math.max(1e-8, target.x / counts.x) : 0,
    y: counts.y > 0 ? Math.max(1e-8, target.y / counts.y) : 0,
    z: counts.z > 0 ? Math.max(1e-8, target.z / counts.z) : 0,
  } as const;
  return list.map((b) => ({ ...b, area: areaPerAxis[pick(b.normal)] || Math.max(1e-8, b.area) }));
}

async function loadMergedGeometryFromGlb(url: string): Promise<THREE.BufferGeometry | null> {
  const loader = new GLTFLoader();
  try {
    const draco = new DRACOLoader();
    // Use Google's hosted decoders by default; swap to '/draco/' if you host locally
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(draco);
  } catch {}
  const gltf = await loader.loadAsync(url);
  const geoms: THREE.BufferGeometry[] = [];
  try {
    gltf.scene.updateMatrixWorld(true);
  } catch {}
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const geometry = mesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    const cloned = geometry.clone();
    const m = mesh.matrixWorld?.clone?.() ?? new THREE.Matrix4();
    try { cloned.applyMatrix4(m); } catch {}
    geoms.push(cloned);
  });
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms, false);
  return merged ?? null;
}

async function tryLoadAsync<T extends { loadAsync?: (u:string)=>Promise<unknown>; load: (u:string, onLoad:(r:unknown)=>void, onProgress?:(e:unknown)=>void, onError?:(e:unknown)=>void)=>void }>(loader: T, url: string): Promise<unknown> {
  if (typeof loader.loadAsync === 'function') {
    try { return await (loader.loadAsync as (u:string)=>Promise<unknown>)(url); } catch (e) { throw e; }
  }
  return new Promise((resolve, reject) => {
    try { loader.load(url, resolve, undefined, reject); } catch (e) { reject(e); }
  });
}

async function loadWorldGeometriesFromUrl(url: string, scale = 1): Promise<THREE.BufferGeometry[]> {
  const lower = (url.split('?')[0] || '').toLowerCase();
  const geoms: THREE.BufferGeometry[] = [];
  const applyScale = (g: THREE.BufferGeometry) => { if (scale !== 1) try { g.scale(scale, scale, scale); } catch {} };
  if (lower.endsWith('.wrl')) {
    const loader = new VRMLLoader();
    try {
      const root = (await tryLoadAsync(loader as unknown as { loadAsync?: (u:string)=>Promise<unknown>; load: (u:string, onLoad:(r:unknown)=>void, onProgress?:(e:unknown)=>void, onError?:(e:unknown)=>void)=>void }, url)) as unknown as THREE.Object3D;
      try { (root as THREE.Object3D).updateMatrixWorld(true); } catch {}
      (root as THREE.Object3D).traverse?.((obj) => {
        const mesh = obj as THREE.Mesh;
        const geometry = mesh?.geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;
        const cloned = geometry.clone();
        const m = mesh.matrixWorld?.clone?.() ?? new THREE.Matrix4();
        try { cloned.applyMatrix4(m); } catch {}
        applyScale(cloned);
        geoms.push(cloned);
      });
      return geoms;
    } catch (e) {
      // Fallback: fetch as text and sanitize multiple headers, then parse
      try {
        const res = await fetch(url);
        const textRaw = await res.text();
        let text = textRaw.replace(/\r\n/g, '\n');
        // Remove all #VRML headers and add a single one at the start
        text = text.replace(/(^|\n)\s*#VRML[^\n]*/gi, '');
        text = '#VRML V2.0 utf8\n' + text;
        const parsedRoot = (loader as unknown as { parse: (s: string) => THREE.Object3D }).parse(text);
        try { parsedRoot.updateMatrixWorld(true); } catch {}
        parsedRoot.traverse?.((obj) => {
          const mesh = obj as THREE.Mesh;
          const geometry = mesh?.geometry as THREE.BufferGeometry | undefined;
          if (!geometry) return;
          const cloned = geometry.clone();
          const m = mesh.matrixWorld?.clone?.() ?? new THREE.Matrix4();
          try { cloned.applyMatrix4(m); } catch {}
          applyScale(cloned);
          geoms.push(cloned);
        });
        return geoms;
      } catch (e2) {
        console.error('[WRL] parse failed', e, e2);
        throw e2;
      }
    }
  }
  if (lower.endsWith('.obj')) {
    const loader = new OBJLoader();
    const root = (await tryLoadAsync(loader as unknown as { loadAsync?: (u:string)=>Promise<unknown>; load: (u:string, onLoad:(r:unknown)=>void, onProgress?:(e:unknown)=>void, onError?:(e:unknown)=>void)=>void }, url)) as unknown as THREE.Object3D;
    try { (root as THREE.Object3D).updateMatrixWorld(true); } catch {}
    (root as THREE.Object3D).traverse?.((obj) => {
      const mesh = obj as THREE.Mesh;
      const geometry = mesh?.geometry as THREE.BufferGeometry | undefined;
      if (!geometry) return;
      const cloned = geometry.clone();
      const m = mesh.matrixWorld?.clone?.() ?? new THREE.Matrix4();
      try { cloned.applyMatrix4(m); } catch {}
      applyScale(cloned);
      geoms.push(cloned);
    });
    return geoms;
  }
  // Default: GLB/GLTF (collect all meshes in world space)
  const loader = new GLTFLoader();
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(draco);
  } catch {}
  const gltf = await loader.loadAsync(url);
  try { gltf.scene.updateMatrixWorld(true); } catch {}
  gltf.scene.traverse?.((obj) => {
    const mesh = obj as THREE.Mesh;
    const geometry = mesh?.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    const cloned = geometry.clone();
    const m = mesh.matrixWorld?.clone?.() ?? new THREE.Matrix4();
    try { cloned.applyMatrix4(m); } catch {}
    applyScale(cloned);
    geoms.push(cloned);
  });
  return geoms;
}

export async function buildFracturedGlbScenario({
  url = '/models/lion.glb',
  // url = '/models/building.glb',
  // url = '/models/atlanta_corperate_office_building.glb',
  // url = '/models/big_soviet_panel_house_lowpoly.glb',
  // url = '/models/building_brutalist_quadrhomb.glb',
  // url = '/models/building_brutalist_rhomb.glb',
  // url = '/models/house.glb',
  // url = '/models/construction_site_building_site_architecture.glb',
  // url = '/models/winchelsea_beach_concrete_block.glb',
  // url = '/models/concrete_golden_tiles__tile_texture.glb',
  // url = '/models/a_soviet_small_construction_wall.glb',
  // url = '/models/korhal_overpass_-_starcraft_2.glb',
  // url = '/models/footbridge.glb',
  // url = '/models/american_road_overpass_underpass_bridge.glb',
  fragmentCount = 120,
  // fragmentCount = 300,
  // fragmentCount = 500,
  objectMass = 10_000,
  physicsUrl,
  physicsScale = 1,
  maxMicroPerPiece = 6,
}: { url?: string; fragmentCount?: number; objectMass?: number; physicsUrl?: string; physicsScale?: number; maxMicroPerPiece?: number } = {}): Promise<ScenarioDesc> {
  // 1) Load visual reference geometries (GLB/OBJ/WRL) and merge for sizing/optional fracture
  const visualGeoms = await loadWorldGeometriesFromUrl(url);
  let merged: THREE.BufferGeometry | null = null;
  if (visualGeoms.length > 0) {
    if (visualGeoms.length === 1) {
      merged = visualGeoms[0];
    } else {
      try { merged = mergeGeometries(visualGeoms, false) ?? null; } catch { merged = visualGeoms[0]; }
    }
  }
  if (!merged) {
    // Fallback: tiny cube at origin to avoid crashing callers
    const g = new THREE.BoxGeometry(1, 1, 1);
    const center = new THREE.Vector3(0, 0.5, 0);
    return {
      nodes: [{ centroid: { x: center.x, y: center.y, z: center.z }, mass: objectMass, volume: 1 }],
      bonds: [],
      parameters: { fragmentGeometries: [g], fragmentSizes: [{ x: 1, y: 1, z: 1 }], source: 'fallback' },
      colliderDescForNode: [() => RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)],
    } satisfies ScenarioDesc;
  }

  // Ensure geometry uses plain BufferAttributes (not interleaved) and has normals
  function ensurePlainAttributes(g: THREE.BufferGeometry) {
    const names: Array<keyof typeof g.attributes> = ['position', 'normal', 'uv'] as unknown as Array<keyof typeof g.attributes>;
    for (const n of names) {
      const attr = g.getAttribute(n as unknown as string) as unknown as { count?: number; itemSize?: number; getX?: (i:number)=>number; getY?: (i:number)=>number; getZ?: (i:number)=>number; array?: unknown } | undefined;
      if (!attr) continue;
      const hasArray = (attr as { array?: unknown }).array != null;
      if (!hasArray) {
        const count = (attr.count as number) ?? 0;
        const itemSize = (attr.itemSize as number) ?? 3;
        const data = new Float32Array(Math.max(0, count * itemSize));
        for (let i = 0; i < count; i += 1) {
          if (itemSize >= 1) data[i * itemSize + 0] = (attr.getX?.(i) as number) ?? 0;
          if (itemSize >= 2) data[i * itemSize + 1] = (attr.getY?.(i) as number) ?? 0;
          if (itemSize >= 3) data[i * itemSize + 2] = (attr.getZ?.(i) as number) ?? 0;
        }
        g.setAttribute(n as unknown as string, new THREE.BufferAttribute(data, itemSize));
      }
    }
    // Recompute normals if absent
    if (!g.getAttribute('normal')) {
      try { g.computeVertexNormals(); } catch {}
    }
  }
  // Convert to non-indexed to avoid interleaved quirks in downstream libs
  let prepared = merged.index ? merged.toNonIndexed() : merged;
  ensurePlainAttributes(prepared);

  // Measure model extents
  merged.computeBoundingBox();
  const bbox = merged.boundingBox as THREE.Box3;
  const size = new THREE.Vector3();
  bbox.getSize(size);

  // 2) Choose fragment source: physicsUrl (WRL/OBJ/GLB) or fracture visual merged geometry
  function ensureGeometryCompat(geom: THREE.BufferGeometry): THREE.BufferGeometry {
    // Work on a local reference; convert to non-indexed to simplify attribute access
    let g = geom;

    // Ensure Float32-backed attributes
    const names: Array<'position'|'normal'|'uv'> = ['position', 'normal', 'uv'];
    for (const n of names) {
      const attr = g.getAttribute(n) as THREE.BufferAttribute | null;
      if (!attr) continue;
      if (!(attr.array instanceof Float32Array)) {
        const count = attr.count ?? 0;
        const itemSize = attr.itemSize ?? (n === 'uv' ? 2 : 3);
        const data = new Float32Array(Math.max(0, count * itemSize));
        for (let i = 0; i < count; i += 1) {
          if (itemSize >= 1) data[i * itemSize + 0] = attr.getX(i) ?? 0;
          if (itemSize >= 2) data[i * itemSize + 1] = attr.getY(i) ?? 0;
          if (itemSize >= 3) data[i * itemSize + 2] = attr.getZ(i) ?? 0;
        }
        g.setAttribute(n, new THREE.BufferAttribute(data, itemSize));
      }
    }

    // If normals missing, try compute; if still missing, synthesize zero normals
    try { if (!g.getAttribute('normal')) g.computeVertexNormals(); } catch {}
    if (!g.getAttribute('normal')) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute | null;
      const count = pos?.count ?? 0;
      if (count > 0) g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    }

    // If uvs missing, synthesize placeholder zeros so three-pinata doesn't crash
    if (!g.getAttribute('uv')) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute | null;
      const count = pos?.count ?? 0;
      if (count > 0) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    // Ensure index exists (three-pinata expects geometry.index.array)
    const posAttr = g.getAttribute('position') as THREE.BufferAttribute | null;
    const vtxCount = posAttr?.count ?? 0;
    if (!g.index) {
      // Clamp index length to multiple of 3 (triangles)
      const triIndexCount = Math.max(0, Math.floor(vtxCount / 3) * 3);
      const IndexArray = triIndexCount > 65535 ? Uint32Array : Uint16Array;
      const idx = new IndexArray(triIndexCount);
      for (let i = 0; i < triIndexCount; i += 1) idx[i] = i as unknown as number;
      try { g.setIndex(new THREE.BufferAttribute(idx, 1)); } catch {}
    }
    return g;
  }
  function fractureGeometry(geom: THREE.BufferGeometry, count: number, mode: "Non-Convex" | "Convex"): THREE.BufferGeometry[] {
    // Guard: require position attribute
    const clone = geom.clone();
    const input = ensureGeometryCompat(clone);
    const pos = input.getAttribute('position') as THREE.BufferAttribute | null;
    if (!pos || !(pos.array instanceof Float32Array) || pos.count <= 0) return [ensureGeometryCompat(geom.clone())];
    const options = new FractureOptions({ fragmentCount: Math.max(1, Math.floor(count)), fractureMode: mode });
    try {
      // Preflight: skip fracture when geometry is too simple to split
      if (count <= 1) return [input];
      if (!isFracturable(input, 4)) return [input];
      const out = fracture(input, options);
      if (count <= 1 || (Array.isArray(out) && out.length >= 2)) return out;
    } catch (e) {
      console.error('[Fracture] failed; returning original piece', e);
    }
    // Adaptive fallback: iteratively split the largest piece until we reach desired count or no progress
    const target = Math.max(1, Math.floor(count));
    let list: THREE.BufferGeometry[] = [input.clone()];
    let guard = 0;
    while (list.length < target && guard++ < 24) {
      // pick largest by bbox volume
      let bestIdx = 0;
      let bestVol = -Infinity;
      for (let i = 0; i < list.length; i += 1) {
        const v = approxVolume(list[i]);
        if (v > bestVol) { bestVol = v; bestIdx = i; }
      }
      const toSplit = list.splice(bestIdx, 1)[0];
      let subs: THREE.BufferGeometry[] = [];
      try {
        const two = new FractureOptions({ fragmentCount: 2, fractureMode: mode });
        subs = fracture(ensureGeometryCompat(toSplit.clone()), two);
      } catch {}
      if (!subs || subs.length < 2) { list.push(toSplit); break; }
      for (const s of subs) list.push(ensureGeometryCompat(s));
    }
    return list;
  }
  function approxVolume(g: THREE.BufferGeometry): number {
    try { g.computeBoundingBox(); } catch {}
    const bb = g.boundingBox as THREE.Box3 | null;
    if (!bb) return 0;
    const s = new THREE.Vector3();
    bb.getSize(s);
    return Math.max(0, s.x) * Math.max(0, s.y) * Math.max(0, s.z);
  }
  function isFracturable(g: THREE.BufferGeometry, minTriangles = 4): boolean {
    try {
      const pos = g.getAttribute('position') as THREE.BufferAttribute | null;
      if (!pos || !(pos.array instanceof Float32Array)) return false;
      const tri = Math.floor((pos.count ?? 0) / 3);
      if (tri < minTriangles) return false;
      g.computeBoundingBox();
      const bb = g.boundingBox as THREE.Box3 | null;
      if (!bb) return false;
      const sx = Math.abs((bb.max.x ?? 0) - (bb.min.x ?? 0));
      const sy = Math.abs((bb.max.y ?? 0) - (bb.min.y ?? 0));
      const sz = Math.abs((bb.max.z ?? 0) - (bb.min.z ?? 0));
      const eps = 1e-5;
      if (sx < eps || sy < eps || sz < eps) return false;
      return true;
    } catch { return false; }
  }
  function topUpFragments(base: THREE.BufferGeometry[], target: number, capPerPiece = 4, mode: "Non-Convex" | "Convex" = "Non-Convex"): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = [];
    const n = base.length;
    if (n >= target) return base.slice(0, target);
    if (n === 0) return [];
    const vols = base.map((g) => approxVolume(g));
    const sumV = vols.reduce((a, b) => a + b, 0) || 1;
    const missing = Math.max(0, Math.floor(target - n));
    const quotas = new Array(n).fill(1);
    const fractional: Array<{ i:number; frac:number }> = [];
    // Initial integer allocation
    for (let i = 0; i < n; i += 1) {
      const idealExtra = (missing * (vols[i] / sumV));
      const extraInt = Math.min(capPerPiece - 1, Math.floor(idealExtra));
      quotas[i] += Math.max(0, extraInt);
      fractional.push({ i, frac: idealExtra - extraInt });
    }
    // Fix sum to match target by distributing remaining to highest fractions
    let current = quotas.reduce((a, b) => a + b, 0);
    const need = Math.max(0, target - current);
    fractional.sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < need; k += 1) {
      const idx = fractional[k % fractional.length]?.i ?? 0;
      if (quotas[idx] < capPerPiece) quotas[idx] += 1;
      else {
        // find next under cap
        for (let j = 0; j < n; j += 1) { if (quotas[j] < capPerPiece) { quotas[j] += 1; break; } }
      }
    }
    // Build output by fracturing pieces that need more than 1
    for (let i = 0; i < n; i += 1) {
      const q = Math.max(1, Math.floor(quotas[i]));
      if (q === 1) out.push(base[i]);
      else {
        let subs: THREE.BufferGeometry[] = [];
        try { subs = fractureGeometry(base[i], q, mode); }
        catch (e) { console.error('[TopUp] fracture failed for piece', i, e); subs = [ensureGeometryCompat(base[i].clone())]; }
        for (const s of subs) out.push(s);
      }
    }
    return out;
  }

  let pieces: THREE.BufferGeometry[] = [];
  if (physicsUrl) {
    const physicsPieces = (await loadWorldGeometriesFromUrl(physicsUrl, physicsScale)).map((g) => ensureGeometryCompat(g));
    if (fragmentCount === 0 || physicsPieces.length >= fragmentCount) pieces = physicsPieces;
    else pieces = topUpFragments(physicsPieces, fragmentCount, Math.max(1, Math.floor(maxMicroPerPiece)), "Convex");
  } else {
    pieces = fractureGeometry(merged.clone(), fragmentCount, "Non-Convex");
  }
  console.log('Fragment pieces', pieces.length);

  // Placement above foundation
  const foundationHeight = Math.min(0.08, size.y * 0.06);
  const groundClearance = Math.max(0.001, foundationHeight * 0.05);
  const foundationTop = groundClearance + foundationHeight;
  // Place fractured object so its lowest original vertex rests exactly on the foundation top
  const originalMinY = bbox.min.y;
  const contactEpsilon = 0.0005; // tiny lift to avoid z-fighting
  const modelCenter = new THREE.Vector3(0, foundationTop - originalMinY + contactEpsilon, 0);

  // 3) Build fragments list (recenter each geom to its own COM, compute world placement)
  const fragments: FragmentInfo[] = pieces.map((g) => {
    // Ensure fractured piece has plain attributes for later convexHull
    (function ensureAttrs(geom: THREE.BufferGeometry) {
      const pos = geom.getAttribute('position') as THREE.BufferAttribute | null;
      if (!pos || !(pos.array instanceof Float32Array)) {
        const count = pos?.count ?? 0;
        const itemSize = pos?.itemSize ?? 3;
        const data = new Float32Array(Math.max(0, count * itemSize));
        for (let i = 0; i < count; i += 1) {
          if (itemSize >= 1) data[i * itemSize + 0] = pos?.getX(i) ?? 0;
          if (itemSize >= 2) data[i * itemSize + 1] = pos?.getY(i) ?? 0;
          if (itemSize >= 3) data[i * itemSize + 2] = pos?.getZ(i) ?? 0;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(data, itemSize));
      }
      try { if (!geom.getAttribute('normal')) geom.computeVertexNormals(); } catch {}
    })(g);
    g.computeBoundingBox();
    const gb = g.boundingBox as THREE.Box3;
    const localCenter = new THREE.Vector3();
    gb.getCenter(localCenter);
    g.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    const gsize = new THREE.Vector3();
    gb.getSize(gsize);
    const worldPosition = new THREE.Vector3(modelCenter.x + localCenter.x, modelCenter.y + localCenter.y, modelCenter.z + localCenter.z);
    return {
      worldPosition,
      halfExtents: new THREE.Vector3(Math.max(0.05, gsize.x * 0.5), Math.max(0.05, gsize.y * 0.5), Math.max(0.05, gsize.z * 0.5)),
      geometry: g,
      isSupport: false,
    };
  });

  // 4) Add a single foundation support plate sized to the GLB footprint
  const foundationGeom = new THREE.BoxGeometry(size.x, foundationHeight, size.z);
  const foundationWorldPos = new THREE.Vector3(0, groundClearance + foundationHeight * 0.5, 0);
  fragments.push({
    worldPosition: foundationWorldPos,
    halfExtents: new THREE.Vector3(size.x * 0.5, foundationHeight * 0.5, size.z * 0.5),
    geometry: foundationGeom,
    isSupport: true,
  });

  // 5) Compute bonds and normalize by axes
  const rawBonds = computeBondsFromFragments(fragments);
  // Ensure at least one (and preferably all touching) lowest fragments are bonded to the foundation
  const foundationIdx = fragments.length - 1;
  const lowestBottomY = Math.min(
    ...fragments.slice(0, foundationIdx).map((f) => f.worldPosition.y - f.halfExtents.y)
  );
  const touchThreshold = Math.max(0.001, foundationHeight * 0.1);
  const desiredContactY = groundClearance + foundationHeight; // top of foundation
  const candidates: number[] = [];
  for (let i = 0; i < foundationIdx; i += 1) {
    const f = fragments[i];
    const bottomY = f.worldPosition.y - f.halfExtents.y;
    if (Math.abs(bottomY - desiredContactY) <= touchThreshold) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    // Fallback: pick the single lowest fragment
    for (let i = 0; i < foundationIdx; i += 1) {
      const f = fragments[i];
      const bottomY = f.worldPosition.y - f.halfExtents.y;
      if (bottomY === lowestBottomY) { candidates.push(i); break; }
    }
  }
  for (const i of candidates) {
    const f = fragments[i];
    const footprintX = Math.max(1e-4, f.halfExtents.x * 2);
    const footprintZ = Math.max(1e-4, f.halfExtents.z * 2);
    const approxArea = Math.max(1e-8, footprintX * footprintZ * 0.25);
    rawBonds.push({
      a: foundationIdx,
      b: i,
      centroid: { x: f.worldPosition.x, y: desiredContactY, z: f.worldPosition.z },
      normal: { x: 0, y: 1, z: 0 },
      area: approxArea,
    });
  }
  // Replace area magnitudes with uniform per-axis values so material behaves uniformly
  const normBonds = uniformizeBondAreasByAxis(rawBonds, { span: size.x, height: size.y, thickness: size.z });

  // 6) Emit ScenarioDesc: nodes, mass scaling with objectMass, bonds, colliders, and parameters
  const nodes: ScenarioDesc['nodes'] = [];
  const fragmentSizes: Vec3[] = [];
  const fragmentGeometries: THREE.BufferGeometry[] = [];
  const colliderDescForNode: (ColliderDescBuilder | null)[] = [];
  let totalVolume = 0;

  fragments.forEach((f, i) => {
    const hx = f.halfExtents.x;
    const hy = f.halfExtents.y;
    const hz = f.halfExtents.z;
    const sizeVec = { x: hx * 2, y: hy * 2, z: hz * 2 } as Vec3;
    const volume = sizeVec.x * sizeVec.y * sizeVec.z;
    const isSupport = f.isSupport;
    const mass = isSupport ? 0 : volume;
    if (!isSupport) totalVolume += volume;
    nodes.push({ centroid: { x: f.worldPosition.x, y: f.worldPosition.y, z: f.worldPosition.z }, mass, volume });
    fragmentSizes.push(sizeVec);
    fragmentGeometries.push(f.geometry);
    if (isSupport) {
      colliderDescForNode[i] = () => RAPIER.ColliderDesc.cuboid(hx, hy, hz);
    } else {
      const pos = f.geometry.getAttribute('position') as THREE.BufferAttribute;
      const points = pos?.array instanceof Float32Array ? pos.array : new Float32Array((pos?.array ?? []) as ArrayLike<number>);
      colliderDescForNode[i] = () => RAPIER.ColliderDesc.convexHull(points);
    }
  });

  const massScale = totalVolume > 0 ? objectMass / totalVolume : 0;
  if (massScale > 0) {
    for (let i = 0; i < nodes.length; i += 1) {
      if (fragments[i]?.isSupport) { nodes[i].mass = 0; continue; }
      nodes[i].mass = nodes[i].volume > 0 ? nodes[i].volume * massScale : 0;
    }
  } else {
    for (let i = 0; i < nodes.length; i += 1) nodes[i].mass = fragments[i]?.isSupport ? 0 : 0;
  }

  const bonds: ScenarioDesc['bonds'] = normBonds.map((b) => ({
    node0: (b as { a: number }).a,
    node1: (b as { b: number }).b,
    centroid: b.centroid,
    normal: b.normal,
    area: Math.max(b.area, 1e-8),
  }));

  return {
    nodes,
    bonds,
    parameters: {
      fragmentSizes,
      fragmentGeometries,
      objectMass,
      sourceUrl: url,
      physicsUrl,
    },
    colliderDescForNode,
  } satisfies ScenarioDesc;
}


