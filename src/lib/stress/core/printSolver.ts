// import * as THREE from 'three';
import { ExtDebugMode } from 'blast-stress-solver';
import type { ExtStressSolver, StressRuntime } from 'blast-stress-solver';

// Allow optional global state (used by world hierarchy helpers in dev)
declare const state: any;

type ColliderInfo = {
  handle: number;
  name?: string;
  parentBodyHandle?: number;
  segmentIndex?: number;
  nodeIndex?: number;
  isNew?: boolean;
  wasMoved?: boolean;
  prevParentHandle?: number | null;
  prevParentName?: string | null;
  oldHandle?: number | null;
};

/**
 * Captures current world state for delta tracking.
 * Called before any migrations to establish a baseline for comparison.
 */
function captureWorldSnapshot() {
  const { world, bodyMetadata, colliderMetadata } = state;
  
  const bodies = new Map();
  const colliders = new Map();
  const collidersByStableId = new Map(); // Track by segment index for stable identity
  
  // Capture current state of all bodies
  world.forEachRigidBody((body: any) => {
    const handle = body.handle;
    const meta = bodyMetadata.get(handle);
    const bodyColliders = [];
    
    // Find all colliders attached to this body
    for (let i = 0; i < body.numColliders(); i++) {
      const cHandle = body.collider(i)?.handle;
      if (cHandle != null) bodyColliders.push(cHandle);
    }
    
    bodies.set(handle, {
      handle,
      name: meta?.name,
      actorIndex: meta?.actorIndex,
      colliders: bodyColliders
    });
  });
  
  // Capture current state of all colliders
  world.forEachCollider((col: any) => {
    const handle = col.handle;
    const meta = colliderMetadata.get(handle);
    const parentHandle = col.parent();
    
    const info = {
      handle,
      name: meta?.name,
      parentBodyHandle: parentHandle,
      segmentIndex: meta?.segmentIndex,
      nodeIndex: meta?.nodeIndex
    };
    
    colliders.set(handle, info);
    
    // Also index by stable ID (segment index) for tracking across handle changes
    if (meta?.segmentIndex != null) {
      collidersByStableId.set(`segment-${meta.segmentIndex}`, info);
    }
  });
  
  state.previousWorldState = { bodies, colliders, collidersByStableId };
}

/**
 * Prints complete world hierarchy with delta tracking.
 * 
 * Shows:
 * - All rigid bodies with their metadata (name, type, actor index, position, velocity)
 * - All colliders attached to each body with stable names
 * - Delta indicators: NEW (just created), MOVED (changed parent), recreated (new handle)
 * - Summary statistics
 * 
 * Example output after a bridge split:
 * 
 * 🌍 WORLD HIERARCHY AFTER MIGRATIONS
 * 
 * 📖 LEGEND:
 *   Bodies:    🏛️ = Root (fixed)  |  📦 = Dynamic  |  🔒 = Fixed
 *   Status:    ✨ NEW = Just created  |  ✅ = Existed before  |  🔄 MOVED = Changed parent
 *   Handles:   "(recreated, old handle: N)" = Collider was destroyed and recreated
 * 
 * 📦 RIGID BODIES:
 * 
 *   🏛️ ✅ Bridge-Root-Fixed (Handle: 0)
 *   ├─ Type: Fixed
 *   ├─ Actor Index: 0
 *   ├─ Translation: (0.00, 0.50, 0.00)
 *   └─ Colliders: 20 total (0 added, 20 retained)
 *      ├─ ✅ Segment-0 (Handle: 1)
 *      │  ├─ Segment Index: 0
 *      │  ├─ Node Index: 0
 *      │  └─ Parent Body: Bridge-Root-Fixed
 *      ...
 * 
 *   📦 ✨ NEW Bridge-Actor1-Body1 [Seg25,Seg26,...,Seg31] (Handle: 5)
 *   ├─ Type: Dynamic
 *   ├─ Actor Index: 1
 *   ├─ Translation: (8.53, 0.48, 0.00)
 *   ├─ Linear Velocity: (0.12, -0.03, 0.00)
 *   ├─ Angular Velocity: (0.00, 0.00, 0.01)
 *   └─ Colliders: 7 total (7 added, 0 retained)
 *      ├─ 🔄 MOVED from Bridge-Root-Fixed Segment-25 (Handle: 39, recreated, old handle: 26)
 *      │  ├─ Segment Index: 25
 *      │  ├─ Node Index: 25
 *      │  └─ Parent Body: Bridge-Actor1-Body1 [Seg25,Seg26,...,Seg31]
 *      ...
 * 
 * 📊 SUMMARY:
 * ├─ Total Actors: 2
 * ├─ Rigid Bodies: 2 (1 new)
 * ├─ Colliders: 32
 * ├─   New Colliders: 0
 * ├─   Moved Colliders: 7
 * └─ Removed Bodies: 0
 */
