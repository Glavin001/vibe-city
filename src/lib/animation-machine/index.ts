// three-animstate.ts
import * as THREE from 'three';

/* =============================== Types =============================== */

export type ParamType = 'float'|'int'|'bool'|'trigger'|'vec2';

export interface ParamDef {
  type: ParamType;
  default?: number|boolean|[number, number];
  damp?: number;
  min?: number;
  max?: number;
  normalize?: boolean;
  wrap?: boolean;
}

export interface BoneMask { bones: string[]; includeChildren?: boolean; }

export type ClipRef = {
  clip: string;
  loop?: 'once'|'repeat'|'pingpong';
  speed?: number;
  additive?: boolean;
};

export type ClipNode = { type: 'clip'; motion: ClipRef };

export type Blend1DNode = {
  type: 'blend1d';
  parameter: string;
  children: { pos: number; motion: ClipRef }[];
};

export type Blend2DNode = {
  type: 'blend2d';
  parameters: [string, string];
  kernel?: { type: 'shepard'; power?: number; eps?: number };
  children: { pos: [number, number]; motion: ClipRef }[];
};

export type DirectBlendNode = {
  type: 'direct';
  children: { motion: ClipRef; weightParam: string }[];
};

export type NodeConfig = ClipNode | Blend1DNode | Blend2DNode | DirectBlendNode;

export type Condition =
  | { param: string; op: '>'|'>='|'<'|'<='|'=='|'!='; value: number|boolean }
  | { trigger: string };

export interface Transition {
  to: string;
  conditions?: Condition[];
  logic?: 'all'|'any';
  hasExitTime?: boolean;
  exitTime?: number;
  duration?: number;
  easing?: 'linear'|'easeIn'|'easeOut';
  interruptible?: 'never'|'afterExit'|'always';
  priority?: number;
  startTime?: { mode: 'sync'|'normalized'|'seconds'; value?: number };
  warp?: boolean;
}

export interface StateConfig {
  node: NodeConfig;
  onEnterEvents?: string[];
  onExitEvents?: string[];
  transitions?: Transition[];
  tags?: string[];
  syncGroup?: string;
}

export interface LayerConfig {
  name: string;
  entry: string;
  states: Record<string, StateConfig>;
  anyState?: Transition[];
  mask?: BoneMask;
  weight?: number;
}

export interface SyncGroupConfig { name: string; states: string[]; }

export interface AnimGraphConfig {
  parameters: Record<string, ParamDef>;
  layers: LayerConfig[];
  syncGroups?: Record<string, SyncGroupConfig>;
}

/* =============================== Utilities =============================== */

const EPS = 1e-6;

