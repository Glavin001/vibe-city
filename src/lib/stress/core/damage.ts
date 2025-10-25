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
};

export type DestroyCallback = (nodeIndex: number, reason: string) => void;

export class DestructibleDamageSystem {
  private chunks: ChunkData[];
  private nodes: ScenarioDesc['nodes'];
  private options: Required<DamageOptions>;
  private materialScale: number;
  private timeMs = 0;
  private nextAllowedImpactTimeMs: number[];

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
    };
    const opts = { ...defaults, ...(args.options ?? {}) };
    this.chunks = args.chunks;
    this.nodes = args.scenario.nodes;
    this.options = opts;
    this.materialScale = Math.max(1e-9, args.materialScale ?? 1);
    this.nextAllowedImpactTimeMs = new Array(this.chunks.length).fill(0);

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
  }

  public isEnabled() {
    return !!this.options.enabled;
  }

  public getOptions() {
    return this.options;
  }

  public onImpact(nodeIndex: number, forceMagnitude: number, dt: number) {
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
    // const isInfiniteMass = (node?.mass ?? 0) === 0; // supports mass=0 are infinite mass
    // if (!this.options.enableSupportsDamage && isInfiniteMass) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: supports damage not enabled and node is infinite mass", { nodeIndex });
    //   return;
    // }

    const nodeMass = Math.max(1, node?.mass ?? 1);
    const impulse = Math.max(0, forceMagnitude) * Math.max(0, dt);
    if (impulse < this.options.minImpulseThreshold) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: impulse below threshold", { nodeIndex, impulse, minImpulseThreshold: this.options.minImpulseThreshold });
      return;
    }
    if (this.timeMs < (this.nextAllowedImpactTimeMs[nodeIndex] ?? 0)) {
    //   console.log("[DestructibleDamageSystem] onImpact early return: impact cooldown active", { nodeIndex, timeMs: this.timeMs, nextAllowed: this.nextAllowedImpactTimeMs[nodeIndex] });
      return;
    }

    const dmgBase = this.options.kImpact * (impulse / nodeMass);
    const dmgScaled = dmgBase * this.options.contactDamageScale;
    const dmg = Number.isFinite(dmgScaled) ? dmgScaled : 0;
    ch.pendingDamage = (ch.pendingDamage ?? 0) + dmg;
    this.nextAllowedImpactTimeMs[nodeIndex] = this.timeMs + this.options.contactCooldownMs;
  }

  public onInternalImpact(nodeA: number, nodeB: number, forceMagnitude: number, dt: number) {
    if (!this.options.enabled) return;

    const impulse = Math.max(0, forceMagnitude) * Math.max(0, dt);
    if (impulse < this.options.minImpulseThreshold) return;
    const scale = this.options.internalContactScale;

    this.onImpact(nodeA, forceMagnitude * scale, dt);
    this.onImpact(nodeB, forceMagnitude * scale, dt);
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