function printWorldHierarchy() {
  const { world, actorMap, bodyMetadata, colliderMetadata, previousWorldState } = state;
  
  console.group('🌍 WORLD HIERARCHY AFTER MIGRATIONS');
  
  // Print legend
  console.log('\n📖 LEGEND:');
  console.log('  Bodies:    🏛️ = Root (fixed)  |  📦 = Dynamic  |  🔒 = Fixed');
  console.log('  Status:    ✨ NEW = Just created  |  ✅ = Existed before  |  🔄 MOVED = Changed parent');
  console.log('  Handles:   "(recreated, old handle: N)" = Collider was destroyed and recreated');
  console.log('');
  
  // Build current state maps
  const currentBodies = new Map<number, { handle:number; name:string; actorIndex?:number; isNew:boolean; body:any }>();
  const currentColliders = new Map<number, ColliderInfo>();
  const bodyToColliders = new Map<number, ColliderInfo[]>();
  
  // Scan current world state
  world.forEachRigidBody((body: any) => {
    const handle = body.handle;
    const meta = bodyMetadata.get(handle);
    const wasPresent = previousWorldState.bodies.has(handle);
    
    currentBodies.set(handle, {
      handle,
      name: meta?.name ?? `Body-${handle}`,
      actorIndex: meta?.actorIndex,
      isNew: !wasPresent,
      body
    });
    
    bodyToColliders.set(handle, [] as ColliderInfo[]);
  });
  
  world.forEachCollider((col: any) => {
    const handle = col.handle;
    const meta = colliderMetadata.get(handle);
    const parentHandle = col.parent();
    
    // Check by handle first (for balls and other non-segment colliders)
    let prevState = previousWorldState.colliders.get(handle);
    
    // For segment colliders, also check by stable ID to track across handle changes
    if (!prevState && meta?.segmentIndex != null) {
      prevState = previousWorldState.collidersByStableId?.get(`segment-${meta.segmentIndex}`);
    }
    
    const wasPresent = prevState != null;
    const wasMoved = wasPresent && prevState.parentBodyHandle !== parentHandle;
    const isNew = !wasPresent;
    
    const colliderInfo = {
      handle,
      name: meta?.name ?? `Collider-${handle}`,
      parentBodyHandle: parentHandle,
      segmentIndex: meta?.segmentIndex,
      nodeIndex: meta?.nodeIndex,
      isNew,
      wasMoved,
      prevParentHandle: wasMoved ? prevState.parentBodyHandle : null,
      prevParentName: null, // will fill below
      oldHandle: prevState?.handle !== handle ? prevState?.handle : null
    };
    
    currentColliders.set(handle, colliderInfo);
    
    if (parentHandle != null) {
      if (!bodyToColliders.has(parentHandle)) {
        bodyToColliders.set(parentHandle, [] as ColliderInfo[]);
      }
      const arr = bodyToColliders.get(parentHandle);
      if (arr) arr.push(colliderInfo as ColliderInfo);
    }
  });
  
  // Fill in previous parent names for moved colliders
  currentColliders.forEach((cInfo) => {
    if (cInfo.wasMoved && cInfo.prevParentHandle != null) {
      const prevBody = previousWorldState.bodies.get(cInfo.prevParentHandle);
      cInfo.prevParentName = prevBody?.name ?? `Body-${cInfo.prevParentHandle}`;
    }
  });
  
  // Print each body with delta indicators
  console.log('\n📦 RIGID BODIES:\n');
  
  currentBodies.forEach((bInfo) => {
    const { handle, name, actorIndex, isNew, body } = bInfo;
    const isRoot = handle === state.rootBodyHandle;
    const isDynamic = body.isDynamic();
    const isFixed = body.isFixed();
    const t = body.translation();
    
    const statusIcon = isNew ? '✨ NEW' : '✅';
    const bodyIcon = isRoot ? '🏛️' : (isDynamic ? '📦' : '🔒');
    
    console.group(`${bodyIcon} ${statusIcon} ${name} (Handle: ${handle})`);
    console.log('├─ Type:', isDynamic ? 'Dynamic' : (isFixed ? 'Fixed' : 'Other'));
    console.log('├─ Actor Index:', actorIndex ?? 'N/A');
    console.log('├─ Translation:', `(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`);
    
    if (isDynamic) {
      const lv = body.linvel();
      const av = body.angvel();
      console.log('├─ Linear Velocity:', `(${lv.x.toFixed(2)}, ${lv.y.toFixed(2)}, ${lv.z.toFixed(2)})`);
      console.log('├─ Angular Velocity:', `(${av.x.toFixed(2)}, ${av.y.toFixed(2)}, ${av.z.toFixed(2)})`);
    }
    
    // Show colliders attached to this body
    const colliders = bodyToColliders.get(handle) || [];
    
    // Determine what changed with colliders
    const prevBodyState = previousWorldState.bodies.get(handle);
    const prevColliders = new Set(prevBodyState?.colliders ?? []);
    const currColliders = new Set(colliders.map((c) => c.handle));
    
    const addedColliders = colliders.filter((c) => c.isNew || c.wasMoved);
    const retainedColliders = colliders.filter((c) => !c.isNew && !c.wasMoved);
    const removedCount = prevBodyState ? prevColliders.size - retainedColliders.length : 0;
    
    console.log(`└─ Colliders: ${colliders.length} total (${addedColliders.length} added, ${retainedColliders.length} retained${removedCount > 0 ? `, ${removedCount} removed` : ''})`);
    
    if (colliders.length > 0) {
      colliders.forEach((cInfo: ColliderInfo, idx: number) => {
        const isLast = idx === colliders.length - 1;
        const prefix = isLast ? '   └─' : '   ├─';
        
        let status = '';
        if (cInfo.isNew) status = '✨ NEW';
        else if (cInfo.wasMoved) status = `🔄 MOVED from ${cInfo.prevParentName}`;
        else status = '✅';
        
        const handleInfo = cInfo.oldHandle ? ` (recreated, old handle: ${cInfo.oldHandle})` : '';
        
        console.group(`${prefix} ${status} ${cInfo.name} (Handle: ${cInfo.handle}${handleInfo})`);
        if (cInfo.segmentIndex != null) console.log('├─ Segment Index:', cInfo.segmentIndex);
        if (cInfo.nodeIndex != null) console.log('├─ Node Index:', cInfo.nodeIndex);
        console.log('└─ Parent Body:', name);
        console.groupEnd();
      });
    }
    
    console.groupEnd();
  });
  
  // Show removed bodies
  const removedBodies: Array<{ name: string; handle: number; colliders: number[] }> = [];
  previousWorldState.bodies.forEach((prevBody: { name:string; handle:number; colliders:number[] }, handle: number) => {
    if (!currentBodies.has(handle)) {
      removedBodies.push(prevBody);
    }
  });
  
  if (removedBodies.length > 0) {
    console.log('\n🗑️  REMOVED BODIES:\n');
    removedBodies.forEach((bInfo) => {
      console.log(`   ❌ ${bInfo.name} (Handle: ${bInfo.handle}) with ${bInfo.colliders.length} colliders`);
    });
  }
  
  // Summary
  console.log('\n📊 SUMMARY:');
  console.log('├─ Total Actors:', actorMap.size);
  console.log('├─ Rigid Bodies:', currentBodies.size, `(${Array.from(currentBodies.values()).filter(b => b.isNew).length} new)`);
  console.log('├─ Colliders:', currentColliders.size);
  
  const newColliders = Array.from(currentColliders.values()).filter(c => c.isNew).length;
  const movedColliders = Array.from(currentColliders.values()).filter(c => c.wasMoved).length;
  console.log('├─   New Colliders:', newColliders);
  console.log('├─   Moved Colliders:', movedColliders);
  console.log('└─ Removed Bodies:', removedBodies.length);
  
  console.groupEnd();
}

