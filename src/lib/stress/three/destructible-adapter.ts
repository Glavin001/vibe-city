import * as THREE from 'three';
import type { DestructibleCore } from '@/lib/stress/core/types';

type SolverDebugLine = {
  p0: { x: number; y: number; z: number };
  p1: { x: number; y: number; z: number };
  color0: number;
  color1: number;
};

type PoseData = {
  tx: number;
  ty: number;
  tz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
};

type SpatialCacheEntry = {
  cellSize: number;
  nodePositions: Float32Array;
  nodeActor: Int32Array;
  nodeIndices: Int32Array;
  chunkLookup: Map<string, number[]>;
  candidateNodes: number[];
};

const spatialCache = new WeakMap<DestructibleCore, SpatialCacheEntry>();

function quantizeIndex(value: number, cellSize: number) {
  return Math.round(value / cellSize);
}

function makeSpatialKey(ix: number, iy: number, iz: number) {
  return `${ix}|${iy}|${iz}`;
}

function spatialKeyFromVec(vec: { x: number; y: number; z: number }, cellSize: number) {
  return makeSpatialKey(quantizeIndex(vec.x, cellSize), quantizeIndex(vec.y, cellSize), quantizeIndex(vec.z, cellSize));
}

function ensureSpatialCache(core: DestructibleCore): SpatialCacheEntry {
  const chunkCount = core.chunks.length;
  let maxNodeIndex = -1;
  let minExtent = Infinity;
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = core.chunks[i];
    if (!chunk) continue;
    if (chunk.nodeIndex > maxNodeIndex) maxNodeIndex = chunk.nodeIndex;
    const longestExtent = Math.max(chunk.size.x, chunk.size.y, chunk.size.z);
    if (longestExtent > 0 && longestExtent < minExtent) minExtent = longestExtent;
  }
  const arrayLength = Math.max(maxNodeIndex + 1, chunkCount);
  let entry = spatialCache.get(core);
  if (!entry) {
    entry = {
      cellSize: 0.5,
      nodePositions: new Float32Array(arrayLength * 3),
      nodeActor: new Int32Array(arrayLength),
      nodeIndices: new Int32Array(chunkCount),
      chunkLookup: new Map<string, number[]>(),
      candidateNodes: [],
    };
    spatialCache.set(core, entry);
  }

  if (entry.nodePositions.length !== arrayLength * 3) {
    entry.nodePositions = new Float32Array(arrayLength * 3);
  }
  if (entry.nodeActor.length !== arrayLength) {
    entry.nodeActor = new Int32Array(arrayLength);
  }
  if (entry.nodeIndices.length !== chunkCount) {
    entry.nodeIndices = new Int32Array(chunkCount);
  }

  entry.nodeActor.fill(-1);
  entry.chunkLookup.clear();
  const cellSize = Math.max(0.1, Math.min(1.0, Number.isFinite(minExtent) ? minExtent * 0.5 : 0.5));
  entry.cellSize = cellSize;
  for (let i = 0; i < chunkCount; i += 1) {
    const chunk = core.chunks[i];
    if (!chunk) continue;
    const nodeIndex = chunk.nodeIndex;
    entry.nodeIndices[i] = nodeIndex;
    const base = nodeIndex * 3;
    entry.nodePositions[base] = chunk.baseLocalOffset.x;
    entry.nodePositions[base + 1] = chunk.baseLocalOffset.y;
    entry.nodePositions[base + 2] = chunk.baseLocalOffset.z;
    const key = spatialKeyFromVec(chunk.baseLocalOffset, cellSize);
    const bucket = entry.chunkLookup.get(key);
    if (bucket) bucket.push(nodeIndex); else entry.chunkLookup.set(key, [nodeIndex]);
  }

  return entry;
}

