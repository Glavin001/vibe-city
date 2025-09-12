
// Goal is expressed directly as a flexible object, not as a key

// FIXME: Generated types are invalid, property has no initializer.
// import { BunkerGoal } from '@/generated/fluidhtn/bunker-goal';
// import { BunkerInitial } from '@/generated/fluidhtn/bunker-initial';

// Inline types (avoid importing generated TS from build/public)
export interface BunkerGoal {
  agentAt: string;
  hasKey: boolean;
  hasC4: boolean;
  bunkerBreached: boolean;
  hasStar: boolean;
}

export interface BunkerInitial {
  agentAt?: string;
  keyOnTable?: boolean;
  c4Available?: boolean;
  starPresent?: boolean;
  hasKey?: boolean;
  hasC4?: boolean;
  hasStar?: boolean;
  storageUnlocked?: boolean;
  c4Placed?: boolean;
  bunkerBreached?: boolean;
}

// Minimal interface of the C# exports we invoke; avoids depending on generated types
export type DotnetExports = {
  FluidHtnWasm: {
    PlannerBridge: {
      EnablePlannerDebug: (enabled: boolean) => void;
      RunDemo: () => string;
      PlanBunkerGoal: (goalKey: string) => string;
      PlanBunkerJson: (json: string) => string;
      PlanBunkerRequest: (json: string) => string;
    };
  };
};

export async function loadDotnet(dotnetUrl: string) {
  const mod = await import(/* @vite-ignore */ dotnetUrl);
  const { dotnet } = mod as any;
  const { getAssemblyExports, getConfig } = await dotnet.create();
  const config = getConfig();
  const exports = (await getAssemblyExports(config.mainAssemblyName)) as DotnetExports;
  // Enable C# side debug logs only when explicitly requested
  try {
    if (typeof process !== 'undefined' && process?.env?.FLUIDHTN_DEBUG === '1') {
      exports.FluidHtnWasm.PlannerBridge.EnablePlannerDebug(true);
    }
  } catch {}
  return { exports } as { exports: DotnetExports };
}

/*
export async function planGoal(exports: DotnetExports, request: BunkerPlanRequest | BunkerPlanGoal) {
  const req: BunkerPlanRequest = 'goal' in (request as any) || 'initial' in (request as any)
    ? (request as BunkerPlanRequest)
    : { goal: request as BunkerPlanGoal };
  const json = JSON.stringify(req);
  return exports.FluidHtnWasm.PlannerBridge.PlanBunkerRequest(json);
}
*/

/*
export async function planJson(exports: DotnetExports, payload: unknown) {
  const json = JSON.stringify(payload);
  return exports.FluidHtnWasm.PlannerBridge.PlanBunkerJson(json);
}
*/

// Node worker-threaded helpers (non-blocking)
export type WorkerPlanCmd =
  | { cmd: 'init'; dotnetUrl: string }
  | { cmd: 'runDemo'; dotnetUrl: string }
  | { cmd: 'planJson'; dotnetUrl: string; json: string }
  | { cmd: 'planRequest'; dotnetUrl: string; json: string };

export async function withFluidWorker<T = any>(dotnetUrl: string, message: WorkerPlanCmd): Promise<T> {
  const { Worker } = await import('worker_threads');
  const worker = new Worker(new URL('./fluidhtn-worker.mjs', import.meta.url));
  try {
    // Initialize
    await new Promise<void>((resolve, reject) => {
      const onMsg = (m: any) => {
        if (m?.type === 'ready') {
          worker.off('message', onMsg);
          resolve();
        } else if (m?.type === 'error') {
          worker.off('message', onMsg);
          reject(new Error(m.error));
        }
      };
      worker.on('message', onMsg);
      worker.postMessage({ cmd: 'init', dotnetUrl });
    });

    // Run command
    return await new Promise<T>((resolve, reject) => {
      const onMsg = (m: any) => {
        if (m?.type === 'result') {
          worker.off('message', onMsg);
          resolve(m.result as T);
        } else if (m?.type === 'error') {
          worker.off('message', onMsg);
          reject(new Error(m.error));
        }
      };
      worker.on('message', onMsg);
      worker.postMessage(message);
    });
  } finally {
    worker.terminate();
  }
}

export async function runDemoOnWorker(dotnetUrl: string) {
  return withFluidWorker<string>(dotnetUrl, { cmd: 'runDemo', dotnetUrl } as WorkerPlanCmd);
}

export async function planGoalOnWorker(dotnetUrl: string, request: BunkerPlanRequest) {
  const res = await planRequestOnWorker(dotnetUrl, request);
  // console.log('planGoalOnWorker', request, res);
  return res;
}

export async function planJsonOnWorker(dotnetUrl: string, payload: unknown) {
  const json = JSON.stringify(payload);
  return withFluidWorker<string>(dotnetUrl, { cmd: 'planJson', dotnetUrl, json } as WorkerPlanCmd);
}

// High-level request type matching C# BunkerPlanRequest
export type BunkerPlanInitial = Partial<BunkerInitial>;

/**
 * Goal state for the Bunker planner.
 *
 * Possible values:
 * - agentAt: string (node id, e.g. 'courtyard', 'table_area', 'storage_door', 'storage_interior', 'c4_table', 'bunker_door', 'bunker_interior', 'star_pos', 'blast_safe_zone')
 * - hasKey: boolean
 * - hasC4: boolean
 * - bunkerBreached: boolean
 * - hasStar: boolean
 */
export type BunkerPlanGoal = Partial<BunkerGoal>;

export type BunkerPlanRequest = {
  initial?: BunkerPlanInitial;
  goal?: BunkerPlanGoal;
};

// Matches C# PlanResultJson
export type PlanResultJson = {
  error?: string;
  done: boolean;
  plan?: string[];
  logs: string[];
  finalState: Record<string, unknown>;
};

export function parsePlanResult(json: string): PlanResultJson {
  try {
    const obj = JSON.parse(json);
    return obj as PlanResultJson;
  } catch (err) {
    throw new Error(`Invalid PlanResultJson: ${(err as Error)?.message || String(err)}`);
  }
}

export async function planRequest(exports: DotnetExports, request: BunkerPlanRequest) {
  const json = JSON.stringify(request);
  const res = exports.FluidHtnWasm.PlannerBridge.PlanBunkerRequest(json);
  return parsePlanResult(res);
}

export async function planRequestOnWorker(dotnetUrl: string, request: BunkerPlanRequest) {
  const json = JSON.stringify(request);
  return withFluidWorker<PlanResultJson>(dotnetUrl, { cmd: 'planRequest', dotnetUrl, json } as WorkerPlanCmd);
}

// Removed key-based mapping in favor of flexible goal object API