function removeDisabledHandles() {
  const { world, disabledCollidersToRemove, bodiesToRemove, colliderMetadata, bodyMetadata } = state;
  // console.log('Removing disabled handles', { disabledCollidersToRemove, bodiesToRemove });
  // return

  for (const h of Array.from(disabledCollidersToRemove)) {
    const c = world.getCollider(h);
    if (c) world.removeCollider(c, false);
    colliderMetadata.delete(h); // Clean up metadata
    disabledCollidersToRemove.delete(h);
  }

  for (const bh of Array.from(bodiesToRemove)) {
    const b = world.getRigidBody(bh);
    if (b) world.removeRigidBody(b);
    bodyMetadata.delete(bh); // Clean up metadata
    bodiesToRemove.delete(bh);
  }
}

// ---------- Solver Debug Helpers ----------
export function debugPrintSolver(
  solver: ExtStressSolver,
  options?: {
    runtime?: StressRuntime;
    bondTable?: Array<{ index:number; node0:number; node1:number; area?: number }>;
    limit?: number;
  }
) {
  const s = solver;
  if (!s) {
    console.log('Solver not ready');
    return;
  }

  const actors = s.actors();
  const nodes = s.graphNodeCount();
  const bonds = s.bondCapacity();
  const overstressed = s.overstressedBondCount();
  const err = s.stressError();
  const converged = s.converged();
//   const settings = state.solverSettings;
  const debugLines = s.fillDebugRender({ mode: ExtDebugMode.Max, scale: 1.0 });

  console.group('🧮 ExtStressSolver Snapshot');
  console.log('Actors:', actors.length);
  actors.forEach((a) => { console.log(`  - Actor ${a.actorIndex}: nodes [${(a.nodes || []).join(', ')}]`); });

  console.log('Graph Nodes:', nodes);
  console.log('Bond Capacity:', bonds);
  console.log('Overstressed Bonds:', overstressed);
  console.log('Stress Error:', `lin=${err.lin.toFixed(6)} ang=${err.ang.toFixed(6)}`, converged ? '(converged)' : '');
//   if (settings) console.log('Settings:', settings);
  console.log('Debug Lines (for overlay):', debugLines?.length ?? 0);

  // Planned fractures (without applying) — per-actor preview
  try {
    const planned = s.generateFractureCommandsPerActor();
    if (planned && planned.length) {
      console.log('Planned fractures (by actor):');
      planned.forEach((p) => {
        const total = p.fractures?.length ?? 0;
        const sample = (p.fractures || []).slice(0, 5).map((f) => ({ n0: f.nodeIndex0, n1: f.nodeIndex1, health: f.health?.toFixed?.(4) ?? f.health }));
        console.log(`  • Actor ${p.actorIndex}: ${total} bond(s)`, sample.length ? { sample } : '');
      });
    }
  } catch {}

  // Top stressed bonds (derived from debug colors) with node pairs and planned damage
  try {
    const limit = options?.limit ?? 12;
    const top = computeTopStressedBonds(solver, limit);
    if (top.length) {
      // Build node->actor map for quick lookup
      const nodeToActor = new Map<number, number>();
      try {
        for (const a of s.actors() ?? []) {
          for (const n of a.nodes ?? []) nodeToActor.set(n, a.actorIndex);
        }
      } catch {}

      // Map planned fractures to health by bond (keyed by node pair)
      const plannedHealthByPair = new Map<string, number>();
      try {
        const perActor = s.generateFractureCommandsPerActor();
        for (const pa of perActor ?? []) {
          for (const f of pa?.fractures ?? []) {
            const a = Math.min(f.nodeIndex0, f.nodeIndex1);
            const b = Math.max(f.nodeIndex0, f.nodeIndex1);
            const key = `${a}-${b}`;
            const prev = plannedHealthByPair.get(key) ?? 0;
            // Accumulate health deltas if multiple entries exist for same pair
            plannedHealthByPair.set(key, prev + (typeof f.health === 'number' ? f.health : 0));
          }
        }
      } catch {}

      // Build quick bond lookup by index if provided
      const bondByIndex = new Map<number, { index:number; node0:number; node1:number; area?: number }>();
      if (Array.isArray(options?.bondTable)) {
        for (const b of (options?.bondTable ?? [])) bondByIndex.set(b.index, b);
      }

      const fmtPct = (p:number) => (p*100).toFixed(1).padStart(6);

      console.log('Top stressed bonds:');
      console.log('  rank idx | nodes  | actor |   max%    C%     T%     S%  | mode | plannedΔ');

      top.forEach((t, i) => {
        const rank = String(i + 1).padStart(2, '0');
        const idx = String(t.idx).padStart(4, ' ');

        // Resolve node pair if available
        let n0: number | undefined;
        let n1: number | undefined;
        const b = bondByIndex.get(t.idx);
        if (b) { n0 = b.node0; n1 = b.node1; }
        const nodesStr = n0 != null && n1 != null ? `${String(n0).padStart(3,' ')}-${String(n1).padStart(3,' ')}` : '  ?-  ?';

        // Actor membership (prefer first node)
        const act = n0 != null ? nodeToActor.get(n0) : undefined;
        const actorStr = act != null ? String(act).padStart(3, ' ') : '  ?';

        // Dominant mode
        const mode = t.maxPct === t.cPct ? 'C' : (t.maxPct === t.tPct ? 'T' : 'S');

        // Planned health delta if any
        const key = n0 != null && n1 != null ? `${Math.min(n0, n1)}-${Math.max(n0, n1)}` : '';
        const planned = key ? plannedHealthByPair.get(key) : undefined;
        const plannedStr = planned != null ? planned.toFixed(4).padStart(8, ' ') : '        ';

        console.log(`  ${rank}  ${idx} | ${nodesStr} |  ${actorStr} | ${fmtPct(t.maxPct)}  ${fmtPct(t.cPct)}  ${fmtPct(t.tPct)}  ${fmtPct(t.sPct)} |   ${mode}  | ${plannedStr}`);
      });

      console.log('  Legend: C=Compression  T=Tension  S=Shear  plannedΔ=planned health delta from generator');
    }
  } catch {}
  console.groupEnd();
}