function applyPose(point: { x: number; y: number; z: number }, pose: PoseData) {
  const px = point.x;
  const py = point.y;
  const pz = point.z;
  const { qx, qy, qz, qw, tx, ty, tz } = pose;
  if (qx === 0 && qy === 0 && qz === 0) {
    return { x: px + tx, y: py + ty, z: pz + tz };
  }
  const uvx = qy * pz - qz * py;
  const uvy = qz * px - qx * pz;
  const uvz = qx * py - qy * px;
  const uuvx = qy * uvz - qz * uvy;
  const uuvy = qz * uvx - qx * uvz;
  const uuvz = qx * uvy - qy * uvx;
  const rx = px + 2 * (qw * uvx + uuvx);
  const ry = py + 2 * (qw * uvy + uuvy);
  const rz = pz + 2 * (qw * uvz + uuvz);
  return { x: rx + tx, y: ry + ty, z: rz + tz };
}

export function buildChunkMeshes(core: DestructibleCore, materials?: { deck?: THREE.Material; support?: THREE.Material }) {
  const deckMat = (materials?.deck ?? new THREE.MeshStandardMaterial({ color: 0x4b6fe8, roughness: 0.4, metalness: 0.45 }));
  const supportMat = (materials?.support ?? new THREE.MeshStandardMaterial({ color: 0x2f3e56, roughness: 0.6, metalness: 0.25 }));
  const meshes: THREE.Mesh[] = [];
  for (const chunk of core.chunks) {
    const mat = chunk.isSupport ? supportMat.clone() : deckMat.clone();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z), mat);
    mesh.userData.nodeIndex = chunk.nodeIndex;
    mesh.castShadow = true; mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return { objects: meshes };
}

export function buildChunkMeshesFromGeometries(core: DestructibleCore, geometries: THREE.BufferGeometry[], materials?: { deck?: THREE.Material; support?: THREE.Material }) {
  const deckMat = (materials?.deck ?? new THREE.MeshStandardMaterial({ color: 0xbababa, roughness: 0.62, metalness: 0.05 }));
  const supportMat = (materials?.support ?? new THREE.MeshStandardMaterial({ color: 0x7a889a, roughness: 0.7, metalness: 0.15 }));
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < core.chunks.length; i++) {
    const chunk = core.chunks[i];
    // Render supports as simple boxes; fragments use real geometries. Use a SINGLE material to avoid
    // raycast crashes when geometry has no groups (Three expects a material per group otherwise).
    const geom = chunk.isSupport ? new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z) : (geometries[i] ?? new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z));
    try { (geom as THREE.BufferGeometry).clearGroups(); } catch {}
    const mat = chunk.isSupport ? supportMat.clone() : deckMat.clone();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.nodeIndex = chunk.nodeIndex;
    mesh.castShadow = true; mesh.receiveShadow = true;
    meshes.push(mesh);
  }
  return { objects: meshes };
}

export function updateChunkMeshes(core: DestructibleCore, meshes: THREE.Mesh[]) {
  const tmp = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  if (process.env.NODE_ENV !== 'production' && meshes.length !== core.chunks.length) {
    console.error('[Adapter] Chunk mesh count mismatch', { meshes: meshes.length, chunks: core.chunks.length });
    throw new Error('Chunk mesh count mismatch');
  }
  for (let i = 0; i < core.chunks.length; i++) {
    const chunk = core.chunks[i];
    const mesh = meshes[i];
    if (!mesh) continue;
    const handle = chunk.bodyHandle;
    if (handle == null) {
      if (process.env.NODE_ENV !== 'production') console.error('[Adapter] Missing bodyHandle for chunk', { chunkIndex: i });
      continue;
    }
    const body = core.world.getRigidBody(handle);
    if (!body) {
      if (process.env.NODE_ENV !== 'production') console.warn('[Adapter] Missing body for chunk', { chunkIndex: i });
      continue;
    }

    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    quat.set(r.x, r.y, r.z, r.w);
    mesh.quaternion.copy(quat);
    tmp.set(chunk.baseLocalOffset.x, chunk.baseLocalOffset.y, chunk.baseLocalOffset.z).applyQuaternion(mesh.quaternion);
    mesh.position.add(tmp);

    // Set mesh color based on type of rigid body: fixed (gray), kinematic (blue), dynamic (orange)
    // Use MeshStandardMaterial color for clarity; this affects the mesh's material but preserves shadows/etc
    if (body) {
      let color = 0xbababa; // default: gray for fixed
      if (body.isKinematic()) {
        color = 0x2a6ddb; // blue for kinematic
      } else if (body.isDynamic()) {
        color = 0xff9147; // orange for dynamic
      } else if (body.isFixed()) {
        color = 0xbababa; // gray for fixed
      }
      if (
        mesh.material &&
        mesh.material instanceof THREE.MeshStandardMaterial &&
        (mesh.material.color.getHex() !== color)
      ) {
        mesh.material.color.setHex(color);
      }
    }
  }
}

