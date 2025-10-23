import * as THREE from 'three';
import type { DestructibleCore } from '@/lib/stress/core/types';

export function buildChunkMeshes(core: DestructibleCore, materials?: { deck?: THREE.Material; support?: THREE.Material }) {
  const deckMat = (materials?.deck ?? new THREE.MeshStandardMaterial({ color: 0x4b6fe8, roughness: 0.4, metalness: 0.45 }));
  const supportMat = (materials?.support ?? new THREE.MeshStandardMaterial({ color: 0x2f3e56, roughness: 0.6, metalness: 0.25 }));
  const meshes: THREE.Mesh[] = [];
  for (const chunk of core.chunks) {
    const mat = chunk.isSupport ? supportMat.clone() : deckMat.clone();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z), mat);
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
    if (!body) continue;
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    quat.set(r.x, r.y, r.z, r.w);
    mesh.quaternion.copy(quat);
    tmp.set(chunk.baseLocalOffset.x, chunk.baseLocalOffset.y, chunk.baseLocalOffset.z).applyQuaternion(mesh.quaternion);
    mesh.position.add(tmp);
  }
}

export function buildSolverDebugHelper() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false });
  const object = new THREE.LineSegments(geometry, material);
  object.visible = false;
  function update(lines: Array<{ p0:{x:number;y:number;z:number}; p1:{x:number;y:number;z:number}; color0:number; color1:number }>, visible: boolean) {
    const list = Array.isArray(lines) ? lines : [];
    const positions = new Float32Array(list.length * 2 * 3);
    const colors = new Float32Array(list.length * 2 * 3);
    const colorFrom = (u24: number) => ({ r: ((u24 >> 16) & 0xff) / 255, g: ((u24 >> 8) & 0xff) / 255, b: (u24 & 0xff) / 255 });
    list.forEach((line, index: number) => {
      const base = index * 6;
      positions[base] = line.p0.x; positions[base + 1] = line.p0.y; positions[base + 2] = line.p0.z;
      positions[base + 3] = line.p1.x; positions[base + 4] = line.p1.y; positions[base + 5] = line.p1.z;
      const c0 = colorFrom(line.color0); const c1 = colorFrom(line.color1 ?? line.color0);
      colors[base] = c0.r; colors[base + 1] = c0.g; colors[base + 2] = c0.b;
      colors[base + 3] = c1.r; colors[base + 4] = c1.g; colors[base + 5] = c1.b;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    object.visible = visible !== false;
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
  lines: Array<{ p0: { x:number; y:number; z:number }; p1: { x:number; y:number; z:number }; color0: number; color1: number }>
) {
  // Build nodeIndex -> actorIndex map from solver
  const nodeToActor = new Map<number, number>();
  try {
    const actors = (core.solver as unknown as { actors: () => Array<{ actorIndex:number; nodes:number[] }> }).actors?.() ?? [];
    for (const a of actors) {
      const nodes = Array.isArray(a.nodes) ? a.nodes : [];
      for (const n of nodes) nodeToActor.set(n, a.actorIndex);
    }
  } catch {}

  // Prepare actorIndex -> {t, q} transform lookup
  const actorPose = new Map<number, { t: THREE.Vector3; q: THREE.Quaternion }>();
  for (const [actorIndex, { bodyHandle }] of Array.from(core.actorMap.entries())) {
    const body = core.world.getRigidBody(bodyHandle);
    if (!body) continue;
    const tr = body.translation();
    const rot = body.rotation();
    actorPose.set(
      actorIndex,
      { t: new THREE.Vector3(tr.x, tr.y, tr.z), q: new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w) }
    );
  }
  // Fallback root pose if actor pose missing
  const rootBody = core.world.getRigidBody(core.rootBodyHandle);
  const rootPose = rootBody
    ? { t: new THREE.Vector3(rootBody.translation().x, rootBody.translation().y, rootBody.translation().z), q: new THREE.Quaternion(rootBody.rotation().x, rootBody.rotation().y, rootBody.rotation().z, rootBody.rotation().w) }
    : { t: new THREE.Vector3(), q: new THREE.Quaternion() };

  // Helper: determine owning actor for a line by nearest node to its midpoint
  function owningActorIndexForLine(p0: {x:number;y:number;z:number}, p1: {x:number;y:number;z:number}): number | undefined {
    const mx = (p0.x + p1.x) * 0.5;
    const my = (p0.y + p1.y) * 0.5;
    const mz = (p0.z + p1.z) * 0.5;
    let bestNode = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < core.chunks.length; i++) {
      const c = core.chunks[i];
      const dx = c.baseLocalOffset.x - mx;
      const dy = c.baseLocalOffset.y - my;
      const dz = c.baseLocalOffset.z - mz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestNode = i; }
    }
    if (bestNode < 0) return undefined;
    return nodeToActor.get(bestNode);
  }

  // Transform each line by its owning actor pose (fallback to root)
  const out: Array<{ p0:{x:number;y:number;z:number}; p1:{x:number;y:number;z:number}; color0:number; color1:number }> = [];
  for (const line of lines) {
    const idx = owningActorIndexForLine(line.p0, line.p1);
    const pose = (idx != null && actorPose.get(idx)) || rootPose;

    const v0 = new THREE.Vector3(line.p0.x, line.p0.y, line.p0.z).applyQuaternion(pose.q).add(pose.t);
    const v1 = new THREE.Vector3(line.p1.x, line.p1.y, line.p1.z).applyQuaternion(pose.q).add(pose.t);
    out.push({ p0: { x: v0.x, y: v0.y, z: v0.z }, p1: { x: v1.x, y: v1.y, z: v1.z }, color0: line.color0, color1: line.color1 });
  }
  return out;
}