// Compute stress percentages for compression/tension/shear by decoding debug colors.
// Note: This mirrors the C++ hue mapping used in NvBlastExtStressSolver (bondHealthColor).
function computeTopStressedBonds(solver: ExtStressSolver, limit = 10) {
  const s = solver;
  if (!s) return [];

  // Per-mode debug lines; arrays are expected to align by solver bond order
  const linesMax = s.fillDebugRender({ mode: ExtDebugMode.Max, scale: 1.0 }) || [];
  const linesC = s.fillDebugRender({ mode: ExtDebugMode.Compression, scale: 1.0 }) || [];
  const linesT = s.fillDebugRender({ mode: ExtDebugMode.Tension, scale: 1.0 }) || [];
  const linesS = s.fillDebugRender({ mode: ExtDebugMode.Shear, scale: 1.0 }) || [];

  const N = Math.min(linesMax.length, linesC.length, linesT.length, linesS.length);
  const entries = [];
  for (let i = 0; i < N; i++) {
    const cPct = stressPctFromColor(linesC[i].color0);
    const tPct = stressPctFromColor(linesT[i].color0);
    const sPct = stressPctFromColor(linesS[i].color0);
    const mPct = Math.max(cPct, tPct, sPct);
    if (mPct >= 0) {
      entries.push({ idx: i, maxPct: mPct, cPct, tPct, sPct });
    }
  }

  entries.sort((a, b) => b.maxPct - a.maxPct);
  return entries.slice(0, limit);
}