export function buildSolverDebugHelper() {
  const geometry = new THREE.BufferGeometry();
  let capacity = 0;
  let positions = new Float32Array(0);
  let colors = new Float32Array(0);
  let positionAttr = new THREE.BufferAttribute(positions, 3);
  let colorAttr = new THREE.BufferAttribute(colors, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('color', colorAttr);
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false });
  const object = new THREE.LineSegments(geometry, material);
  object.visible = false;

  function ensureCapacity(lineCount: number) {
    const required = lineCount * 6;
    if (required <= capacity) return;
    let next = capacity > 0 ? capacity : 256;
    while (next < required) next *= 2;
    capacity = next;
    positions = new Float32Array(capacity);
    colors = new Float32Array(capacity);
    positionAttr = new THREE.BufferAttribute(positions, 3);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    colorAttr = new THREE.BufferAttribute(colors, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('color', colorAttr);
  }

  function update(lines: SolverDebugLine[], visible: boolean) {
    const list = Array.isArray(lines) ? lines : [];
    ensureCapacity(list.length);
    const colorFrom = (u24: number) => ({ r: ((u24 >> 16) & 0xff) / 255, g: ((u24 >> 8) & 0xff) / 255, b: (u24 & 0xff) / 255 });

    if (list.length === 0) {
      geometry.setDrawRange(0, 0);
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      object.visible = visible !== false && false;
      return;
    }

    for (let index = 0; index < list.length; index += 1) {
      const line = list[index];
      const base = index * 6;
      positions[base] = line.p0.x; positions[base + 1] = line.p0.y; positions[base + 2] = line.p0.z;
      positions[base + 3] = line.p1.x; positions[base + 4] = line.p1.y; positions[base + 5] = line.p1.z;
      const c0 = colorFrom(line.color0);
      const c1 = colorFrom(line.color1 ?? line.color0);
      colors[base] = c0.r; colors[base + 1] = c0.g; colors[base + 2] = c0.b;
      colors[base + 3] = c1.r; colors[base + 4] = c1.g; colors[base + 5] = c1.b;
    }

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    geometry.setDrawRange(0, list.length * 2);
    geometry.computeBoundingSphere();
    object.visible = visible !== false && list.length > 0;
  }

  return { object, update };
}

