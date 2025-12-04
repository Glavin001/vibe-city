import * as THREE from 'three';
import type { DestructibleCore } from '@/lib/stress/core/types';

const shadowsEnabled = false;

const HEALTHY_COLOR = new THREE.Color(0x2fbf71);
const CRITICAL_COLOR = new THREE.Color(0xd72638);
const DAMAGE_TINT = new THREE.Color();
const PROJECTILE_MAX_LIFETIME = 12; // seconds
const PROJECTILE_MIN_Y = -50;
const nowSeconds = () =>
  (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function buildChunkMeshes(core: DestructibleCore, materials?: { deck?: THREE.Material; support?: THREE.Material }) {
  const deckMat = (materials?.deck ?? new THREE.MeshStandardMaterial({ color: 0x4b6fe8, roughness: 0.4, metalness: 0.45 }));
  const supportMat = (materials?.support ?? new THREE.MeshStandardMaterial({ color: 0x2f3e56, roughness: 0.6, metalness: 0.25 }));
  const meshes: THREE.Mesh[] = [];
  for (const chunk of core.chunks) {
    const mat = chunk.isSupport ? supportMat.clone() : deckMat.clone();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z), mat);
    mesh.userData.nodeIndex = chunk.nodeIndex;
    mesh.castShadow = shadowsEnabled;
    mesh.receiveShadow = shadowsEnabled;
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
    mesh.castShadow = shadowsEnabled;
    mesh.receiveShadow = shadowsEnabled;
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
    // Hide destroyed chunks
    if (chunk.destroyed) {
      mesh.visible = false;
      continue;
    } else {
      mesh.visible = true;
    }
    const handle = chunk.bodyHandle;
    if (handle == null) {
      // if (process.env.NODE_ENV !== 'production') console.warn('[Adapter] Missing bodyHandle for chunk', { chunkIndex: i });
      continue;
    }
    const body = core.world.getRigidBody(handle);
    if (!body) {
      // if (process.env.NODE_ENV !== 'production') console.warn('[Adapter] Missing body for chunk', { chunkIndex: i });
      continue;
    }

    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    quat.set(r.x, r.y, r.z, r.w);
    mesh.quaternion.copy(quat);
    tmp.set(chunk.baseLocalOffset.x, chunk.baseLocalOffset.y, chunk.baseLocalOffset.z).applyQuaternion(mesh.quaternion);
    mesh.position.add(tmp);

    // Set mesh color based on type of rigid body and optional damage health tint
    // Use MeshStandardMaterial color for clarity; this affects the mesh's material but preserves shadows/etc
    if (body) {
      const mat = (mesh.material && mesh.material instanceof THREE.MeshStandardMaterial) ? mesh.material : null;
      if (!mat) continue;
      const damageEnabled = (core as unknown as { damageEnabled?: boolean }).damageEnabled === true;
      const healthGetter = (core as unknown as { getNodeHealth?: (idx:number) => { health:number; maxHealth:number; destroyed:boolean } | null }).getNodeHealth;
      if (damageEnabled && typeof healthGetter === 'function') {
        const info = healthGetter(chunk.nodeIndex);
        if (info && info.maxHealth > 0) {
          const ratio = Math.max(0, Math.min(1, info.health / info.maxHealth));
          DAMAGE_TINT.copy(HEALTHY_COLOR).lerp(CRITICAL_COLOR, 1 - ratio);
          mat.color.copy(DAMAGE_TINT);
          continue;
        }
      }
      // Fallback when damage disabled or unknown
      if (body.isKinematic()) mat.color.setHex(0x2a6ddb);
      else if (body.isFixed()) mat.color.setHex(0xbababa);
      else if (body.isDynamic()) mat.color.setHex(0xff9147);
    }
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

export function updateProjectileMeshes(
  core: DestructibleCore,
  root: THREE.Group,
) {
  const profilerRecorder = (
    core as unknown as {
      recordProjectileCleanupDuration?: (durationMs: number) => void;
    }
  ).recordProjectileCleanupDuration;
  const hasPerf =
    typeof performance !== 'undefined' && typeof performance.now === 'function';
  const timeNow = hasPerf
    ? () => performance.now()
    : () => Date.now();
  const timerStart = profilerRecorder ? timeNow() : null;
  const projectiles = core.projectiles as Array<{
    bodyHandle: number;
    radius: number;
    type: 'ball' | 'box';
    mesh?: THREE.Mesh;
    spawnTime?: number;
  }>;
  const now = nowSeconds();
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    const body = core.world.getRigidBody(p.bodyHandle);
    const lifetime =
      typeof p.spawnTime === 'number' ? now - p.spawnTime : 0;
    const shouldCullLifetime = lifetime > PROJECTILE_MAX_LIFETIME;
    const shouldCullBody = !body;
    const bodyTranslation = body?.translation();
    const shouldCullFall =
      bodyTranslation && bodyTranslation.y < PROJECTILE_MIN_Y;

    if (shouldCullLifetime || shouldCullBody || shouldCullFall) {
      if (p.mesh) {
        root.remove(p.mesh);
        try {
          p.mesh.geometry?.dispose?.();
        } catch {}
        try {
          (p.mesh.material as THREE.Material | undefined)?.dispose?.();
        } catch {}
      }
      if (body) {
        try {
          core.world.removeRigidBody(body);
        } catch {}
      }
      projectiles.splice(i, 1);
      continue;
    }

    if (!p.mesh) {
      const geom =
        p.type === 'ball'
          ? new THREE.SphereGeometry(p.radius, 24, 24)
          : new THREE.BoxGeometry(p.radius * 2, p.radius * 2, p.radius * 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff9147,
        emissive: 0x331100,
        roughness: 0.4,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = shadowsEnabled;
      mesh.receiveShadow = shadowsEnabled;
      p.mesh = mesh;
      root.add(mesh);
    }
    if (!body) continue;
    const mesh = p.mesh as THREE.Mesh;
    mesh.visible = true;
    if (!bodyTranslation) continue;
    const rotation = body.rotation();
    mesh.position.set(bodyTranslation.x, bodyTranslation.y, bodyTranslation.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }
  if (profilerRecorder && timerStart != null) {
    profilerRecorder(Math.max(0, timeNow() - timerStart));
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


