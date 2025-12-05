import * as THREE from 'three';
import { BatchedMesh } from 'three';
import { extendBatchedMeshPrototype, getBatchedMeshCount } from '@three.ez/batched-mesh-extensions';
import type { DestructibleCore, ChunkData } from '@/lib/stress/core/types';
import type RAPIER from '@dimforge/rapier3d-compat';

// Extend BatchedMesh prototype with BVH and per-instance uniform support
extendBatchedMeshPrototype();

const shadowsEnabled = true;

const HEALTHY_COLOR = new THREE.Color(0x2fbf71);
const CRITICAL_COLOR = new THREE.Color(0xd72638);

// Rigid body type colors
const KINEMATIC_COLOR = 0x2a6ddb;
const FIXED_COLOR = 0xbababa;
const DYNAMIC_COLOR = 0xff9147;

type ChunkLike = Pick<ChunkData, 'nodeIndex'>;
type RigidBodyLike = Pick<RAPIER.RigidBody, 'isKinematic' | 'isFixed' | 'isDynamic'>;

/**
 * Apply color based on damage health or rigid body type.
 * Mutates and returns the provided color instance.
 */
export function applyChunkColor(opts: {
  core: DestructibleCore;
  chunk: ChunkLike;
  body: RigidBodyLike;
  color: THREE.Color;
}): THREE.Color {
  const { core, chunk, body, color } = opts;

  // Try damage-based coloring first
  const damageEnabled = core.damageEnabled === true;
  const healthGetter = core.getNodeHealth;
  if (damageEnabled && typeof healthGetter === 'function') {
    const info = healthGetter(chunk.nodeIndex);
    if (info && info.maxHealth > 0) {
      const ratio = Math.max(0, Math.min(1, info.health / info.maxHealth));
      color.copy(HEALTHY_COLOR).lerp(CRITICAL_COLOR, 1 - ratio);
      return color;
    }
  }

  // Fallback: color by rigid body type
  if (body.isKinematic()) color.setHex(KINEMATIC_COLOR);
  else if (body.isFixed()) color.setHex(FIXED_COLOR);
  else if (body.isDynamic()) color.setHex(DYNAMIC_COLOR);

  return color;
}

// Reusable objects for batched mesh updates (avoid allocations per frame)
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _localOffset = new THREE.Vector3();
const _colorTmp = new THREE.Color();

// Types for the extended BatchedMesh from @three.ez/batched-mesh-extensions
type ExtendedBatchedMesh = BatchedMesh & {
  initUniformsPerInstance?: (config: { vertex?: Record<string, string>; fragment?: Record<string, string> }) => void;
  setUniformAt?: (instanceId: number, name: string, value: unknown) => void;
  setColorAt?: (instanceId: number, color: THREE.Color) => void;
  computeBVH?: (coordinateSystem?: number, options?: { margin?: number }) => void;
  bvh?: {
    insert: (instanceId: number) => void;
    insertRange: (ids: number[]) => void;
    move: (instanceId: number) => void;
    delete: (instanceId: number) => void;
    clear: () => void;
  };
};

export type BatchedChunkMeshResult = {
  batchedMesh: ExtendedBatchedMesh;
  chunkToInstanceId: Map<number, number>;
  geometryIds: number[];
  dispose: () => void;
};
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

/**
 * Build a BatchedMesh containing all chunk geometries for optimized rendering.
 * Reduces draw calls from N chunks to 1.
 */
export function buildBatchedChunkMesh(
  core: DestructibleCore,
  options?: {
    enablePerInstanceUniforms?: boolean;
    enableBVH?: boolean;
    bvhMargin?: number;
  }
): BatchedChunkMeshResult {
  const enableUniforms = options?.enablePerInstanceUniforms ?? true;
  const enableBVH = options?.enableBVH ?? true;
  const bvhMargin = options?.bvhMargin ?? 0.5;

  // Collect geometries - one per chunk (box geometry based on chunk size)
  const geometries: THREE.BufferGeometry[] = [];
  for (const chunk of core.chunks) {
    const geom = new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z);
    try { geom.clearGroups(); } catch {}
    geometries.push(geom);
  }

  return buildBatchedChunkMeshInternal(core, geometries, { enableUniforms, enableBVH, bvhMargin });
}

