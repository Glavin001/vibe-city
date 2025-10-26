import RAPIER, { type RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat';
import { loadStressSolver } from 'blast-stress-solver';
import type { DestructibleCore, ScenarioDesc, ChunkData, Vec3, ProjectileSpawn, BondRef } from './types';
import { DestructibleDamageSystem, type DamageOptions } from './damage';

type MutableVec3 = { x:number; y:number; z:number };
type MutableQuat = { x:number; y:number; z:number; w:number };

type BuildCoreOptions = {
  scenario: ScenarioDesc;
  // Collider sizing strategy for nodes → Box colliders
  nodeSize: (nodeIndex: number, scenario: ScenarioDesc) => Vec3; // full extents
  gravity?: number;
  friction?: number;
  restitution?: number;
  materialScale?: number;
  limitSinglesCollisions?: boolean;
  damage?: DamageOptions & { autoDetachOnDestroy?: boolean; autoCleanupPhysics?: boolean };
  onNodeDestroyed?: (e: { nodeIndex: number; actorIndex: number; reason: 'impact'|'manual' }) => void;
  // Fracture rollback/resimulation controls
  resimulateOnFracture?: boolean; // default true
  maxResimulationPasses?: number; // default 1
  snapshotMode?: 'perBody' | 'world'; // default 'perBody'
  onWorldReplaced?: (newWorld: RAPIER.World) => void; // only used when snapshotMode==='world'
};

const isDev = process.env.NODE_ENV !== 'production';

export async function buildDestructibleCore({
  scenario,
  nodeSize,
  gravity = -9.81,
  friction = 0.25,
  restitution = 0.0,
  materialScale = 1.0,
  limitSinglesCollisions = false,
  damage,
  onNodeDestroyed,
  resimulateOnFracture = true,
  maxResimulationPasses = 1,
  snapshotMode = 'perBody',
  onWorldReplaced,
}: BuildCoreOptions): Promise<DestructibleCore> {
  await RAPIER.init();
  const runtime = await loadStressSolver();

  const settings = runtime.defaultExtSettings();
  const scaledSettings = { ...settings };

  // Reasonable defaults; caller can adjust later if needed
  // settings.maxSolverIterationsPerFrame = 64;
  settings.maxSolverIterationsPerFrame = 24;
  settings.graphReductionLevel = 0;

  const baseCompressionElastic = 0.0009;
  const baseCompressionFatal = 0.0027;
  const baseShearElastic = 0.0012;
  const baseShearFatal = 0.0036;
  const baseTensionElastic = 0.0009;
  const baseTensionFatal = 0.0027;

  scaledSettings.compressionElasticLimit = baseCompressionElastic * materialScale;
  scaledSettings.compressionFatalLimit = baseCompressionFatal * materialScale;
  scaledSettings.tensionElasticLimit = baseTensionElastic * materialScale;
  scaledSettings.tensionFatalLimit = baseTensionFatal * materialScale;
  scaledSettings.shearElasticLimit = baseShearElastic * materialScale;
  scaledSettings.shearFatalLimit = baseShearFatal * materialScale;

  // Mark supports via mass=0
  const nodes = scenario.nodes.map((n) => ({ centroid: n.centroid, mass: n.mass, volume: n.volume }));
  const bonds = scenario.bonds.map((b) => ({ node0: b.node0, node1: b.node1, centroid: b.centroid, normal: b.normal, area: b.area }));

  const hasSupports = nodes.some((n) => n.mass === 0);
  if (!hasSupports) {
    console.warn('[Core] no supports (nodes withmass=0)found in scenario', scenario);
  }

  const solver = runtime.createExtSolver({ nodes, bonds, settings: scaledSettings });

  // Persist bond list with indices for cutting and adjacency
  const bondTable: Array<{ index:number; node0:number; node1:number; centroid:Vec3; normal:Vec3; area:number }> = scenario.bonds.map((b, i) => ({ index: i, node0: b.node0, node1: b.node1, centroid: b.centroid, normal: b.normal, area: b.area }));
  const bondsByNode = new Map<number, number[]>();
  for (const b of bondTable) {
    if (!bondsByNode.has(b.node0)) bondsByNode.set(b.node0, []);
    if (!bondsByNode.has(b.node1)) bondsByNode.set(b.node1, []);
    const arr0 = bondsByNode.get(b.node0);
    const arr1 = bondsByNode.get(b.node1);
    if (arr0) arr0.push(b.index);
    if (arr1) arr1.push(b.index);
  }

  let world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  const eventQueue = new RAPIER.EventQueue(true);

  // Root fixed body
  const rootBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
    .setUserData({ root: true })
  );

  // Ground collider (fixed body), wide plane with top aligned to y=0
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(0, 0, 0)
      .setUserData({ ground: true })
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(100, 0.025, 100)
      .setTranslation(0, -0.025, 0)
      .setFriction(0.9)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.0)
      ,
    groundBody
  );

  // Create chunk colliders attached to root (supports may become separate fixed bodies later on split)
  const chunks: ChunkData[] = [];
  const colliderToNode = new Map<number, number>();
  const activeContactColliders = new Set<number>();
  const actorMap = new Map<number, { bodyHandle: number }>();
  // Track which actor currently owns each node (updated on splits)
  const nodeToActor = new Map<number, number>();
  for (let i = 0; i < scenario.nodes.length; i += 1) nodeToActor.set(i, 0);

  function actorBodyForNode(nodeIndex: number) {
    const actorIndex = nodeToActor.get(nodeIndex) ?? 0;
    const entry = actorMap.get(actorIndex);
    const bodyHandle = entry?.bodyHandle ?? rootBody.handle;
    const body = world.getRigidBody(bodyHandle);
    return { actorIndex, bodyHandle, body };
  }

  // const spacing = scenario.spacing ?? { x: 0.5, y: 0.5, z: 0.5 };

  function buildColliderDescForNode(args: { nodeIndex: number; halfX: number; halfY: number; halfZ: number; isSupport: boolean }) {
    const { nodeIndex, halfX, halfY, halfZ, isSupport } = args;
    const builder = (scenario.colliderDescForNode && Array.isArray(scenario.colliderDescForNode)) ? (scenario.colliderDescForNode[nodeIndex] ?? null) : null;
    let desc = typeof builder === 'function' ? builder() : null;
    if (!desc) {
      const s = isSupport ? 0.999 : 1.0;
      desc = RAPIER.ColliderDesc.cuboid(halfX * s, halfY * s, halfZ * s);
    }
    return desc;
  }

  scenario.nodes.forEach((node, nodeIndex) => {
    const size = nodeSize(nodeIndex, scenario);
    const halfX = Math.max(0.05, size.x * 0.5);
    const halfY = Math.max(0.05, size.y * 0.5);
    const halfZ = Math.max(0.05, size.z * 0.5);

    const nodeMass = node.mass ?? 1;
    const isSupport = nodeMass === 0;
    const chunk: ChunkData = {
      nodeIndex,
      size: { x: size.x, y: size.y, z: size.z },
      isSupport,
      baseLocalOffset: { x: node.centroid.x, y: node.centroid.y, z: node.centroid.z },
      localOffset: { x: node.centroid.x, y: node.centroid.y, z: node.centroid.z },
      colliderHandle: null,
      bodyHandle: rootBody.handle,
      active: true,
      detached: false,
    };

    const desc = buildColliderDescForNode({ nodeIndex, halfX, halfY, halfZ, isSupport })
      .setMass(nodeMass)
      .setTranslation(chunk.localOffset.x, chunk.localOffset.y, chunk.localOffset.z)
      .setFriction(friction)
      .setRestitution(restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(0.0);
    const col = world.createCollider(desc, rootBody);
    chunk.colliderHandle = col.handle;
    colliderToNode.set(col.handle, nodeIndex);
    activeContactColliders.add(col.handle);
    chunks.push(chunk);
  });

  if (process.env.NODE_ENV !== 'production') {
    try {
      if (isDev) console.debug('[Core] Built chunk colliders', {
        nodeCount: scenario.nodes?.length ?? 0,
        bondCount: scenario.bonds?.length ?? 0,
        mappingSize: colliderToNode.size,
      });
      if (colliderToNode.size === 0) {
        console.warn('[Core] colliderToNode empty after build; contact forces will be dropped unless rebuilt');
      }
    } catch {}
  }

  solver.actors().forEach((actor) => { actorMap.set(actor.actorIndex, { bodyHandle: rootBody.handle }); });

  // Queues and scratch
  const pendingBodiesToCreate: Array<{ actorIndex: number; inheritFromBodyHandle: number; nodes: number[]; isSupport: boolean }> = [];
  const pendingColliderMigrations: Array<{ nodeIndex: number; targetBodyHandle: number }> = [];
  const disabledCollidersToRemove = new Set<number>();
  const bodiesToRemove = new Set<number>();
  const pendingBallSpawns: ProjectileSpawn[] = [];
  const projectiles: Array<{ bodyHandle: number; radius: number; type: 'ball'|'box'; mesh?: unknown }> = [];
  const removedBondIndices = new Set<number>();
  const pendingExternalForces: Array<{ nodeIndex:number; point: Vec3; force: Vec3 }> = [];

  const scratchVecA: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecB: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecC: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecD: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecE: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecF: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecG: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecH: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecI: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecJ: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecK: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecL: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecM: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecN: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecO: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecP: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecQ: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchVecR: MutableVec3 = { x: 0, y: 0, z: 0 };
  const scratchQuatA: MutableQuat = { x: 0, y: 0, z: 0, w: 1 };
  const scratchQuatB: MutableQuat = { x: 0, y: 0, z: 0, w: 1 };

  let safeFrames = 0;
  let warnedColliderMapEmptyOnce = false;
  let solverGravityEnabled = true;
  let limitSinglesCollisionsEnabled = !!limitSinglesCollisions;
  const damageOptions: Required<DamageOptions & { autoDetachOnDestroy?: boolean; autoCleanupPhysics?: boolean }> = {
    enabled: !!damage?.enabled,
    strengthPerVolume: damage?.strengthPerVolume ?? 10000,
    kImpact: damage?.kImpact ?? 0.002,
    enableSupportsDamage: damage?.enableSupportsDamage ?? false,
    autoDetachOnDestroy: damage?.autoDetachOnDestroy ?? true,
    autoCleanupPhysics: damage?.autoCleanupPhysics ?? true,
    contactDamageScale: damage?.contactDamageScale ?? 1.0,
    minImpulseThreshold: damage?.minImpulseThreshold ?? 50,
    contactCooldownMs: damage?.contactCooldownMs ?? 120,
    internalContactScale: damage?.internalContactScale ?? 2.0,
    massExponent: damage?.massExponent ?? 0.5,
    internalMinImpulseThreshold: damage?.internalMinImpulseThreshold ?? 15,
    splashRadius: damage?.splashRadius ?? 1.5,
    splashFalloffExp: damage?.splashFalloffExp ?? 2.0,
    speedMinExternal: damage?.speedMinExternal ?? 0.5,
    speedMinInternal: damage?.speedMinInternal ?? 0.25,
    speedMax: damage?.speedMax ?? 6.0,
    speedExponent: damage?.speedExponent ?? 1.0,
    slowSpeedFactor: damage?.slowSpeedFactor ?? 0.9,
    fastSpeedFactor: damage?.fastSpeedFactor ?? 3.0,
  } as const;

  const damageSystem = new DestructibleDamageSystem({ chunks, scenario, materialScale, options: damageOptions });

  // --- Shared helpers for speed scaling and contact draining ---
  const copyInto = (out: MutableVec3, src?: { x:number; y:number; z:number } | null | undefined): MutableVec3 => {
    out.x = src?.x ?? 0;
    out.y = src?.y ?? 0;
    out.z = src?.z ?? 0;
    return out;
  };

  const setVec = (out: MutableVec3, x: number, y: number, z: number): MutableVec3 => {
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  };

  function getDt(): number {
    try {
      return world.timestep
        ?? world.integrationParameters?.dt
        ?? (1 / 60);
    } catch { return (1 / 60); }
  }

  function computeSpeedFactor(relSpeed: number, isInternal: boolean): number {
    try {
      const opts = damageSystem.getOptions();
      const vMin = isInternal ? (opts.speedMinInternal ?? 0.25) : (opts.speedMinExternal ?? 0.5);
      const vMax = opts.speedMax ?? 6.0;
      const exp = Math.max(0.01, opts.speedExponent ?? 1.0);
      const slow = Math.max(0, Math.min(1, opts.slowSpeedFactor ?? 0.9));
      const fast = Math.max(1, opts.fastSpeedFactor ?? 3.0);
      const vSpan = Math.max(1e-3, vMax - vMin);
      const t = relSpeed > vMin ? Math.min(1, Math.pow((relSpeed - vMin) / vSpan, exp)) : 0;
      return slow + (fast - slow) * t;
    } catch {
      return 1.0;
    }
  }

  // --- Buffered contact damage (to avoid double-apply across rollback) ---
  type BufferedExternalContact = { node:number; effMag:number; dt:number; hasLocal:boolean; localX:number; localY:number; localZ:number };
  type BufferedInternalContact = { a:number; b:number; effMag:number; dt:number; hasLocalA:boolean; hasLocalB:boolean; localAX:number; localAY:number; localAZ:number; localBX:number; localBY:number; localBZ:number };
  const bufferedExternal: BufferedExternalContact[] = [];
  const bufferedInternal: BufferedInternalContact[] = [];
  function clearBufferedContacts() { bufferedExternal.length = 0; bufferedInternal.length = 0; }
  function replayBufferedContacts() {
    if (!damageSystem.isEnabled()) return;
    const impactScratch = { localPoint: { x: 0, y: 0, z: 0 } as MutableVec3 };
    const internalScratch = {
      localPointA: { x: 0, y: 0, z: 0 } as MutableVec3 | undefined,
      localPointB: { x: 0, y: 0, z: 0 } as MutableVec3 | undefined,
    };
    for (const e of bufferedExternal) {
      const opts = e.hasLocal
        ? (setVec(impactScratch.localPoint, e.localX, e.localY, e.localZ), impactScratch)
        : undefined;
      damageSystem.onImpact(e.node, e.effMag, e.dt, opts as { localPoint?: Vec3 } | undefined);
    }
    for (const i of bufferedInternal) {
      internalScratch.localPointA = i.hasLocalA
        ? setVec(internalScratch.localPointA ?? (internalScratch.localPointA = { x: 0, y: 0, z: 0 }), i.localAX, i.localAY, i.localAZ)
        : undefined;
      internalScratch.localPointB = i.hasLocalB
        ? setVec(internalScratch.localPointB ?? (internalScratch.localPointB = { x: 0, y: 0, z: 0 }), i.localBX, i.localBY, i.localBZ)
        : undefined;
      damageSystem.onInternalImpact(i.a, i.b, i.effMag, i.dt, internalScratch as { localPointA?: Vec3; localPointB?: Vec3 });
    }
  }

  function drainContactForces(params: { injectSolverForces: boolean; applyDamage: boolean; recordForReplay?: boolean }) {
    const applyDamage = !!params.applyDamage;
    const record = !!params.recordForReplay;
    const damageEnabled = damageSystem.isEnabled();
    if (!damageEnabled && !params.injectSolverForces && !record) {
      eventQueue.drainContactForceEvents(() => {});
      return;
    }
    const dt = getDt();
    const localScratch1 = scratchVecA;
    const localScratch2 = scratchVecB;
    const anchorScratch = scratchVecC;
    const fallbackScratch1 = scratchVecD;
    const fallbackScratch2 = scratchVecE;
    const worldScratch1 = scratchVecF;
    const worldScratch2 = scratchVecG;
    const chunkCenterScratch1 = scratchVecH;
    const chunkCenterScratch2 = scratchVecI;
    const impactOpts1 = { localPoint: localScratch1 as Vec3 } as { localPoint: Vec3 };
    const impactOpts2 = { localPoint: localScratch2 as Vec3 } as { localPoint: Vec3 };
    const internalOpts = { localPointA: undefined as Vec3 | undefined, localPointB: undefined as Vec3 | undefined };

    eventQueue.drainContactForceEvents((ev: {
      totalForce: () => { x:number; y:number; z:number };
      totalForceMagnitude: () => number;
      collider1: () => number;
      collider2: () => number;
      worldContactPoint?: () => { x:number; y:number; z:number };
      worldContactPoint2?: () => { x:number; y:number; z:number };
    }) => {
      const tf = ev.totalForce?.();
      const mag = ev.totalForceMagnitude?.();
      if (!tf || !(mag > 0)) return;

      const h1 = ev.collider1?.();
      const h2 = ev.collider2?.();
      const wp = ev.worldContactPoint?.();
      const wp2 = ev.worldContactPoint2?.();

      const node1 = h1 != null ? colliderToNode.get(h1) : undefined;
      const node2 = h2 != null ? colliderToNode.get(h2) : undefined;
      const isInternal = node1 != null && node2 != null;

      const fallback1 = fallbackPoint(h1, fallbackScratch1);
      const fallback2 = fallbackPoint(h2, fallbackScratch2);
      const center1 = node1 != null ? chunkWorldCenter(node1, chunkCenterScratch1) : null;
      const center2 = node2 != null ? chunkWorldCenter(node2, chunkCenterScratch2) : null;

      const contact1 = copyInto(worldScratch1, wp ?? wp2 ?? center1 ?? fallback1);
      const contact2 = copyInto(worldScratch2, wp2 ?? wp ?? center2 ?? fallback2);

      copyInto(anchorScratch, node1 != null ? contact1 : node2 != null ? contact2 : contact1);
      const relSpeed = computeRelativeSpeed(world, h1, h2, anchorScratch);
      const speedFactor = computeSpeedFactor(relSpeed, isInternal);
      let effMag = (mag ?? 0) * speedFactor;

      try {
        const b1 = getBodyForColliderHandle(h1);
        const b2 = getBodyForColliderHandle(h2);
        const ud1 = (b1 as unknown as { userData?: { projectile?: boolean } } | null)?.userData;
        const ud2 = (b2 as unknown as { userData?: { projectile?: boolean } } | null)?.userData;
        const projBody = ud1?.projectile ? b1 : ud2?.projectile ? b2 : null;
        if (projBody && (node1 != null || node2 != null)) {
          let m = 1;
          try {
            m = typeof (projBody as unknown as { mass: () => number }).mass === 'function'
              ? (projBody as unknown as { mass: () => number }).mass()
              : m;
          } catch {}
          const impulseEstimate = Math.max(0, m) * Math.max(0, relSpeed);
          const forceFromMomentum = impulseEstimate / Math.max(1e-6, dt);
          if (Number.isFinite(forceFromMomentum) && forceFromMomentum > 0) {
            effMag = Math.max(effMag, forceFromMomentum);
          }
        }
      } catch {}

      const localRes1 = node1 != null ? worldPointToActorLocal(node1, contact1, localScratch1) : null;
      const localRes2 = node2 != null ? worldPointToActorLocal(node2, contact2, localScratch2) : null;
      const hasLocal1 = !!localRes1;
      const hasLocal2 = !!localRes2;
      const local1X = hasLocal1 ? localScratch1.x : 0;
      const local1Y = hasLocal1 ? localScratch1.y : 0;
      const local1Z = hasLocal1 ? localScratch1.z : 0;
      const local2X = hasLocal2 ? localScratch2.x : 0;
      const local2Y = hasLocal2 ? localScratch2.y : 0;
      const local2Z = hasLocal2 ? localScratch2.z : 0;
      internalOpts.localPointA = undefined;
      internalOpts.localPointB = undefined;

      if (h1 != null && node1 != null && node2 == null) {
        if (params.injectSolverForces) addForceForCollider(h1, +1, tf, contact1);
        if (damageEnabled) {
          if (applyDamage) {
            try {
              const opts = hasLocal1 ? (setVec(localScratch1, local1X, local1Y, local1Z), impactOpts1) : undefined;
              damageSystem.onImpact(node1, effMag, dt, opts);
            } catch {}
          } else if (record) {
            const idx = bufferedExternal.length;
            const entry = bufferedExternal[idx] ?? (bufferedExternal[idx] = { node: 0, effMag: 0, dt: 0, hasLocal: false, localX: 0, localY: 0, localZ: 0 });
            entry.node = node1;
            entry.effMag = effMag;
            entry.dt = dt;
            entry.hasLocal = hasLocal1;
            entry.localX = hasLocal1 ? local1X : 0;
            entry.localY = hasLocal1 ? local1Y : 0;
            entry.localZ = hasLocal1 ? local1Z : 0;
          }
        }
      }

      if (h2 != null && node2 != null && node1 == null) {
        if (params.injectSolverForces) addForceForCollider(h2, -1, tf, contact2);
        if (damageEnabled) {
          if (applyDamage) {
            try {
              const opts = hasLocal2 ? (setVec(localScratch2, local2X, local2Y, local2Z), impactOpts2) : undefined;
              damageSystem.onImpact(node2, effMag, dt, opts);
            } catch {}
          } else if (record) {
            const idx = bufferedExternal.length;
            const entry = bufferedExternal[idx] ?? (bufferedExternal[idx] = { node: 0, effMag: 0, dt: 0, hasLocal: false, localX: 0, localY: 0, localZ: 0 });
            entry.node = node2;
            entry.effMag = effMag;
            entry.dt = dt;
            entry.hasLocal = hasLocal2;
            entry.localX = hasLocal2 ? local2X : 0;
            entry.localY = hasLocal2 ? local2Y : 0;
            entry.localZ = hasLocal2 ? local2Z : 0;
          }
        }
      }

      if (h1 != null && h2 != null && node1 != null && node2 != null && damageEnabled) {
        if (applyDamage) {
          try {
            internalOpts.localPointA = hasLocal1 ? setVec(localScratch1, local1X, local1Y, local1Z) : undefined;
            internalOpts.localPointB = hasLocal2 ? setVec(localScratch2, local2X, local2Y, local2Z) : undefined;
            damageSystem.onInternalImpact(node1, node2, effMag, dt, internalOpts);
          } catch {}
        } else if (record) {
          const idx = bufferedInternal.length;
          const entry = bufferedInternal[idx]
            ?? (bufferedInternal[idx] = {
              a: 0,
              b: 0,
              effMag: 0,
              dt: 0,
              hasLocalA: false,
              hasLocalB: false,
              localAX: 0,
              localAY: 0,
              localAZ: 0,
              localBX: 0,
              localBY: 0,
              localBZ: 0,
            });
          entry.a = node1;
          entry.b = node2;
          entry.effMag = effMag;
          entry.dt = dt;
          entry.hasLocalA = hasLocal1;
          entry.hasLocalB = hasLocal2;
          entry.localAX = hasLocal1 ? local1X : 0;
          entry.localAY = hasLocal1 ? local1Y : 0;
          entry.localAZ = hasLocal1 ? local1Z : 0;
          entry.localBX = hasLocal2 ? local2X : 0;
          entry.localBY = hasLocal2 ? local2Y : 0;
          entry.localBZ = hasLocal2 ? local2Z : 0;
        }
      }
    });
  }

  function injectPendingExternalForces(): boolean {
    const had = pendingExternalForces.length > 0;
    if (!had) return false;
    try {
      const dt = getDt();
      const pointScratch = scratchVecA;
      const scaledForceScratch = scratchVecB;
      const localPointScratch = scratchVecC;
      const localForceScratch = scratchVecD;
      const localImpactOpts = { localPoint: localPointScratch as Vec3 } as { localPoint: Vec3 };
      for (const ef of pendingExternalForces) {
        const { body } = actorBodyForNode(ef.nodeIndex);
        const rb = body ?? world.getRigidBody(rootBody.handle);
        if (!rb) {
          if (isDev) console.warn('addForceForCollider', 'body is null', ef.nodeIndex);
          continue;
        }
        const t = rb.translation();
        const r = rb.rotation();
        scratchQuatA.x = -r.x;
        scratchQuatA.y = -r.y;
        scratchQuatA.z = -r.z;
        scratchQuatA.w = r.w;
        const localPoint = applyQuatToVec3(
          setVec(pointScratch, ef.point.x - t.x, ef.point.y - t.y, ef.point.z - t.z),
          scratchQuatA,
          localPointScratch
        );
        const localForce = applyQuatToVec3(
          setVec(scaledForceScratch, ef.force.x * dt, ef.force.y * dt, ef.force.z * dt),
          scratchQuatA,
          localForceScratch
        );
        solver.addForce(ef.nodeIndex, localPoint, localForce, runtime.ExtForceMode.Force);
        // Map external push impulse to damage
        try {
          if (damageSystem.isEnabled()) {
            const fmag = Math.hypot(ef.force.x, ef.force.y, ef.force.z);
            setVec(localPointScratch, localPoint.x, localPoint.y, localPoint.z);
            damageSystem.onImpact(ef.nodeIndex, fmag, dt, localImpactOpts);
          }
        } catch {}
      }
    } catch (e) {
      if (isDev) console.error('[Core] addForceForCollider failed', e);
    } finally {
      pendingExternalForces.splice(0, pendingExternalForces.length);
    }
    return had;
  }

  function applyDamageTick() {
    if (!damageSystem.isEnabled()) return;
    const dt = getDt();
    damageSystem.tick(dt, (nodeIndex, reason) => {
      try { handleNodeDestroyed(nodeIndex, reason as 'impact'|'manual'); } catch (e) {
        if (isDev) console.error('[Core] handleNodeDestroyed failed', e);
      }
    });
  }

  // Helper: determine if a set of nodes contains any supports (mass=0 or chunk flag)
  const actorNodesContainSupport = (nodesList: number[]): boolean => {
    for (const n of nodesList) {
      const ch = chunks[n];
      if (!ch) {
        console.error('chunk not found', n, ch, chunks);
        throw new Error('chunk not found');
      }
      if (ch?.isSupport) return true;
      const mass = scenario.nodes[n]?.mass ?? 0;
      if (!(mass > 0)) return true;
    }
    return false;
  };

  // Rebuild the collider → node mapping from current chunk state
  function rebuildColliderToNodeFromChunks() {
    let restored = 0;
    for (const seg of chunks) {
      if (seg && seg.colliderHandle != null) {
        colliderToNode.set(seg.colliderHandle, seg.nodeIndex);
        restored += 1;
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Core] Rebuilt colliderToNode from chunks', { restored, totalChunks: chunks.length });
    }
  }

  function enqueueProjectile(s: ProjectileSpawn) {
    // if (process.env.NODE_ENV !== 'production') console.debug('[Core] enqueueProjectile', s);
    pendingBallSpawns.push(s);
    safeFrames = Math.max(safeFrames, 1);
  }

  // Now that options are ready, apply initial collision groups
  try { applyCollisionGroupsForBody(rootBody, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}
  try { applyCollisionGroupsForBody(groundBody, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}

  function setGravity(g: number) {
    try {
      const grav = world.gravity as unknown as { x:number; y:number; z:number };
      grav.x = 0; grav.y = g; grav.z = 0;
      world.gravity = grav as unknown as RAPIER.Vector;
    } catch {
      world.gravity = { x: 0, y: g, z: 0 } as unknown as RAPIER.Vector;
    }
  }
  function setSolverGravityEnabled(v: boolean) { solverGravityEnabled = !!v; }

  function addForceForCollider(handle: number, direction: number, totalForce: { x:number; y:number; z:number }, worldPoint: { x:number; y:number; z:number }) {
    if (!colliderToNode.has(handle)) return;
    const nodeIndex = colliderToNode.get(handle);
    if (nodeIndex == null) return;

    // Transform world force/point into the owning actor's local space
    const { body } = actorBodyForNode(nodeIndex);
    const rb = body ?? world.getRigidBody(rootBody.handle);
    if (!rb) {
      console.warn('addForceForCollider', 'body is null', handle, nodeIndex);
      return;
    }
    const bt = rb.translation();
    const br = rb.rotation();
    scratchQuatA.x = -br.x;
    scratchQuatA.y = -br.y;
    scratchQuatA.z = -br.z;
    scratchQuatA.w = br.w;

    const localForce = applyQuatToVec3(
      setVec(scratchVecJ, (totalForce.x ?? 0) * direction, (totalForce.y ?? 0) * direction, (totalForce.z ?? 0) * direction),
      scratchQuatA,
      scratchVecL
    );
    const localPoint = applyQuatToVec3(
      setVec(scratchVecK, (worldPoint.x ?? 0) - (bt.x ?? 0), (worldPoint.y ?? 0) - (bt.y ?? 0), (worldPoint.z ?? 0) - (bt.z ?? 0)),
      scratchQuatA,
      scratchVecM
    );

    solver.addForce(nodeIndex, localPoint, localForce, runtime.ExtForceMode.Force);
  }

  function getBodyForColliderHandle(handle?: number | null): RAPIER.RigidBody | null {
    if (handle == null) return null;
    try {
      const c = world.getCollider(handle);
      // const parentHandle = c ? c.parent() : undefined;
      // return typeof parentHandle === 'number' ? (world.getRigidBody(parentHandle) ?? null) : null;
      const parent: RapierRigidBody | null = c ? c.parent() : null;
      return parent ?? null;
    } catch {
      // console.error('getBodyForColliderHandle', e);
      return null;
    }
  }

  function bodyPointVelocity(body: RAPIER.RigidBody | null, point: { x:number; y:number; z:number }, out: MutableVec3): MutableVec3 {
    if (!body) return setVec(out, 0, 0, 0);
    try {
      const lv = body.linvel?.();
      const av = body.angvel?.();
      const t = body.translation();
      const rx = (point.x ?? 0) - (t.x ?? 0);
      const ry = (point.y ?? 0) - (t.y ?? 0);
      const rz = (point.z ?? 0) - (t.z ?? 0);
      const cx = (av?.y ?? 0) * rz - (av?.z ?? 0) * ry;
      const cy = (av?.z ?? 0) * rx - (av?.x ?? 0) * rz;
      const cz = (av?.x ?? 0) * ry - (av?.y ?? 0) * rx;
      out.x = (lv?.x ?? 0) + cx;
      out.y = (lv?.y ?? 0) + cy;
      out.z = (lv?.z ?? 0) + cz;
      return out;
    } catch {
      return setVec(out, 0, 0, 0);
    }
  }

  function computeRelativeSpeed(
    _world: RAPIER.World,
    h1?: number | null,
    h2?: number | null,
    atPoint?: { x:number; y:number; z:number }
  ): number {
    const anchor = atPoint ? copyInto(scratchVecP, atPoint) : setVec(scratchVecP, 0, 0, 0);
    const b1 = getBodyForColliderHandle(h1 ?? null);
    const b2 = getBodyForColliderHandle(h2 ?? null);
    const v1 = bodyPointVelocity(b1, anchor, scratchVecQ);
    const v2 = bodyPointVelocity(b2, anchor, scratchVecR);
    const dx = v1.x - v2.x;
    const dy = v1.y - v2.y;
    const dz = v1.z - v2.z;
    return Math.hypot(dx, dy, dz);
  }

  function worldPointToActorLocal(
    nodeIndex: number,
    worldPoint: { x:number; y:number; z:number },
    out: MutableVec3
  ): MutableVec3 | null {
    try {
      const { body } = actorBodyForNode(nodeIndex);
      const rb = body ?? world.getRigidBody(rootBody.handle);
      if (!rb) return null;
      const t = rb.translation();
      const r = rb.rotation();
      scratchQuatB.x = -r.x;
      scratchQuatB.y = -r.y;
      scratchQuatB.z = -r.z;
      scratchQuatB.w = r.w;
      const rel = setVec(scratchVecN, (worldPoint.x ?? 0) - (t.x ?? 0), (worldPoint.y ?? 0) - (t.y ?? 0), (worldPoint.z ?? 0) - (t.z ?? 0));
      return applyQuatToVec3(rel, scratchQuatB, out);
    } catch {
      return null;
    }
  }

  function chunkWorldCenter(nodeIndex: number, out: MutableVec3): MutableVec3 | null {
    try {
      const seg = chunks[nodeIndex];
      if (!seg) return null;
      const { body } = actorBodyForNode(nodeIndex);
      const rb = body ?? world.getRigidBody(rootBody.handle);
      if (!rb) return null;
      const t = rb.translation();
      const r = rb.rotation();
      const local = applyQuatToVec3(seg.baseLocalOffset, r as unknown as { x:number; y:number; z:number; w:number }, scratchVecO);
      out.x = (t.x ?? 0) + local.x;
      out.y = (t.y ?? 0) + local.y;
      out.z = (t.z ?? 0) + local.z;
      return out;
    } catch { return null; }
  }

  function fallbackPoint(handle: number | undefined, out: MutableVec3): MutableVec3 {
    if (handle == null) return setVec(out, 0, 0, 0);
    const c = world.getCollider(handle);
    const parentHandle = c ? c.parent() : undefined;
    const b = typeof parentHandle === 'number' ? world.getRigidBody(parentHandle) : undefined;
    if (b) {
      const t = b.translation();
      return setVec(out, t.x ?? 0, t.y ?? 0, t.z ?? 0);
    }
    return setVec(out, 0, 0, 0);
  }

  // --- Per-body snapshot helpers (Plan A default) ---
  type BodySnapshotEntry = {
    translation: Float32Array;
    rotation: Float32Array;
    linvel: Float32Array;
    angvel: Float32Array;
    asleep: boolean;
    version: number;
  };
  type BodySnapshot = {
    version: number;
    handles: number[];
    entries: Map<number, BodySnapshotEntry>;
  };

  const bodySnapshotEntries = new Map<number, BodySnapshotEntry>();
  const bodySnapshotHandles: number[] = [];
  let bodySnapshotVersion = 0;
  const reusableTranslation = { x: 0, y: 0, z: 0 };
  const reusableRotation = { x: 0, y: 0, z: 0, w: 1 };
  const reusableLinvel = { x: 0, y: 0, z: 0 };
  const reusableAngvel = { x: 0, y: 0, z: 0 };
  const reusableSnapshot: BodySnapshot = {
    version: 0,
    handles: bodySnapshotHandles,
    entries: bodySnapshotEntries,
  };

  function captureBodySnapshot(): BodySnapshot {
    bodySnapshotVersion += 1;
    reusableSnapshot.version = bodySnapshotVersion;
    bodySnapshotHandles.length = 0;
    world.forEachRigidBody((b: RAPIER.RigidBody) => {
      const handle = b.handle;
      let entry = bodySnapshotEntries.get(handle);
      if (!entry) {
        entry = {
          translation: new Float32Array(3),
          rotation: new Float32Array(4),
          linvel: new Float32Array(3),
          angvel: new Float32Array(3),
          asleep: false,
          version: bodySnapshotVersion,
        };
        bodySnapshotEntries.set(handle, entry);
      }
      entry.version = bodySnapshotVersion;
      bodySnapshotHandles.push(handle);
      const t = b.translation();
      const r = b.rotation();
      const lv = b.linvel?.();
      const av = b.angvel?.();
      entry.translation[0] = t.x;
      entry.translation[1] = t.y;
      entry.translation[2] = t.z;
      entry.rotation[0] = r.x;
      entry.rotation[1] = r.y;
      entry.rotation[2] = r.z;
      entry.rotation[3] = r.w;
      entry.linvel[0] = lv?.x ?? 0;
      entry.linvel[1] = lv?.y ?? 0;
      entry.linvel[2] = lv?.z ?? 0;
      entry.angvel[0] = av?.x ?? 0;
      entry.angvel[1] = av?.y ?? 0;
      entry.angvel[2] = av?.z ?? 0;
      entry.asleep = b.isSleeping?.() ?? false;
    });
    if (bodySnapshotEntries.size !== bodySnapshotHandles.length) {
      const staleHandles: number[] = [];
      bodySnapshotEntries.forEach((entry, handle) => {
        if (entry.version !== bodySnapshotVersion) {
          staleHandles.push(handle);
        }
      });
      for (let i = 0; i < staleHandles.length; i += 1) {
        bodySnapshotEntries.delete(staleHandles[i]);
      }
    }
    return reusableSnapshot;
  }
  function restoreBodySnapshot(snap: BodySnapshot | null) {
    if (!snap) return;
    const { handles, entries, version } = snap;
    for (let i = 0; i < handles.length; i += 1) {
      const handle = handles[i];
      const entry = entries.get(handle);
      if (!entry || entry.version !== version) continue;
      const body = world.getRigidBody(handle);
      if (!body) continue;
      try {
        reusableTranslation.x = entry.translation[0];
        reusableTranslation.y = entry.translation[1];
        reusableTranslation.z = entry.translation[2];
        body.setTranslation(reusableTranslation, true);
      } catch {}
      try {
        reusableRotation.x = entry.rotation[0];
        reusableRotation.y = entry.rotation[1];
        reusableRotation.z = entry.rotation[2];
        reusableRotation.w = entry.rotation[3];
        body.setRotation(reusableRotation, true);
      } catch {}
      try {
        reusableLinvel.x = entry.linvel[0];
        reusableLinvel.y = entry.linvel[1];
        reusableLinvel.z = entry.linvel[2];
        body.setLinvel(reusableLinvel, true);
      } catch {}
      try {
        reusableAngvel.x = entry.angvel[0];
        reusableAngvel.y = entry.angvel[1];
        reusableAngvel.z = entry.angvel[2];
        body.setAngvel(reusableAngvel, true);
      } catch {}
      try { if (entry.asleep) body.sleep(); else body.wakeUp(); } catch {}
    }
  }

  function step() {
    // Apply queued spawns up front
    applyPendingSpawns();

    const doResim = !!resimulateOnFracture && Math.max(0, maxResimulationPasses) > 0;
    const useWorldSnapshot = snapshotMode === 'world';

    // Snapshot pre-step state
    let bodySnap: BodySnapshot | null = null;
    let worldSnap: Uint8Array | null = null;
    if (doResim) {
      if (useWorldSnapshot) {
        try { worldSnap = world.takeSnapshot(); } catch (e) { console.warn('[Core] World.takeSnapshot failed; falling back to perBody', e); bodySnap = captureBodySnapshot(); }
      } else {
        bodySnap = captureBodySnapshot();
      }
    }

    // First pass
    clearBufferedContacts();
    // Defensive: keep collider mapping coherent
    if (colliderToNode.size === 0) {
      try { rebuildColliderToNodeFromChunks(); } catch {}
      if (colliderToNode.size === 0 && process.env.NODE_ENV !== 'production' && !warnedColliderMapEmptyOnce) {
        console.warn('[Core] colliderToNode is empty before event drain; contact forces will be dropped');
        warnedColliderMapEmptyOnce = true;
      }
    }
    preStepSweep();
    try { world.step(eventQueue); } catch (error) { console.error('world.step', error); return; }
    // Drain contacts: inject solver forces, buffer damage (no apply yet)
    drainContactForces({ injectSolverForces: true, applyDamage: false, recordForReplay: true });

    // Gravity and solver update for detection phase
    if (solverGravityEnabled) {
      try {
        const g = world.gravity as unknown as { x:number; y:number; z:number };
        solver.addGravity({ x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 });
      } catch {}
    }
    solver.update();

    const hasFracture = solver.overstressedBondCount() > 0;
    if (!doResim || !hasFracture) {
      // Accept first pass; apply buffered damage and external pushes, optionally queue immediate split
      replayBufferedContacts();
      const hadExternalForces = injectPendingExternalForces();
      if (hadExternalForces && process.env.NODE_ENV !== 'production') {
        try { ((window as unknown as { debugStressSolver?: { printSolver?: () => unknown } }).debugStressSolver)?.printSolver?.(); } catch {}
      }
      applyDamageTick();

      if (hasFracture) {
        try {
          const perActor = solver.generateFractureCommandsPerActor();
          const splitEvents = solver.applyFractureCommands(perActor) as Array<{ parentActorIndex:number; children:Array<{ actorIndex:number; nodes:number[] }> }> | undefined;
          if (Array.isArray(splitEvents) && splitEvents.length > 0) {
            queueSplitResults(splitEvents);
            applyPendingMigrations();
            removeDisabledHandles();
          }
        } catch (e) { console.error('[Core] applyFractureCommands', e); }
      }
      return;
    }

    // Rollback and resimulate (accepted pass)
    try {
      if (useWorldSnapshot && worldSnap) {
        const newWorld = RAPIER.World.restoreSnapshot(worldSnap);
        if (newWorld) {
          world = newWorld as unknown as RAPIER.World;
          try { if (corePublic) (corePublic as unknown as { world: RAPIER.World }).world = world; } catch {}
          try { onWorldReplaced?.(world); } catch {}
        }
      } else if (bodySnap) {
        restoreBodySnapshot(bodySnap);
      }
    } catch (e) {
      console.error('[Core] rollback failed; proceeding without resim', e);
      replayBufferedContacts();
      injectPendingExternalForces();
      applyDamageTick();
      return;
    }

    // Apply splits before accepted step
    try {
      const perActor = solver.generateFractureCommandsPerActor();
      const splitEvents = solver.applyFractureCommands(perActor) as Array<{ parentActorIndex:number; children:Array<{ actorIndex:number; nodes:number[] }> }> | undefined;
      if (Array.isArray(splitEvents) && splitEvents.length > 0) {
        queueSplitResults(splitEvents);
        applyPendingMigrations();
        removeDisabledHandles();
      }
    } catch (e) { console.error('[Core] applyFractureCommands (resim)', e); }

    // Accepted pass
    clearBufferedContacts();
    preStepSweep();
    try { world.step(eventQueue); } catch (e) { console.error('world.step (resim)', e); }
    drainContactForces({ injectSolverForces: true, applyDamage: true, recordForReplay: false });
    injectPendingExternalForces();
    if (solverGravityEnabled) {
      try {
        const g = world.gravity as unknown as { x:number; y:number; z:number };
        solver.addGravity({ x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 });
      } catch {}
    }
    solver.update();
    applyDamageTick();
  }

  // Back-compat aliases
  const stepEventful = step;
  const stepSafe = step;

  function queueSplitResults(splitEvents: Array<{ parentActorIndex:number; children:Array<{ actorIndex:number; nodes:number[] }> }>) {
    if (isDev) console.debug('[Core] queueSplitResults', splitEvents?.[0]?.children);
    for (const evt of splitEvents) {
      const parentActorIndex = evt?.parentActorIndex;
      const children = Array.isArray(evt?.children) ? evt.children : [];
      const parentEntry = actorMap.get(parentActorIndex);
      const parentBodyHandle = parentEntry?.bodyHandle ?? rootBody.handle;
      for (const child of children) {
        if (!child || !Array.isArray(child.nodes) || child.nodes.length === 0) continue;
        // Update ownership: all nodes listed now belong to this child actor
        for (const n of child.nodes) nodeToActor.set(n, child.actorIndex);
        const isActorSupport = actorNodesContainSupport(child.nodes);
        if (child.actorIndex === parentActorIndex) {
          // If the parent portion no longer contains supports, migrate it to a NEW dynamic body.
          if (!isActorSupport) {
            pendingBodiesToCreate.push({ actorIndex: child.actorIndex, inheritFromBodyHandle: parentBodyHandle, nodes: child.nodes.slice(), isSupport: false });
          }
          actorMap.set(child.actorIndex, { bodyHandle: parentBodyHandle });
          if (isDev) console.log('queueSplitResults(parent)', child.actorIndex, parentBodyHandle, isActorSupport);
          continue;
        }

        pendingBodiesToCreate.push({ actorIndex: child.actorIndex, inheritFromBodyHandle: parentBodyHandle, nodes: child.nodes.slice(), isSupport: isActorSupport });
        actorMap.set(child.actorIndex, { bodyHandle: parentBodyHandle });
      }
    }
  }

  function applyPendingSpawns() {
    if (pendingBallSpawns.length === 0) return;
    const list = pendingBallSpawns.splice(0, pendingBallSpawns.length);
    // if (process.env.NODE_ENV !== 'production') console.debug('[Core] applyPendingSpawns', { count: list.length });
    for (const s of list) spawnProjectile(s);
  }

  function spawnProjectile(params: ProjectileSpawn) {
    const start = params.start ?? { x: params.x, y: 8, z: params.z };
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, start.z)
      .setCanSleep(false)
      .setLinearDamping(0.0)
      .setAngularDamping(0.0)
      .setUserData({ projectile: true });
    try { (bodyDesc as unknown as { setCcdEnabled?: (v:boolean)=>unknown }).setCcdEnabled?.(true); } catch {}
    if (params.linvel) {
      bodyDesc.setLinvel(params.linvel.x, params.linvel.y, params.linvel.z);
    } else if (typeof params.linvelY === 'number') {
      bodyDesc.setLinvel(0, params.linvelY, 0);
    }
    const body = world.createRigidBody(bodyDesc);
    try { body.userData = { projectile: true }; } catch {}

    const shape = params.type === 'ball' ? RAPIER.ColliderDesc.ball(params.radius) : RAPIER.ColliderDesc.cuboid(params.radius, params.radius, params.radius);
    const collider = world.createCollider(
      shape
        .setMass(params.mass)
        .setFriction(params.friction)
        .setRestitution(params.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(0.0),
      body
    );
    // Apply collision-group policy for projectiles
    try { if (limitSinglesCollisionsEnabled) applyCollisionGroupsForBody(body, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}
    if (isDev) console.debug('[Core] spawnProjectile', { body: body.handle, collider: collider.handle, start, params });
    projectiles.push({ bodyHandle: body.handle, radius: params.radius, type: params.type });
  }

  function applyPendingMigrations() {
    // console.log('applyPendingMigrations', pendingBodiesToCreate.length, pendingColliderMigrations.length);

    // Create child bodies
    if (pendingBodiesToCreate.length > 0) {
      const list = pendingBodiesToCreate.splice(0, pendingBodiesToCreate.length);
      for (const pb of list) {
        const inherit = world.getRigidBody(pb.inheritFromBodyHandle);
        const desc = pb.isSupport ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
        if (inherit) {
          const pt = inherit.translation();
          const pq = inherit.rotation();
          const lv = inherit.linvel?.();
          desc.setTranslation(pt.x, pt.y, pt.z)
            .setRotation(pq)
            .setLinvel(lv?.x ?? 0, lv?.y ?? 0, lv?.z ?? 0)
            .setUserData({
              body: true,
              recreated: true,
            })
            ;
        }
        try { if (!pb.isSupport) (desc as unknown as { setCcdEnabled?: (v:boolean)=>unknown }).setCcdEnabled?.(true); } catch {}
        const body = world.createRigidBody(desc);
        actorMap.set(pb.actorIndex, { bodyHandle: body.handle });
        for (const nodeIndex of pb.nodes) pendingColliderMigrations.push({ nodeIndex, targetBodyHandle: body.handle });
      }
    }

    // Migrate colliders to new bodies
    if (pendingColliderMigrations.length > 0) {
      const jobs = pendingColliderMigrations.splice(0, pendingColliderMigrations.length);
      const createdCountByBody = new Map<number, number>();
      for (const mig of jobs) {
        const seg = chunks[mig.nodeIndex];
        if (!seg) continue;
        if (seg.colliderHandle != null) {
          const oldC = world.getCollider(seg.colliderHandle);
          if (oldC) oldC.setEnabled(false);
          colliderToNode.delete(seg.colliderHandle);
          disabledCollidersToRemove.add(seg.colliderHandle);
          seg.colliderHandle = null;
        }
        // Skip creating colliders for destroyed segments (standardized path)
        if (seg.destroyed) continue;
        const halfX = seg.size.x * 0.5;
        const halfY = seg.size.y * 0.5;
        const halfZ = seg.size.z * 0.5;
        const body = world.getRigidBody(mig.targetBodyHandle);
        if (!body) continue;

        const tx = seg.isSupport && seg.baseWorldPosition ? seg.baseWorldPosition.x : seg.baseLocalOffset.x;
        const ty = seg.isSupport && seg.baseWorldPosition ? seg.baseWorldPosition.y : seg.baseLocalOffset.y;
        const tz = seg.isSupport && seg.baseWorldPosition ? seg.baseWorldPosition.z : seg.baseLocalOffset.z;

        const node = scenario.nodes[mig.nodeIndex];
        const nodeMass = node.mass ?? 1;
        // const isSupport = nodeMass === 0;

        const desc = buildColliderDescForNode({ nodeIndex: mig.nodeIndex, halfX, halfY, halfZ, isSupport: seg.isSupport })
          .setMass(nodeMass)
          .setTranslation(tx, ty, tz)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(0.0)
          .setFriction(0.25)
          .setRestitution(0.0);
        const col = world.createCollider(desc, body);
        seg.bodyHandle = body.handle;
        seg.colliderHandle = col.handle;
        seg.detached = true;
        colliderToNode.set(col.handle, seg.nodeIndex);
        createdCountByBody.set(body.handle, (createdCountByBody.get(body.handle) ?? 0) + 1);
        // Update groups after migration; collider count may be 1
        try { if (limitSinglesCollisionsEnabled) applyCollisionGroupsForBody(body, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}
      }
      // Do not proactively remove bodies here; allow existing sweeps to handle
    }
  }

  function removeDisabledHandles() {
    for (const h of Array.from(disabledCollidersToRemove)) {
      const c = world.getCollider(h);
      if (c) world.removeCollider(c, false);
      disabledCollidersToRemove.delete(h);
    }
    for (const bh of Array.from(bodiesToRemove)) {
      const b = world.getRigidBody(bh);
      if (b) world.removeRigidBody(b);
      bodiesToRemove.delete(bh);
    }
  }

  const colliderSweepScratch: number[] = [];
  function preStepSweep() {
    if (colliderToNode.size === 0) return;
    colliderSweepScratch.length = 0;
    colliderToNode.forEach((_, handle) => {
      if (!world.getCollider(handle)) {
        colliderSweepScratch.push(handle);
      }
    });
    if (colliderSweepScratch.length === 0) return;
    for (let i = 0; i < colliderSweepScratch.length; i += 1) {
      colliderToNode.delete(colliderSweepScratch[i]);
    }
  }

  function getSolverDebugLines() {
    const lines = solver.fillDebugRender({ mode: runtime.ExtDebugMode.Max, scale: 1.0 }) || [];
    return lines as Array<{ p0: Vec3; p1: Vec3; color0: number; color1: number }>;
  }

  function applyExternalForce(nodeIndex: number, worldPoint: Vec3, worldForce: Vec3) {
    pendingExternalForces.push({ nodeIndex, point: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z }, force: { x: worldForce.x, y: worldForce.y, z: worldForce.z } });
    safeFrames = Math.max(safeFrames, 1);
  }

  function getNodeBonds(nodeIndex: number): BondRef[] {
    const indices = bondsByNode.get(nodeIndex) ?? [];
    const out: BondRef[] = [];
    for (const bi of indices) {
      if (removedBondIndices.has(bi)) continue;
      const b = bondTable[bi];
      if (!b) continue;
      out.push({ index: b.index, node0: b.node0, node1: b.node1, area: b.area, centroid: b.centroid, normal: b.normal });
    }
    return out;
  }

  function cutBond(bondIndex: number): boolean {
    if (removedBondIndices.has(bondIndex)) return false;
    const b = bondTable[bondIndex];
    if (!b) return false;
    // Map node -> actorIndex from live solver view
    let actorIndexA: number | undefined;
    let actorIndexB: number | undefined;
    try {
      const actors = (solver as unknown as { actors: () => Array<{ actorIndex:number; nodes:number[] }> }).actors?.() ?? [];
      const nodeToActor = new Map<number, number>();
      for (const a of actors) {
        for (const n of a.nodes ?? []) nodeToActor.set(n, a.actorIndex);
      }
      actorIndexA = nodeToActor.get(b.node0);
      actorIndexB = nodeToActor.get(b.node1);
    } catch {}
    if (actorIndexA == null || actorIndexB == null || actorIndexA !== actorIndexB) {
      // If endpoints aren’t in same actor, either already split or invalid
      removedBondIndices.add(bondIndex);
      return false;
    }
    const fractureSets = [{ actorIndex: actorIndexA, fractures: [{ userdata: bondIndex, nodeIndex0: b.node0, nodeIndex1: b.node1, health: 1e9 }] }];
    let applied = false;
    try {
      const splitEvents = solver.applyFractureCommands(fractureSets as unknown as Array<{ actorIndex:number; fractures:Array<{ userdata:number; nodeIndex0:number; nodeIndex1:number; health:number }> }>);
      removedBondIndices.add(bondIndex);
      if (Array.isArray(splitEvents) && splitEvents.length > 0) {
        queueSplitResults(splitEvents as Array<{ parentActorIndex:number; children:Array<{ actorIndex:number; nodes:number[] }> }>);
        safeFrames = Math.max(safeFrames, 2);
      }
      applied = true;
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[Core] cutBond failed', bondIndex, e);
    }
    return applied;
  }

  function cutNodeBonds(nodeIndex: number): boolean {
    const bonds = getNodeBonds(nodeIndex);
    if (bonds.length === 0) return false;
    let any = false;
    for (const br of bonds) any = cutBond(br.index) || any;
    return any;
  }

  function dispose() {
    try { solver.destroy?.(); } catch {}
  }

  function handleNodeDestroyed(nodeIndex: number, reason: 'impact'|'manual') {
    const seg = chunks[nodeIndex];
    if (!seg) return;
    // Ensure flags
    seg.destroyed = true;
    if (seg.health != null) seg.health = 0;

    // Detach bonds in solver
    if (damageOptions.autoDetachOnDestroy) {
      try { cutNodeBonds(nodeIndex); } catch {}
    }

    // Cleanup physics collider and possibly body
    if (damageOptions.autoCleanupPhysics) {
      try {
        // Disable/remove collider (let existing cleanup pass remove it); DO NOT remove bodies here
        if (seg.colliderHandle != null) {
          const oldC = world.getCollider(seg.colliderHandle);
          if (oldC) oldC.setEnabled(false);
          colliderToNode.delete(seg.colliderHandle);
          disabledCollidersToRemove.add(seg.colliderHandle);
          seg.colliderHandle = null;
        }
      } catch (e) {
        if (isDev) console.warn('[Core] cleanup on destroy failed', e);
      }
    }

    // Notify
    try {
      const { actorIndex } = actorBodyForNode(nodeIndex);
      onNodeDestroyed?.({ nodeIndex, actorIndex, reason });
    } catch {}

    // Step safely for a couple frames
    safeFrames = Math.max(safeFrames, 2);
  }

  let corePublic: DestructibleCore | null = null;
  const api: DestructibleCore = {
    world,
    eventQueue,
    solver,
    runtime,
    rootBodyHandle: rootBody.handle,
    groundBodyHandle: groundBody.handle,
    gravity,
    chunks,
    colliderToNode,
    actorMap,
    step,
    projectiles,
    enqueueProjectile,
    stepEventful,
    stepSafe,
    setGravity,
    setSolverGravityEnabled,
    setLimitSinglesCollisions: (v: boolean) => {
      limitSinglesCollisionsEnabled = !!v;
      try {
        world.forEachRigidBody((b) => applyCollisionGroupsForBody(b, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }));
      } catch {
        try { applyCollisionGroupsForBody(rootBody, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}
        try { applyCollisionGroupsForBody(groundBody, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}
        for (const { bodyHandle } of Array.from(actorMap.values())) {
          const b = world.getRigidBody(bodyHandle);
          if (b) applyCollisionGroupsForBody(b, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle });
        }
      }
    },
    getSolverDebugLines,
    getNodeBonds,
    cutBond,
    cutNodeBonds,
    applyExternalForce,
    // Damage API
    applyNodeDamage: damageSystem.isEnabled() ? (nodeIndex: number, amount: number) => { try { damageSystem.applyDirect(nodeIndex, amount); } catch {} } : undefined,
    getNodeHealth: damageSystem.isEnabled() ? (nodeIndex: number) => {
      try { return damageSystem.getHealth(nodeIndex); } catch { return null; }
    } : undefined,
    damageEnabled: damageSystem.isEnabled(),
    dispose,
  };
  corePublic = api;
  return api;
}

type Quat = { x:number; y:number; z:number; w:number };
function applyQuatToVec3(v: Vec3, q: Quat, out: MutableVec3): MutableVec3 {
  // Minimal quaternion-vector rotation without importing Three in core
  const x = v.x, y = v.y, z = v.z;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  // quat * vec
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  // result * conj(quat)
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

// --- Collision-group helpers (moved below for clarity) ---
const GROUP_GROUND = 1 << 0;
const GROUP_SINGLE = 1 << 1;
const GROUP_MULTI = 1 << 2;
const mkGroups = (memberships: number, filter: number) => (((memberships & 0xffff) << 16) | (filter & 0xffff));

function applyGroupsForCollider(c: RAPIER.Collider, groups: number) {
  try {
    c.setCollisionGroups(groups as unknown as number);
    c.setSolverGroups(groups as unknown as number);
  } catch {}
}

function applyCollisionGroupsForBody(body: RAPIER.RigidBody, opts: { enabled: boolean; groundBodyHandle: number }) {
  if (!body) return;
  const n = body?.numColliders() || 0;
  let groups = mkGroups(0xffff, 0xffff);
  const ud = (body as unknown as { userData?: unknown }).userData as { projectile?: boolean } | undefined;
  if (ud?.projectile) {
    groups = mkGroups(0xffff, 0xffff);
  } else if (opts.enabled) {
    if (body.handle === opts.groundBodyHandle) {
      groups = mkGroups(GROUP_GROUND, GROUP_GROUND | GROUP_SINGLE | GROUP_MULTI);
    } else {
      const isDynamicLike = body.isDynamic() || body.isKinematic();
      if (isDynamicLike && n === 1) {
        groups = mkGroups(GROUP_SINGLE, GROUP_GROUND | GROUP_MULTI);
      } else {
        groups = mkGroups(GROUP_MULTI, GROUP_GROUND | GROUP_MULTI | GROUP_SINGLE);
      }
    }
  }
  for (let i = 0; i < n; i += 1) {
    try {
      const col = body.collider(i);
      if (col) applyGroupsForCollider(col, groups);
    } catch {}
  }
}