function clamp(v: number, min?: number, max?: number) {
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

// critically damped smoothing for floats
function dampTowards(current: number, target: number, halfLife: number, dt: number) {
  if (!halfLife || halfLife <= 0) return target;
  const lambda = Math.LN2 / halfLife;
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function normalizedTime(action: THREE.AnimationAction) {
  const clip = action.getClip();
  const t = (action.time % clip.duration + clip.duration) % clip.duration;
  return clip.duration > 0 ? t / clip.duration : 0;
}

type ParamValue = number|boolean|THREE.Vector2;

class ParamsRuntime {
  defs: Record<string, ParamDef>;
  _values = new Map<string, ParamValue>();
  _targets = new Map<string, ParamValue>();

  constructor(defs: Record<string, ParamDef>) {
    this.defs = defs;
    for (const [k, def] of Object.entries(defs)) {
      switch (def.type) {
        case 'vec2': {
          const d = def.default as [number, number] | undefined;
          const v = new THREE.Vector2(d?.[0] ?? 0, d?.[1] ?? 0);
          this._values.set(k, v.clone());
          this._targets.set(k, v.clone());
          break;
        }
        case 'float':
        case 'int': {
          const d = (def.default as number|undefined) ?? 0;
          this._values.set(k, d);
          this._targets.set(k, d);
          break;
        }
        case 'bool':
        case 'trigger': {
          const d = (def.default as boolean|undefined) ?? false;
          this._values.set(k, d);
          this._targets.set(k, d);
          break;
        }
      }
    }
  }

  get(name: string) { return this._values.get(name); }

  set(name: string, value: ParamValue) {
    const def = this.defs[name];
    if (!def) return;
    if (def.type === 'vec2' && value instanceof THREE.Vector2) {
      const v = (this._targets.get(name) as THREE.Vector2) ?? new THREE.Vector2();
      v.copy(value);
      if (def.normalize) v.normalize();
      this._targets.set(name, v);
    } else if (def.type === 'float' || def.type === 'int') {
      let n = value as number;
      if (def.wrap) n = THREE.MathUtils.euclideanModulo(n, 1);
      n = clamp(n, def.min, def.max);
      this._targets.set(name, def.type === 'int' ? Math.round(n) : n);
    } else {
      this._targets.set(name, value);
    }
  }

  trigger(name: string) {
    const def = this.defs[name];
    if (def?.type !== 'trigger') return;
    this._values.set(name, true);
    this._targets.set(name, true);
  }

  resetTrigger(name: string) {
    const def = this.defs[name];
    if (def?.type !== 'trigger') return;
    this._values.set(name, false);
    this._targets.set(name, false);
  }

  // advance damped params (call before layer updates)
  updateDamping(dt: number) {
    for (const [name, def] of Object.entries(this.defs)) {
      const cur = this._values.get(name)!;
      const tgt = this._targets.get(name)!;
      if (def.type === 'float' || def.type === 'int') {
        const c = cur as number, t = tgt as number;
        const v = dampTowards(c, t, def.damp ?? 0, dt);
        this._values.set(name, def.type === 'int' ? Math.round(v) : v);
      } else if (def.type === 'vec2') {
        const c = (cur as THREE.Vector2).clone();
        const t = (tgt as THREE.Vector2);
        const x = dampTowards(c.x, t.x, (def.damp ?? 0), dt);
        const y = dampTowards(c.y, t.y, (def.damp ?? 0), dt);
        (this._values.get(name) as THREE.Vector2).set(x, y);
      } else {
        // bool – snap to target
        this._values.set(name, tgt);
      }
    }
  }

  // reset triggers (call after layer updates)
  resetTriggers() {
    for (const [name, def] of Object.entries(this.defs)) {
      if (def.type === 'trigger') {
        const cur = this._values.get(name)!;
        // triggers auto-reset after a tick
        if (cur === true) this._values.set(name, false);
        this._targets.set(name, false);
      }
    }
  }
}

/* =============================== Action / Clip cache =============================== */

type ClipKey = string; // original clip name
type MaskKey = string | undefined; // JSON of mask bones or undefined
type AddKey = boolean;

interface CachedAction {
  action: THREE.AnimationAction;
  clip: THREE.AnimationClip;
}

export interface BuildContext {
  object: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

function cloneClipFiltered(clip: THREE.AnimationClip, allowedPaths: Set<string>) {
  const tracks = clip.tracks.filter(t => {
    // property binding path example: 'Hips.position' or 'Armature/Hips.quaternion' or 'bones[Hips].quaternion'
    // We keep any track whose node name is in allowedPaths (simple contains check).
    const path = t.name; // e.g., 'Armature.Hips.quaternion' or 'bones[Hips].quaternion'
    for (const p of allowedPaths) if (path.includes(p)) return true;
    return false;
  });
  return new THREE.AnimationClip(clip.name + '|masked', clip.duration, tracks);
}

class ClipLibrary {
  private original = new Map<string, THREE.AnimationClip>();
  private additive = new Map<string, THREE.AnimationClip>();
  private masked = new Map<string, THREE.AnimationClip>(); // key: clipName + '||' + maskKey

  constructor(clips: THREE.AnimationClip[]) {
    for (const c of clips) this.original.set(c.name, c);
  }

  getOriginal(name: string) { 
    const clip = this.original.get(name);
    if (!clip) {
      console.error(`❌ ClipLibrary: Original clip "${name}" not found. Available clips:`, Array.from(this.original.keys()).sort());
    }
    return clip;
  }

  getAdditive(name: string, refFrame = 0): THREE.AnimationClip | undefined {
    const key = `${name}::add:${refFrame}`;
    if (this.additive.has(key)) return this.additive.get(key)!;
    const base = this.original.get(name);
    if (!base) {
      console.error(`❌ ClipLibrary: Cannot create additive clip. Base clip "${name}" not found.`);
      return undefined;
    }
    const add = THREE.AnimationUtils.makeClipAdditive(base, refFrame);
    add.name = base.name + '|add';
    this.additive.set(key, add);
    return add;
  }

  getMasked(name: string, maskKey: string, allowedPaths: Set<string>) {
    const key = `${name}||mask:${maskKey}`;
    if (this.masked.has(key)) return this.masked.get(key)!;
    const base = this.original.get(name);
    if (!base) {
      console.error(`❌ ClipLibrary: Cannot create masked clip. Base clip "${name}" not found.`);
      return undefined;
    }
    const m = cloneClipFiltered(base, allowedPaths);
    this.masked.set(key, m);
    return m;
  }

  dispose(mixer: THREE.AnimationMixer) {
    for (const c of this.additive.values()) mixer.uncacheClip(c);
    for (const c of this.masked.values()) mixer.uncacheClip(c);
  }
}

/* =============================== Nodes =============================== */

type ActionWeight = { action: THREE.AnimationAction; weight: number; primary?: boolean };

interface NodeEvalResult {
  actions: ActionWeight[]; // sum of weights should be ~1 for normal layers (additive actions may exceed)
  representative?: THREE.AnimationAction; // used for warp/sync
}

// Build or fetch an action given a clip ref, layer mask and additivity.
class ActionFactory {
  private mixer: THREE.AnimationMixer;
  private lib: ClipLibrary;
  private object: THREE.Object3D;

  // caches: [clipName|masked|add] -> action
  private actions = new Map<string, THREE.AnimationAction>();

  constructor(mixer: THREE.AnimationMixer, object: THREE.Object3D, lib: ClipLibrary) {
    this.mixer = mixer; this.object = object; this.lib = lib;
  }

  private key(clip: THREE.AnimationClip, blendMode: number) {
    return `${clip.uuid}|bm:${blendMode}`;
  }

  get(clipRef: ClipRef, maskAllowedPaths?: Set<string>): THREE.AnimationAction | undefined {
    // resolve clip
    let clip: THREE.AnimationClip | undefined;
    if (maskAllowedPaths) {
      const maskKey = JSON.stringify([...maskAllowedPaths.values()]);
      clip = this.lib.getMasked(clipRef.clip, maskKey, maskAllowedPaths);
    } else if (clipRef.additive) {
      clip = this.lib.getAdditive(clipRef.clip);
    } else {
      clip = this.lib.getOriginal(clipRef.clip);
    }
    if (!clip) return undefined;

    const blendMode = clipRef.additive ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode;
    const cacheKey = `${clip.uuid}|bm:${blendMode}`;
    if (this.actions.has(cacheKey)) return this.actions.get(cacheKey)!;

    const action = this.mixer.clipAction(clip, this.object);
    (action as any).blendMode = blendMode; // TS not exposing property
    this.actions.set(cacheKey, action);
    return action;
  }

  dispose() {
    for (const a of this.actions.values()) {
      a.stop();
      this.mixer.uncacheAction(a.getClip(), this.object);
    }
  }
}

/* =============================== Layer runtime =============================== */

type EasingFn = (t: number) => number;
const Easings: Record<string, EasingFn> = {
  linear: t => t,
  easeIn: t => t*t,
  easeOut: t => 1 - (1 - t)*(1 - t),
};

interface StateRuntimeInfo {
  name: string;
  cfg: StateConfig;
}

class LayerRuntime {
  readonly mixer: THREE.AnimationMixer;
  readonly params: ParamsRuntime;
  readonly lib: ClipLibrary;
  readonly object: THREE.Object3D;
  readonly mask?: BoneMask;
  readonly weight: number;
  readonly states: Record<string, StateConfig>;
  readonly anyState?: Transition[];
  readonly entry: string;

  private actionFactory: ActionFactory;
  private activeActions = new Set<THREE.AnimationAction>();
  private current?: StateRuntimeInfo;
  private timeInState = 0;
  private transitionTime = 0;
  private inTransition = false;
  private representative?: THREE.AnimationAction;

  constructor(mixer: THREE.AnimationMixer, object: THREE.Object3D, lib: ClipLibrary,
              layerCfg: LayerConfig, params: ParamsRuntime) {
    this.mixer = mixer; this.object = object; this.lib = lib;
    this.params = params; this.mask = layerCfg.mask;
    this.weight = layerCfg.weight ?? 1;
    this.states = layerCfg.states; this.anyState = layerCfg.anyState;
    this.entry = layerCfg.entry;
    this.actionFactory = new ActionFactory(mixer, object, lib);
  }

  start() {
    this.enterState(this.entry, 0);
  }

  private allowedPathsFromMask(): Set<string> | undefined {
    if (!this.mask) return undefined;
    // we accept bone names as substrings in track names (robust across exporters)
    const s = new Set<string>();
    for (const b of this.mask.bones) s.add(b);
    return s;
  }

  private realizeMotion(m: ClipRef, maskPaths?: Set<string>) {
    const action = this.actionFactory.get(m, maskPaths);
    if (!action) return undefined;
    // setup loop
    const loopMap = { once: THREE.LoopOnce, repeat: THREE.LoopRepeat, pingpong: THREE.LoopPingPong } as const;
    const loopMode = loopMap[m.loop ?? 'repeat'];
    action.setLoop(loopMode, loopMode === THREE.LoopOnce ? 1 : Infinity);
    action.clampWhenFinished = loopMode === THREE.LoopOnce;
    action.setEffectiveTimeScale(m.speed ?? 1);
    // keep enabled
    action.enabled = true;
    return action;
  }

  private evalClip(node: ClipNode): NodeEvalResult {
    const paths = this.allowedPathsFromMask();
    const a = this.realizeMotion(node.motion, paths);
    if (!a) return { actions: [] };
    return { actions: [{ action: a, weight: 1, primary: true }], representative: a };
  }

  private evalBlend1D(node: Blend1DNode): NodeEvalResult {
    const p = this.params.get(node.parameter) as number;
    const sorted = [...node.children].sort((a,b)=>a.pos-b.pos);
    let i = 0;
    while (i < sorted.length-1 && p > sorted[i+1].pos) i++;
    const aPos = sorted[Math.max(0,i)].pos;
    const bPos = sorted[Math.min(sorted.length-1, i+1)].pos;
    const t = (bPos - aPos) > EPS ? THREE.MathUtils.clamp((p - aPos) / (bPos - aPos), 0, 1) : 0;
    const paths = this.allowedPathsFromMask();

    const left = this.realizeMotion(sorted[Math.max(0,i)].motion, paths);
    const right = this.realizeMotion(sorted[Math.min(sorted.length-1, i+1)].motion, paths);

    // Warn if clips are missing
    if (!left) console.warn(`⚠️ Blend1D: Clip "${sorted[Math.max(0,i)].motion.clip}" not found`);
    if (!right) console.warn(`⚠️ Blend1D: Clip "${sorted[Math.min(sorted.length-1, i+1)].motion.clip}" not found`);

    // Accumulate weights if left and right are the same action
    const actions: ActionWeight[] = [];
    const totalWeight = (left ? 1 - t : 0) + (right ? t : 0);
    
    if (left && right && left === right) {
      // Same action on both sides - accumulate weights
      const combinedWeight = ((1 - t) + t) / (totalWeight || 1);
      actions.push({ action: left, weight: combinedWeight, primary: true });
    } else {
      // Different actions - add separately
      if (left) actions.push({ action: left, weight: (1 - t) / (totalWeight || 1), primary: t < 0.5 });
      if (right) actions.push({ action: right, weight: t / (totalWeight || 1), primary: t >= 0.5 });
    }
    
    const representative = (t < 0.5 ? left : right) ?? left ?? right;
    return { actions, representative };
  }

  private evalBlend2D(node: Blend2DNode): NodeEvalResult {
    const [pxName, pyName] = node.parameters;
    const v = this.params.get(pxName) as number ?? 0;
    const w = this.params.get(pyName) as number ?? 0;
    const power = node.kernel?.power ?? 2;
    const eps = node.kernel?.eps ?? 1e-3;

    const paths = this.allowedPathsFromMask();
    const weights: number[] = [];
    const realized: (THREE.AnimationAction|undefined)[] = [];
    
    // Calculate weights and realize all motions
    for (const c of node.children) {
      const dx = v - c.pos[0], dy = w - c.pos[1];
      const d = Math.sqrt(dx*dx + dy*dy);
      const weight = 1 / Math.pow(Math.max(d, eps), power);
      weights.push(weight);
      realized.push(this.realizeMotion(c.motion, paths));
    }
    
    // Only sum weights for actions that were successfully realized
    const actions: ActionWeight[] = [];
    let validWeightSum = 0;
    for (let i=0;i<node.children.length;i++) {
      if (realized[i]) {
        validWeightSum += weights[i];
      }
    }
    
    // Warn if some clips couldn't be found
    const missingCount = realized.filter(a => !a).length;
    if (missingCount > 0) {
      console.warn(`⚠️ Blend2D: ${missingCount}/${node.children.length} clips not found. Weights will be renormalized.`);
      const missingClips = node.children.filter((c, i) => !realized[i]).map(c => c.motion.clip);
      console.warn('Missing clips:', missingClips);
    }
    
    // Build action list with renormalized weights
    // IMPORTANT: Accumulate weights for the same action (same clip can be used multiple times in blend space)
    const actionWeightMap = new Map<THREE.AnimationAction, number>();
    let maxW = -1, rep: THREE.AnimationAction|undefined = undefined;
    
    for (let i=0;i<node.children.length;i++) {
      const a = realized[i];
      if (!a) continue;
      const ww = weights[i]/(validWeightSum || 1); // Normalize against valid weights only
      
      // Accumulate weight if this action already exists
      const existingWeight = actionWeightMap.get(a) || 0;
      const newWeight = existingWeight + ww;
      actionWeightMap.set(a, newWeight);
      
      if (newWeight > maxW) { maxW = newWeight; rep = a; }
    }
    
    // Convert map to action list
    for (const [action, weight] of actionWeightMap.entries()) {
      actions.push({ action, weight, primary: action === rep });
    }
    
    return { actions, representative: rep };
  }

  private evalDirect(node: DirectBlendNode): NodeEvalResult {
    const paths = this.allowedPathsFromMask();
    const actions: ActionWeight[] = [];
    let rep: THREE.AnimationAction|undefined;
    let maxW = -1;
    for (const c of node.children) {
      const w = (this.params.get(c.weightParam) as number) ?? 0;
      const a = this.realizeMotion(c.motion, paths);
      if (!a) continue;
      actions.push({ action: a, weight: w });
      if (w > maxW) { maxW = w; rep = a; }
    }
    if (rep) actions.forEach(x => { if (x.action===rep) x.primary = true; });
    return { actions, representative: rep };
  }

  private evaluateNode(n: NodeConfig): NodeEvalResult {
    switch (n.type) {
      case 'clip': return this.evalClip(n);
      case 'blend1d': return this.evalBlend1D(n);
      case 'blend2d': return this.evalBlend2D(n);
      case 'direct': return this.evalDirect(n);
    }
  }

  private conditionsPass(conds?: Condition[], logic: 'all'|'any'='all') {
    if (!conds || conds.length===0) return true;
    const evalOne = (c: Condition) => {
      if ((c as any).trigger) {
        const name = (c as any).trigger as string;
        const v = this.params.get(name) as boolean;
        return v === true;
      } else {
        const {param, op, value} = c as any;
        const cur = this.params.get(param) as any;
        switch (op) {
          case '>':  return cur >  (value as any);
          case '>=': return cur >= (value as any);
          case '<':  return cur <  (value as any);
          case '<=': return cur <= (value as any);
          case '==': return cur === (value as any);
          case '!=': return cur !== (value as any);
        }
      }
    };
    if (logic==='all') return conds.every(evalOne);
    return conds.some(evalOne);
  }

  private findTransition(curName: string, curAction?: THREE.AnimationAction): Transition|undefined {
    const state = this.states[curName];
    const candidates = [
      ...(this.anyState ?? []),
      ...(state.transitions ?? [])
    ].sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const t of candidates) {
      if (t.hasExitTime && curAction) {
        const nt = normalizedTime(curAction);
        if (nt + EPS < (t.exitTime ?? 0)) continue;
      }
      if (!this.conditionsPass(t.conditions, t.logic ?? 'all')) continue;
      return t;
    }
    return undefined;
  }

  private enterState(name: string, blendDuration: number, warp = false, startTime?: {mode:'sync'|'normalized'|'seconds', value?: number}) {
    const cfg = this.states[name];
    if (!cfg) throw new Error(`State ${name} not found`);

    const result = this.evaluateNode(cfg.node);
    const newSet = new Set(result.actions.map(a => a.action));

    // Fade out old actions not in the new set
    for (const a of this.activeActions) {
      if (!newSet.has(a)) {
        a.fadeOut(blendDuration);
      }
    }

    // Fade in / configure new actions
    for (const aw of result.actions) {
      const a = aw.action;
      if (!this.activeActions.has(a)) {
        a.reset().play();
        a.setEffectiveWeight(0);
        a.fadeIn(blendDuration);
      }
      // representative time handling
      if (aw.primary && startTime) {
        const clip = a.getClip();
        if (startTime.mode === 'normalized') {
          a.time = (startTime.value ?? 0) * clip.duration;
        } else if (startTime.mode === 'seconds') {
          a.time = startTime.value ?? 0;
        }
      }
    }

    // optional warp between representatives
    if (warp && this.representative && result.representative && blendDuration > 0) {
      result.representative.crossFadeFrom(this.representative, blendDuration, true);
    }

    this.activeActions = newSet;
    this.representative = result.representative;
    this.current = { name, cfg };
    this.timeInState = 0;
    this.inTransition = blendDuration > 0;
    this.transitionTime = blendDuration;
  }

  update(dt: number) {
    if (!this.current) this.start();

    const reps = this.representative;
    const curName = this.current!.name;

    // evaluate transitions
    const t = this.findTransition(curName, reps);
    if (t) {
      const dur = Math.max(0, t.duration ?? 0.2);
      let startTime: {mode:'sync'|'normalized'|'seconds', value?: number}|undefined;
      if (t.startTime?.mode === 'sync') {
        startTime = { mode: 'normalized', value: reps ? normalizedTime(reps) : 0 };
      } else if (t.startTime) {
        startTime = t.startTime;
      }
      this.enterState(t.to, dur, !!t.warp, startTime);
    } else {
      // no change; update weights inside the node (for blend nodes):
      const res = this.evaluateNode(this.current!.cfg.node);
      for (const aw of res.actions) {
        if (!this.activeActions.has(aw.action)) {
          aw.action.reset().play().setEffectiveWeight(0).fadeIn(0.1);
          this.activeActions.add(aw.action);
        }
      }
      // set per-frame effective weight (layer weight multiplies)
      for (const a of this.activeActions) a.setEffectiveWeight(0); // reset; we'll assign below
      for (const aw of res.actions) {
        aw.action.setEffectiveWeight(Math.max(aw.weight, 0) * (this.weight ?? 1));
      }
      this.representative = res.representative ?? this.representative;
    }

    // bookkeeping
    this.timeInState += dt;
    if (this.inTransition) {
      this.transitionTime -= dt;
      if (this.transitionTime <= 0) this.inTransition = false;
    }
  }

  dispose() {
    this.actionFactory.dispose();
  }
}

/* =============================== Animator (public API) =============================== */

export type AnimatorEvents = {
  onEnter?: (layer: string, state: string) => void;
  onExit?: (layer: string, state: string) => void;
};

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  readonly object: THREE.Object3D;
  readonly config: AnimGraphConfig;
  readonly clips: THREE.AnimationClip[];
  readonly params: ParamsRuntime;

  private lib: ClipLibrary;
  private layers: LayerRuntime[] = [];
  private started = false;

  constructor(object: THREE.Object3D, clips: THREE.AnimationClip[], config: AnimGraphConfig) {
    this.object = object;
    this.clips = clips;
    this.config = config;
    this.mixer = new THREE.AnimationMixer(object);
    this.lib = new ClipLibrary(clips);
    this.params = new ParamsRuntime(config.parameters);

    for (const layerCfg of config.layers) {
      this.layers.push(new LayerRuntime(this.mixer, object, this.lib, layerCfg, this.params));
    }
  }

  /** Update once per frame */
  update(dt: number) {
    // Update damped parameters BEFORE layers check transitions
    this.params.updateDamping(dt);
    
    // Start layers on first update
    if (!this.started) { for (const l of this.layers) l.start(); this.started = true; }
    
    // Update layers (they can see triggers are still active)
    for (const l of this.layers) l.update(dt);
    
    // Reset triggers AFTER layers have processed them
    this.params.resetTriggers();
    
    // Update mixer
    this.mixer.update(dt);
  }

  set(name: string, value: number|boolean|[number, number]|THREE.Vector2) {
    if (Array.isArray(value)) this.params.set(name, new THREE.Vector2(value[0], value[1]));
    else this.params.set(name, value as any);
  }

  get(name: string) { return this.params.get(name); }

  trigger(name: string) { this.params.trigger(name); }
  resetTrigger(name: string) { this.params.resetTrigger(name); }

  dispose() {
    for (const l of this.layers) l.dispose();
    this.lib.dispose(this.mixer);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
  }
}