export function updateProjectileMeshes(core: DestructibleCore, root: THREE.Group) {
  for (const p of core.projectiles as Array<{ bodyHandle:number; radius:number; type:'ball'|'box'; mesh?: THREE.Mesh }>) {
    const body = core.world.getRigidBody(p.bodyHandle);
    if (!body) {
      if (process.env.NODE_ENV !== 'production') console.warn('[Adapter] Projectile body missing', p);
      continue;
    }
    if (!p.mesh) {
      const geom = p.type === 'ball' ? new THREE.SphereGeometry(p.radius, 24, 24) : new THREE.BoxGeometry(p.radius * 2, p.radius * 2, p.radius * 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0xff9147, emissive: 0x331100, roughness: 0.4, metalness: 0.2 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      p.mesh = mesh;
      root.add(mesh);
      if (process.env.NODE_ENV !== 'production') console.debug('[Adapter] Created projectile mesh', p);
    }
    (p.mesh as THREE.Mesh).visible = true;
    const t = body.translation();
    const q = body.rotation();
    (p.mesh as THREE.Mesh).position.set(t.x, t.y, t.z);
    (p.mesh as THREE.Mesh).quaternion.set(q.x, q.y, q.z, q.w);
  }
}


export function computeWorldDebugLines(
  core: DestructibleCore,
  lines: SolverDebugLine[],
  target: SolverDebugLine[] = []
) {
  const out = target;
  out.length = 0;
  if (!Array.isArray(lines) || lines.length === 0) {
    return out;
  }

  const cache = ensureSpatialCache(core);
  const { nodeActor, nodePositions, nodeIndices, chunkLookup, candidateNodes, cellSize } = cache;

  try {
    const actors = (core.solver as unknown as { actors: () => Array<{ actorIndex: number; nodes: number[] }> }).actors?.() ?? [];
    for (const actor of actors) {
      const nodes = Array.isArray(actor?.nodes) ? actor.nodes : [];
      for (const nodeIndex of nodes) {
        if (nodeIndex >= 0 && nodeIndex < nodeActor.length) {
          nodeActor[nodeIndex] = actor.actorIndex;
        }
      }
    }
  } catch {}

  const actorPose = new Map<number, PoseData>();
  for (const [actorIndex, { bodyHandle }] of Array.from(core.actorMap.entries())) {
    const body = core.world.getRigidBody(bodyHandle);
    if (!body) continue;
    const tr = body.translation();
    const rot = body.rotation();
    actorPose.set(actorIndex, {
      tx: tr.x,
      ty: tr.y,
      tz: tr.z,
      qx: rot.x,
      qy: rot.y,
      qz: rot.z,
      qw: rot.w,
    });
  }

  const rootBody = core.world.getRigidBody(core.rootBodyHandle);
  const rootPose: PoseData = rootBody
    ? {
        tx: rootBody.translation().x,
        ty: rootBody.translation().y,
        tz: rootBody.translation().z,
        qx: rootBody.rotation().x,
        qy: rootBody.rotation().y,
        qz: rootBody.rotation().z,
        qw: rootBody.rotation().w,
      }
    : { tx: 0, ty: 0, tz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  const nodePositionsArray = nodePositions;

  function owningActorIndexForLine(p0: { x: number; y: number; z: number }, p1: { x: number; y: number; z: number }) {
    const mx = (p0.x + p1.x) * 0.5;
    const my = (p0.y + p1.y) * 0.5;
    const mz = (p0.z + p1.z) * 0.5;
    candidateNodes.length = 0;
    const ix = quantizeIndex(mx, cellSize);
    const iy = quantizeIndex(my, cellSize);
    const iz = quantizeIndex(mz, cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const key = makeSpatialKey(ix + dx, iy + dy, iz + dz);
          const bucket = chunkLookup.get(key);
          if (bucket) {
            for (let i = 0; i < bucket.length; i += 1) candidateNodes.push(bucket[i]);
          }
        }
      }
    }
    if (candidateNodes.length === 0) {
      for (let i = 0; i < nodeIndices.length; i += 1) {
        candidateNodes.push(nodeIndices[i]);
      }
    }

    let bestNode = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < candidateNodes.length; i += 1) {
      const nodeIndex = candidateNodes[i];
      if (nodeIndex < 0 || nodeIndex * 3 + 2 >= nodePositionsArray.length) continue;
      const base = nodeIndex * 3;
      const dx = nodePositionsArray[base] - mx;
      const dy = nodePositionsArray[base + 1] - my;
      const dz = nodePositionsArray[base + 2] - mz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestNode = nodeIndex;
      }
    }
    if (bestNode < 0) return undefined;
    const actorIndex = nodeActor[bestNode];
    return actorIndex >= 0 ? actorIndex : undefined;
  }

  for (const line of lines) {
    const actorIndex = owningActorIndexForLine(line.p0, line.p1);
    const pose = (actorIndex != null && actorPose.get(actorIndex)) || rootPose;
    const p0 = applyPose(line.p0, pose);
    const p1 = applyPose(line.p1, pose);
    out.push({ p0, p1, color0: line.color0, color1: line.color1 });
  }
  return out;
}