function stressPctFromColor(color: number): number {
  // Detect unbreakable color (approx 0xFF00AEFF) — treat as 0
  if ((color & 0x00FFFFFF) === 0x00AEFF) return 0.0;

  const r = (color >> 16) & 0xFF;
  const g = (color >> 8) & 0xFF;
  const b = color & 0xFF;
  const { h, s, v } = rgbToHsv(r / 255, g / 255, b / 255);
  if (s < 0.5 || v < 0.5) return -1; // unexpected

  const GREEN = 1.0 / 3.0;
  const RED = 0.0;
  const BLUE = 2.0 / 3.0;
  const MAGENTA = 5.0 / 6.0;

  // Map hue back to stressPct per solver mapping
  // 0..0.5: GREEN -> RED, 0.5..1.0: BLUE -> MAGENTA
  if (h <= GREEN + 1e-3 && h >= RED - 1e-3) {
    const t = (GREEN - h) / (GREEN - RED);
    return 0.5 * clamp01(t);
  }
  if (h >= BLUE - 1e-3 && h <= MAGENTA + 1e-3) {
    const t = (h - BLUE) / (MAGENTA - BLUE);
    return 0.5 + 0.5 * clamp01(t);
  }
  return -1;
}

function rgbToHsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function clamp01(x: number) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
