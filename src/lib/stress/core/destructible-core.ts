import RAPIER from '@dimforge/rapier3d-compat';
import { loadStressSolver } from 'blast-stress-solver';
import type { DestructibleCore, ScenarioDesc, ChunkData, Vec3, ProjectileSpawn, BondRef } from './types';

type BuildCoreOptions = {
  scenario: ScenarioDesc;
  // Collider sizing strategy for nodes → Box colliders
  nodeSize: (nodeIndex: number, scenario: ScenarioDesc) => Vec3; // full extents
  gravity?: number;
  friction?: number;
  restitution?: number;
  materialScale?: number;
  limitSinglesCollisions?: boolean;
  applyExcessForces?: boolean;
};

const isDev = true; //process.env.NODE_ENV !== 'production';

export async function buildDestructibleCore({
  scenario,
  nodeSize,
  gravity = -9.81,
  friction = 0.25,
  restitution = 0.0,
  materialScale = 1.0,
  limitSinglesCollisions = false,
  applyExcessForces = false,
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

  const world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
  const eventQueue = new RAPIER.EventQueue(true);

  // Root fixed body
  const rootBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));

  // Ground collider (fixed body), wide plane with top aligned to y=0
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(100, 0.025, 100)
      .setTranslation(0, -0.025, 0)
      .setFriction(0.9),
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
      console.debug('[Core] Built chunk colliders', {
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
  const pendingActorExcessForces = new Map<number, Array<{ force: Vec3; torque: Vec3 }>>();

  let safeFrames = 0;
  let warnedColliderMapEmptyOnce = false;
  let solverGravityEnabled = true;
  let limitSinglesCollisionsEnabled = !!limitSinglesCollisions;
  let applyExcessForcesEnabled = !!applyExcessForces;

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

  function computeActorLocalCenter(nodesList: number[]): Vec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let weightSum = 0;
    for (const nodeIndex of nodesList) {
      const chunk = chunks[nodeIndex];
      if (!chunk) continue;
      const nodeMass = scenario.nodes[nodeIndex]?.mass ?? 1;
      const weight = nodeMass > 0 ? nodeMass : 1;
      sx += chunk.baseLocalOffset.x * weight;
      sy += chunk.baseLocalOffset.y * weight;
      sz += chunk.baseLocalOffset.z * weight;
      weightSum += weight;
    }
    if (weightSum <= 0) {
      const fallback = nodesList.length > 0 ? chunks[nodesList[0]] : null;
      if (fallback) return { x: fallback.baseLocalOffset.x, y: fallback.baseLocalOffset.y, z: fallback.baseLocalOffset.z };
      return { x: 0, y: 0, z: 0 };
    }
    return { x: sx / weightSum, y: sy / weightSum, z: sz / weightSum };
  }

  const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

  function isFiniteVec3(v?: Vec3 | null) {
    if (!v) return false;
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }

  function isVectorNearlyZero(v: Vec3) {
    return Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) < 1e-5;
  }

  function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
    return applyQuatToVec3(v, q);
  }

  function queueActorExcessForce(actorIndex: number, force: Vec3, torque: Vec3) {
    if (!applyExcessForcesEnabled) return;
    if (!isFiniteVec3(force) && !isFiniteVec3(torque)) return;
    const f = isFiniteVec3(force) ? force : { x: 0, y: 0, z: 0 };
    const t = isFiniteVec3(torque) ? torque : { x: 0, y: 0, z: 0 };
    if (isVectorNearlyZero(f) && isVectorNearlyZero(t)) return;
    const existing = pendingActorExcessForces.get(actorIndex) ?? [];
    existing.push({ force: { x: f.x, y: f.y, z: f.z }, torque: { x: t.x, y: t.y, z: t.z } });
    pendingActorExcessForces.set(actorIndex, existing);
  }

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
    if (process.env.NODE_ENV !== 'production') console.debug('[Core] enqueueProjectile', s);
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
    const qInv = { x: -br.x, y: -br.y, z: -br.z, w: br.w };

    const fWorld = { x: (totalForce.x ?? 0) * direction, y: (totalForce.y ?? 0) * direction, z: (totalForce.z ?? 0) * direction };
    const pRel = { x: (worldPoint.x ?? 0) - (bt.x ?? 0), y: (worldPoint.y ?? 0) - (bt.y ?? 0), z: (worldPoint.z ?? 0) - (bt.z ?? 0) };

    const localForce = applyQuatToVec3(fWorld, qInv);
    const localPoint = applyQuatToVec3(pRel, qInv);

    solver.addForce(
      nodeIndex,
      { x: localPoint.x, y: localPoint.y, z: localPoint.z },
      // undefined,
      { x: localForce.x, y: localForce.y, z: localForce.z },
      // undefined,
      runtime.ExtForceMode.Force
    );
  }

  function stepEventful() {
    // Defensive: if mapping is empty (e.g., over-pruned by a prior sweep), rebuild from chunks
    if (colliderToNode.size === 0) {
      try { rebuildColliderToNodeFromChunks(); } catch {}
      if (colliderToNode.size === 0 && process.env.NODE_ENV !== 'production' && !warnedColliderMapEmptyOnce) {
        console.warn('[Core] colliderToNode is empty before event drain; contact forces will be dropped');
        warnedColliderMapEmptyOnce = true;
      }
    }
    preStepSweep();
    try {
      world.step(eventQueue);
    } catch {
      // On error, switch to a safe step next frame
      safeFrames = Math.max(safeFrames, 1);
      return;
    }

    // Drain contact forces → solver
    eventQueue.drainContactForceEvents((ev: { totalForce: () => {x:number;y:number;z:number}; totalForceMagnitude: () => number; collider1: () => number; collider2: () => number; worldContactPoint?: () => {x:number;y:number;z:number}; worldContactPoint2?: () => {x:number;y:number;z:number} }) => {
      const tf = ev.totalForce?.();
      const mag = ev.totalForceMagnitude?.();
      if (!tf || !(mag > 0)) {
        console.log('drainContactForceEvents', ev, tf, mag);
        return;
      }

      const h1 = ev.collider1?.();
      const h2 = ev.collider2?.();
      const wp = ev.worldContactPoint ? ev.worldContactPoint() : undefined;
      const wp2 = ev.worldContactPoint2 ? ev.worldContactPoint2() : undefined;
      const p1 = wp ?? wp2 ?? fallbackPoint(world, h1);
      const p2 = wp2 ?? wp ?? fallbackPoint(world, h2);

      // Get optional nodes for each collider
      const node1 = colliderToNode.has(h1) ? colliderToNode.get(h1) : undefined;
      const node2 = colliderToNode.has(h2) ? colliderToNode.get(h2) : undefined;
 
      // console.log('drainContactForceEvents', ev, h1, h2, p1, p2, node1, node2);
    
      // only inject EXTERNAL loads: exactly one side is bridge
      // if (isBridge1 && !isBridge2) {
      //   const p = ev.worldContactPoint?.() ?? ev.worldContactPoint2?.() ?? fallbackPoint(state.world, h1);
      //   add(h1, +1, tf, p);     // always +1; we are adding an external load
      // } else if (isBridge2 && !isBridge1) {
      //   const p = ev.worldContactPoint2?.() ?? ev.worldContactPoint?.() ?? fallbackPoint(state.world, h2);
      //   add(h2, +1, tf, p);
      // }

      if (h1 != null) {
        if (node1 != null && node2 == null) {
          addForceForCollider(h1, +1, tf, p1 ?? p2);
        }
      } else {
        console.warn('drainContactForceEvents', ev, 'h1 is null');
      }
      if (h2 != null) {
        if (node2 != null && node1 == null) {
          addForceForCollider(h2, -1, tf, p2 ?? p1);
        }
      } else {
        console.warn('drainContactForceEvents', ev, 'h2 is null');
      }
    });

    // Inject external (non-contact) forces into solver at node space (single-frame)
    const hasExternalForces = pendingExternalForces.length > 0;
    if (hasExternalForces) {
      try {
        const dt = (world as unknown as { timestep?: number; integrationParameters?: { dt?: number } }).timestep
          ?? (world as unknown as { integrationParameters?: { dt?: number } }).integrationParameters?.dt
          ?? (1 / 60);
        for (const ef of pendingExternalForces) {
          const { body } = actorBodyForNode(ef.nodeIndex);
          const rb = body ?? world.getRigidBody(rootBody.handle);
          if (!rb) {
            console.warn('addForceForCollider', 'body is null', ef.nodeIndex);
            continue;
          }

          const t = rb.translation();
          const r = rb.rotation();
          const qInv = { x: -r.x, y: -r.y, z: -r.z, w: r.w };

          const pRel = { x: ef.point.x - t.x, y: ef.point.y - t.y, z: ef.point.z - t.z };
          const localPoint = applyQuatToVec3(pRel, qInv);
          // Scale by dt so effect is one-shot and not frame-rate dependent
          const scaledForce = { x: ef.force.x * dt, y: ef.force.y * dt, z: ef.force.z * dt };
          const localForce = applyQuatToVec3(scaledForce, qInv);

          solver.addForce(
            ef.nodeIndex,
            { x: localPoint.x, y: localPoint.y, z: localPoint.z },
            { x: localForce.x, y: localForce.y, z: localForce.z },
            runtime.ExtForceMode.Force
          );
        }
      } catch (e) {
        if (isDev) console.error('[Core] addForceForCollider failed', e);
      } finally {
        // Clear queue after injection
        pendingExternalForces.splice(0, pendingExternalForces.length);
      }
    }

    // Gravity and solver update
    if (solverGravityEnabled) {
      try {
        const g = world.gravity as unknown as { x:number; y:number; z:number };
        const g2 = { x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 };
        // console.log('addGravity', g2);
        solver.addGravity(g2);
      } catch {}
    }
    solver.update();
    if (hasExternalForces && process.env.NODE_ENV !== 'production') {
      try { ((window as unknown as { debugStressSolver?: { printSolver?: () => unknown } }).debugStressSolver)?.printSolver?.(); } catch {}
    }

    if (solver.overstressedBondCount() > 0) {
      const perActor = solver.generateFractureCommandsPerActor();
      const splitEvents = solver.applyFractureCommands(perActor);
      // console.log('applyFractureCommands', solver.overstressedBondCount(), perActor.length, perActor[0]?.fractures?.length, perActor[0]?.fractures, splitEvents);
      if (Array.isArray(splitEvents) && splitEvents.length > 0) {
        queueSplitResults(splitEvents);
        safeFrames = Math.max(safeFrames, 2);
      }
    }
  }

  function stepSafe() {
    try { world.step(); } catch {}
    // Drain any queued external forces even in safe mode
    if (pendingExternalForces.length > 0) {
      try {
        const dt = (world as unknown as { timestep?: number; integrationParameters?: { dt?: number } }).timestep
          ?? (world as unknown as { integrationParameters?: { dt?: number } }).integrationParameters?.dt
          ?? (1 / 60);
        for (const ef of pendingExternalForces) {
          const { body } = actorBodyForNode(ef.nodeIndex);
          const rb = body ?? world.getRigidBody(rootBody.handle);
          if (!rb) continue;
          const t = rb.translation();
          const r = rb.rotation();
          const qInv = { x: -r.x, y: -r.y, z: -r.z, w: r.w };
          const pRel = { x: ef.point.x - t.x, y: ef.point.y - t.y, z: ef.point.z - t.z };
          const localPoint = applyQuatToVec3(pRel, qInv);
          const scaledForce = { x: ef.force.x * dt, y: ef.force.y * dt, z: ef.force.z * dt };
          const localForce = applyQuatToVec3(scaledForce, qInv);
          solver.addForce(
            ef.nodeIndex,
            { x: localPoint.x, y: localPoint.y, z: localPoint.z },
            { x: localForce.x, y: localForce.y, z: localForce.z },
            runtime.ExtForceMode.Force
          );
        }
      } catch {}
      pendingExternalForces.splice(0, pendingExternalForces.length);
    }
    applyPendingSpawns();
    applyPendingMigrations();
    removeDisabledHandles();
    if (safeFrames > 0) safeFrames -= 1;
  }

  function step() {
    if (safeFrames > 0) stepSafe(); else stepEventful();
  }

  function queueSplitResults(splitEvents: Array<{ parentActorIndex:number; children:Array<{ actorIndex:number; nodes:number[] }> }>) {
    console.debug('[Core] queueSplitResults', splitEvents?.[0]?.children);
    for (const evt of splitEvents) {
      const parentActorIndex = evt?.parentActorIndex;
      const children = Array.isArray(evt?.children) ? evt.children : [];
      const parentEntry = actorMap.get(parentActorIndex);
      const parentBodyHandle = parentEntry?.bodyHandle ?? rootBody.handle;
      const parentBody = world.getRigidBody(parentBodyHandle);
      const parentBodyRotation = parentBody?.rotation();
      const parentRotation = parentBodyRotation
        ? ({ x: parentBodyRotation.x, y: parentBodyRotation.y, z: parentBodyRotation.z, w: parentBodyRotation.w } as Quat)
        : IDENTITY_QUAT;
      for (const child of children) {
        if (!child || !Array.isArray(child.nodes) || child.nodes.length === 0) continue;
        // Update ownership: all nodes listed now belong to this child actor
        for (const n of child.nodes) nodeToActor.set(n, child.actorIndex);
        const isActorSupport = actorNodesContainSupport(child.nodes);
        if (applyExcessForcesEnabled) {
          try {
            const localCenter = computeActorLocalCenter(child.nodes);
            const excess = solver.getExcessForces(child.actorIndex, localCenter);
            if (excess) {
              const worldForce = rotateVecByQuat(excess.force ?? { x: 0, y: 0, z: 0 }, parentRotation);
              const worldTorque = rotateVecByQuat(excess.torque ?? { x: 0, y: 0, z: 0 }, parentRotation);
              queueActorExcessForce(child.actorIndex, worldForce, worldTorque);
            }
          } catch (err) {
            if (isDev) console.warn('[Core] Failed to queue excess force', err);
          }
        }
        if (child.actorIndex === parentActorIndex) {
          // If the parent portion no longer contains supports, migrate it to a NEW dynamic body.
          if (!isActorSupport) {
            pendingBodiesToCreate.push({ actorIndex: child.actorIndex, inheritFromBodyHandle: parentBodyHandle, nodes: child.nodes.slice(), isSupport: false });
          }
          actorMap.set(child.actorIndex, { bodyHandle: parentBodyHandle });
          console.log('queueSplitResults(parent)', child.actorIndex, parentBodyHandle, isActorSupport);
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
    if (process.env.NODE_ENV !== 'production') console.debug('[Core] applyPendingSpawns', { count: list.length });
    for (const s of list) spawnProjectile(s);
  }

  function spawnProjectile(params: ProjectileSpawn) {
    const start = params.start ?? { x: params.x, y: 8, z: params.z };
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(start.x, start.y, start.z)
      .setCanSleep(false)
      .setLinearDamping(0.0)
      .setAngularDamping(0.0);
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
    if (process.env.NODE_ENV !== 'production') console.debug('[Core] spawnProjectile', { body: body.handle, collider: collider.handle, start, params });
    projectiles.push({ bodyHandle: body.handle, radius: params.radius, type: params.type });
  }

  function applyPendingMigrations() {
    console.log('applyPendingMigrations', pendingBodiesToCreate.length, pendingColliderMigrations.length);

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
            .setLinvel(lv?.x ?? 0, lv?.y ?? 0, lv?.z ?? 0);
        }
        const body = world.createRigidBody(desc);
        actorMap.set(pb.actorIndex, { bodyHandle: body.handle });
        for (const nodeIndex of pb.nodes) pendingColliderMigrations.push({ nodeIndex, targetBodyHandle: body.handle });
      }
    }

    // Migrate colliders to new bodies
    if (pendingColliderMigrations.length > 0) {
      const jobs = pendingColliderMigrations.splice(0, pendingColliderMigrations.length);
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
        // Update groups after migration; collider count may be 1
        try { if (limitSinglesCollisionsEnabled) applyCollisionGroupsForBody(body, { enabled: limitSinglesCollisionsEnabled, groundBodyHandle: groundBody.handle }); } catch {}
      }
    }
    applyPendingExcessForces();
  }

  function applyPendingExcessForces() {
    if (!applyExcessForcesEnabled) {
      pendingActorExcessForces.clear();
      return;
    }
    if (pendingActorExcessForces.size === 0) return;
    for (const [actorIndex, entries] of Array.from(pendingActorExcessForces.entries())) {
      const actorEntry = actorMap.get(actorIndex);
      if (!actorEntry) {
        pendingActorExcessForces.delete(actorIndex);
        continue;
      }
      const body = world.getRigidBody(actorEntry.bodyHandle);
      if (!body) continue;
      for (const entry of entries) {
        if (isFiniteVec3(entry.force) && !isVectorNearlyZero(entry.force)) {
          try { body.applyImpulse({ x: entry.force.x, y: entry.force.y, z: entry.force.z }, true); } catch {}
        }
        if (isFiniteVec3(entry.torque) && !isVectorNearlyZero(entry.torque)) {
          try { body.applyTorqueImpulse({ x: entry.torque.x, y: entry.torque.y, z: entry.torque.z }, true); } catch {}
        }
      }
      pendingActorExcessForces.delete(actorIndex);
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

  function preStepSweep() {
    // Cull invalid collider → node mappings only when collider truly no longer exists
    for (const [h] of Array.from(colliderToNode.entries())) {
      const c = world.getCollider(h);
      if (!c) {
        colliderToNode.delete(h);
      }
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

  return {
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
    setApplyExcessForces: (v: boolean) => {
      applyExcessForcesEnabled = !!v;
      if (!applyExcessForcesEnabled) pendingActorExcessForces.clear();
    },
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
    dispose,
  };
}

function fallbackPoint(world: RAPIER.World, handle?: number) {
  if (handle == null) return { x: 0, y: 0, z: 0 };
  const c = world.getCollider(handle);
  const parentHandle = c ? c.parent() : undefined;
  const b = typeof parentHandle === 'number' ? world.getRigidBody(parentHandle) : undefined;
  if (b) {
    const t = b.translation();
    return { x: t.x ?? 0, y: t.y ?? 0, z: t.z ?? 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

type Quat = { x:number; y:number; z:number; w:number };
function applyQuatToVec3(v: Vec3, q: Quat): Vec3 {
  // Minimal quaternion-vector rotation without importing Three in core
  const x = v.x, y = v.y, z = v.z;
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  // quat * vec
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  // result * conj(quat)
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
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


