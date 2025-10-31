import type { ChunkData, ScenarioDesc } from './types';

export type DamageOptions = {
  enabled?: boolean;
  strengthPerVolume?: number;
  kImpact?: number;
  enableSupportsDamage?: boolean;
  contactDamageScale?: number;
  minImpulseThreshold?: number;
  contactCooldownMs?: number;
  internalContactScale?: number;
  // New: reduce mass immunity and improve collapse responsiveness
  massExponent?: number; // damage denominator uses mass^massExponent (was 1.0)
  internalMinImpulseThreshold?: number; // threshold specifically for self-contacts
  // Splash AOE around impact point (actor-local coordinates)
  splashRadius?: number; // meters
  splashFalloffExp?: number; // exponent for smooth falloff
  // Speed scaling controls (applied in core when mapping contact forces → damage)
  speedMinExternal?: number; // m/s threshold for external contacts where boost begins
  speedMinInternal?: number; // m/s threshold for internal contacts where boost begins
  speedMax?: number; // m/s at which boost fully applies
  speedExponent?: number; // curve exponent for boost falloff
  slowSpeedFactor?: number; // multiplier at/below vMin (<=1 suppresses resting)
  fastSpeedFactor?: number; // multiplier at/above vMax (>=1 boosts fast impacts)
};

export type DestroyCallback = (nodeIndex: number, reason: string) => void;

export class DestructibleDamageSystem {
  private chunks: ChunkData[];
  private nodes: ScenarioDesc['nodes'];
  private options: Required<DamageOptions>;
  private materialScale: number;
  private timeMs = 0;
  private nextAllowedImpactTimeMs: number[];
  private massPow: Float64Array;

  constructor(args: { chunks: ChunkData[]; scenario: ScenarioDesc; materialScale: number; options?: DamageOptions }) {
    const defaults: Required<DamageOptions> = {
      enabled: false,
      strengthPerVolume: 10000,
      kImpact: 0.002,
      enableSupportsDamage: false,
      contactDamageScale: 1.0,
      minImpulseThreshold: 50,
      contactCooldownMs: 120,
      internalContactScale: 0.5,
      massExponent: 0.5,
      internalMinImpulseThreshold: 15,
      splashRadius: 1.5,
      splashFalloffExp: 2.0,
      speedMinExternal: 0.5,
      speedMinInternal: 0.25,
      speedMax: 6.0,
      speedExponent: 1.0,
      slowSpeedFactor: 0.9,
      fastSpeedFactor: 3.0,
    };
    const opts = { ...defaults, ...(args.options ?? {}) };
    this.chunks = args.chunks;
    this.nodes = args.scenario.nodes;
    this.options = opts;
    this.materialScale = Math.max(1e-9, args.materialScale ?? 1);
    this.nextAllowedImpactTimeMs = new Array(this.chunks.length).fill(0);
    this.massPow = new Float64Array(this.chunks.length);

    // Initialize per-node health if enabled
    if (opts.enabled) {
      for (let i = 0; i < this.chunks.length; i++) {
        const ch = this.chunks[i];
        const node = this.nodes[i];
        const vol = Math.max(1e-6, (node?.volume ?? 1));
        // const maxH = Math.max(1, opts.strengthPerVolume * vol * this.materialScale);
        const maxH = Math.max(1, opts.strengthPerVolume * vol);
        ch.maxHealth = maxH;
        ch.health = maxH;
        ch.pendingDamage = 0;
        ch.destroyed = false;
      }
    }
    const me = Math.max(0, opts.massExponent ?? 0.5);
    for (let i = 0; i < this.nodes.length; i++) {
      const nodeMass = Math.max(1, this.nodes[i]?.mass ?? 1);
      this.massPow[i] = Math.max(1, Math.pow(nodeMass, me));
    }
  }

  public isEnabled() {
    return !!this.options.enabled;
  }

  public getOptions() {
    return this.options;
  }

  public onImpact(
    nodeIndex: number,
    forceMagnitude: number,
    dt: number,
    opts?: { localPoint?: { x:number; y:number; z:number } }
  ) {
    if (!this.options.enabled) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: damage system not enabled", { nodeIndex, forceMagnitude, dt });
      return;
    }