/**
 * Build a BatchedMesh from pre-existing geometries (e.g., from GLB fracture).
 */
export function buildBatchedChunkMeshFromGeometries(
  core: DestructibleCore,
  geometries: THREE.BufferGeometry[],
  options?: {
    enablePerInstanceUniforms?: boolean;
    enableBVH?: boolean;
    bvhMargin?: number;
  }
): BatchedChunkMeshResult {
  const enableUniforms = options?.enablePerInstanceUniforms ?? true;
  const enableBVH = options?.enableBVH ?? true;
  const bvhMargin = options?.bvhMargin ?? 0.5;

  // For supports, use box geometry; for fragments use provided geometries
  const finalGeometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < core.chunks.length; i++) {
    const chunk = core.chunks[i];
    const geom = chunk.isSupport
      ? new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z)
      : (geometries[i] ?? new THREE.BoxGeometry(chunk.size.x, chunk.size.y, chunk.size.z));
    try { geom.clearGroups(); } catch {}
    finalGeometries.push(geom);
  }

  return buildBatchedChunkMeshInternal(core, finalGeometries, { enableUniforms, enableBVH, bvhMargin });
}

function buildBatchedChunkMeshInternal(
  core: DestructibleCore,
  geometries: THREE.BufferGeometry[],
  config: { enableUniforms: boolean; enableBVH: boolean; bvhMargin: number }
): BatchedChunkMeshResult {
  const chunkCount = core.chunks.length;

  // Calculate total vertex and index counts
  const { vertexCount, indexCount } = getBatchedMeshCount(geometries);

  // Create material - use a visible base color
  // Per-instance uniforms from @three.ez/batched-mesh-extensions may not be working reliably
  // so we use a static color for now (all chunks same color)
  const material = new THREE.MeshStandardMaterial({
    color: 0xbababa,  // Light gray - visible base color
    roughness: 0.5,
    metalness: 0.1,
  });

  // Create the BatchedMesh
  const batchedMesh = new BatchedMesh(
    chunkCount,     // maxInstanceCount
    vertexCount,    // maxVertexCount
    indexCount,     // maxIndexCount
    material
  ) as ExtendedBatchedMesh;

  batchedMesh.castShadow = shadowsEnabled;
  batchedMesh.receiveShadow = shadowsEnabled;
  // Disable frustum culling at the mesh level - the BVH handles per-instance culling
  // Setting this to true can cause the entire mesh to be culled when camera is close
  batchedMesh.frustumCulled = false;

  // Track geometry IDs and instance IDs
  const geometryIds: number[] = [];
  const chunkToInstanceId = new Map<number, number>();

  // Add each chunk's geometry and create an instance
  for (let i = 0; i < chunkCount; i++) {
    const chunk = core.chunks[i];
    const geom = geometries[i];

    // Add geometry
    const geoId = batchedMesh.addGeometry(geom);
    geometryIds.push(geoId);

    // Add instance for this geometry
    const instanceId = batchedMesh.addInstance(geoId);
    chunkToInstanceId.set(chunk.nodeIndex, instanceId);

    // Set initial transform
    const body = core.world.getRigidBody(chunk.bodyHandle ?? -1);
    if (body) {
      const t = body.translation();
      const r = body.rotation();
      _position.set(t.x, t.y, t.z);
      _quaternion.set(r.x, r.y, r.z, r.w);
      _localOffset.set(chunk.baseLocalOffset.x, chunk.baseLocalOffset.y, chunk.baseLocalOffset.z);
      _localOffset.applyQuaternion(_quaternion);
      _position.add(_localOffset);
      _matrix.compose(_position, _quaternion, _scale);
    } else {
      // Use base local offset as position for initial setup
      _position.set(chunk.baseLocalOffset.x, chunk.baseLocalOffset.y, chunk.baseLocalOffset.z);
      _quaternion.identity();
      _matrix.compose(_position, _quaternion, _scale);
    }
    batchedMesh.setMatrixAt(instanceId, _matrix);
    batchedMesh.setVisibleAt(instanceId, !chunk.destroyed);
    batchedMesh.setColorAt(instanceId, new THREE.Color(0x00ff00));
  }

  // NOTE: Per-instance coloring via @three.ez/batched-mesh-extensions uniforms
  // is not working reliably. All chunks will have the same material color.
  // Health/damage coloring is disabled when using BatchedMesh.
  // To enable per-chunk coloring, set useBatchedMesh = false in page.tsx.
  console.log('[BatchedMesh] Created with', chunkCount, 'instances (per-instance coloring disabled)');

  // Compute BVH for frustum culling
  if (config.enableBVH && typeof batchedMesh.computeBVH === 'function') {
    try {
      // Use WebGL coordinate system (THREE.WebGLCoordinateSystem = 2000)
      batchedMesh.computeBVH(2000, { margin: config.bvhMargin });
    } catch (e) {
      console.warn('[BatchedMesh] Failed to compute BVH:', e);
    }
  }

  // Dispose function
  const dispose = () => {
    try {
      batchedMesh.dispose();
    } catch {}
    try {
      material.dispose();
    } catch {}
    for (const geom of geometries) {
      try {
        geom.dispose();
      } catch {}
    }
  };

  return {
    batchedMesh,
    chunkToInstanceId,
    geometryIds,
    dispose,
  };
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
      if (mat) {
        applyChunkColor({ core, chunk, body, color: mat.color });
      }
    }
  }
}

/**
 * Update all chunk instance transforms and colors in the BatchedMesh.
 * This is the optimized replacement for updateChunkMeshes.
 */
export function updateBatchedChunkMesh(
  core: DestructibleCore,
  batchedMesh: ExtendedBatchedMesh,
  chunkToInstanceId: Map<number, number>,
  options?: {
    updateBVH?: boolean;
  }
) {
  const updateBVH = options?.updateBVH ?? false;

  for (let i = 0; i < core.chunks.length; i++) {
    const chunk = core.chunks[i];
    const instanceId = chunkToInstanceId.get(chunk.nodeIndex);
    if (instanceId == null) continue;

    // Handle destroyed chunks - hide them
    if (chunk.destroyed) {
      batchedMesh.setVisibleAt(instanceId, false);
      continue;
    }

    const handle = chunk.bodyHandle;
    if (handle == null) {
      batchedMesh.setVisibleAt(instanceId, false);
      continue;
    }

    const body = core.world.getRigidBody(handle);
    if (!body) {
      batchedMesh.setVisibleAt(instanceId, false);
      continue;
    }

    // Compute world matrix: body transform * chunk local offset
    const t = body.translation();
    const r = body.rotation();
    _position.set(t.x, t.y, t.z);
    _quaternion.set(r.x, r.y, r.z, r.w);

    _localOffset.set(chunk.baseLocalOffset.x, chunk.baseLocalOffset.y, chunk.baseLocalOffset.z);
    _localOffset.applyQuaternion(_quaternion);
    _position.add(_localOffset);

    _matrix.compose(_position, _quaternion, _scale);
    batchedMesh.setMatrixAt(instanceId, _matrix);
    batchedMesh.setVisibleAt(instanceId, true);
    
    applyChunkColor({ core, chunk, body, color: _colorTmp });
    batchedMesh.setColorAt(instanceId, _colorTmp);

    // Update BVH if instance moved significantly (optional, can be expensive)
    if (updateBVH && batchedMesh.bvh) {
      try {
        batchedMesh.bvh.move(instanceId);
      } catch {}
    }

    // NOTE: Per-instance coloring is disabled for BatchedMesh
    // All chunks share the same material color
  }
}

export { SolverDebugLinesHelper } from './solver-debug-lines';

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