    const ch = this.chunks[nodeIndex];
    if (!ch || ch.destroyed) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: chunk is missing or destroyed", { nodeIndex });
      return;
    }

    const node = this.nodes[nodeIndex];
    const rawMass = node?.mass ?? 1;
    const isInfiniteMass = rawMass === 0; // supports mass=0 are infinite mass
    if (!this.options.enableSupportsDamage && isInfiniteMass) {
      // Ignore support impacts when support damage is disabled
      // console.log("[DestructibleDamageSystem] onImpact early return: support node and support damage is disabled", { nodeIndex });
      // return;
    }

    const impulse = Math.max(0, forceMagnitude) * Math.max(0, dt);
    if (impulse < this.options.minImpulseThreshold) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: impulse below threshold", { nodeIndex, impulse, minImpulseThreshold: this.options.minImpulseThreshold });
      return;
    }
    if (this.timeMs < (this.nextAllowedImpactTimeMs[nodeIndex] ?? 0)) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: impact cooldown active", { nodeIndex, timeMs: this.timeMs, nextAllowed: this.nextAllowedImpactTimeMs[nodeIndex] });
      return;
    }
    const denom = this.massPow[nodeIndex] || Math.max(1, Math.pow(Math.max(1, rawMass), this.options.massExponent));
    const dmgBase = this.options.kImpact * (impulse / denom);
    const dmgScaled = dmgBase * this.options.contactDamageScale;
    const dmg = Number.isFinite(dmgScaled) ? dmgScaled : 0;

    const lp = opts?.localPoint;
    const radius = Math.max(1e-6, this.options.splashRadius ?? 0);
    const exp = Math.max(0.01, this.options.splashFalloffExp ?? 1);
    const hitBody = this.chunks[nodeIndex]?.bodyHandle;

    if (lp && hitBody != null) {
      // Apply AOE to chunks on the same rigid body; center chunk always gets full damage
      for (let i = 0; i < this.chunks.length; i++) {
        const c = this.chunks[i];
        if (!c || c.destroyed) continue;
        if (c.bodyHandle !== hitBody) continue;
        const center = c.baseLocalOffset ?? { x: 0, y: 0, z: 0 };
        const dx = (center.x ?? 0) - (lp.x ?? 0);
        const dy = (center.y ?? 0) - (lp.y ?? 0);
        const dz = (center.z ?? 0) - (lp.z ?? 0);
        const d = Math.hypot(dx, dy, dz);
        let w = 0;
        if (i === nodeIndex) {
          w = 1; // ensure full damage on the hit collider
        } else if (d <= radius) {
          w = Math.pow(Math.max(0, 1 - d / radius), exp);
        }
        if (w <= 0) continue;
        c.pendingDamage = (c.pendingDamage ?? 0) + dmg * w;
      }
      this.nextAllowedImpactTimeMs[nodeIndex] = this.timeMs + this.options.contactCooldownMs;
      return;
    }

    // Fallback: single-chunk damage if no impact point provided
    ch.pendingDamage = (ch.pendingDamage ?? 0) + dmg;
    this.nextAllowedImpactTimeMs[nodeIndex] = this.timeMs + this.options.contactCooldownMs;
  }

  public onInternalImpact(
    nodeA: number,
    nodeB: number,
    forceMagnitude: number,
    dt: number,
    opts?: { localPointA?: { x:number; y:number; z:number }; localPointB?: { x:number; y:number; z:number } }
  ) {
    if (!this.options.enabled) return;

    const impulse = Math.max(0, forceMagnitude) * Math.max(0, dt);
    const threshold = this.options.internalMinImpulseThreshold ?? this.options.minImpulseThreshold;
    if (impulse < threshold) return;
    const scale = this.options.internalContactScale;

    this.onImpact(nodeA, forceMagnitude * scale, dt, { localPoint: opts?.localPointA });
    this.onImpact(nodeB, forceMagnitude * scale, dt, { localPoint: opts?.localPointB });
    // console.log("[DestructibleDamageSystem] onInternalImpact: dmg", nodeA, nodeB, forceMagnitude, dt, scale);
  }

  public applyDirect(nodeIndex: number, amount: number) {
    if (!this.options.enabled) return;
    const ch = this.chunks[nodeIndex];
    if (!ch || ch.destroyed) return;
    ch.pendingDamage = (ch.pendingDamage ?? 0) + Math.max(0, amount);
  }

  public getHealth(nodeIndex: number) {
    const ch = this.chunks[nodeIndex];
    if (!ch || ch.maxHealth == null || ch.health == null) return null;
    return { health: ch.health, maxHealth: ch.maxHealth, destroyed: !!ch.destroyed };
  }

  public tick(_dt: number, onDestroyed?: DestroyCallback) {
    if (!this.options.enabled) return;
    this.timeMs += Math.max(0, _dt) * 1000.0;
    for (let i = 0; i < this.chunks.length; i++) {
      const ch = this.chunks[i];

      const isSupport = this.chunks[i]?.isSupport;

      if (!ch || ch.destroyed) continue;
      const maxH = ch.maxHealth ?? 0;
      if (!(maxH > 0)) continue;
      const dmg = ch.pendingDamage ?? 0;
    //   if (dmg > 10) {
    //     console.log("[DestructibleDamageSystem] tick: dmg", i, dmg, ch.health);
    //   }
      if (dmg <= 0) continue;
      const h = Math.max(0, (ch.health ?? maxH) - dmg);
      ch.health = h;
      ch.pendingDamage = 0;
      if (h <= 0 && !ch.destroyed) {

        if (isSupport) {
        //   console.log("[DestructibleDamageSystem] tick: support node not destroyed", { nodeIndex: i });
          continue;
        }

        ch.destroyed = true;
        if (onDestroyed) onDestroyed(i, 'impact');
      }
    }
  }
}


