// Module worker that loads the Fluid HTN WASM AppBundle and returns a bunker plan
// Requires the AppBundle to be served at /fluidhtn/_framework/

self.onmessage = async (e) => {
  // const MODULE_PATH = '/fluidhtn/_framework/dotnet.js';
  const MODULE_PATH = '/planner/_framework/dotnet.js';

  const { type, goalKey, request, json, enableDebug } = e.data || {};
  if (type !== 'plan' && type !== 'planRequest' && type !== 'planJson' && type !== 'runDemo') return;
  const t0 = performance.now();
  try {
    console.log('[fluid-htn.worker] plan: start', { type, goalKey, enableDebug });
    let dotnetModule;
    try {
      dotnetModule = await import(MODULE_PATH);
    } catch (err) {
      // Fallback to relative path if hosted differently
      console.warn('[fluid-htn.worker] primary import failed; trying relative', err);
      dotnetModule = await import(`../${MODULE_PATH}`);
    }
    const { dotnet } = dotnetModule;
    const { getAssemblyExports, getConfig } = await dotnet.create();
    const config = getConfig();
    const exports = await getAssemblyExports(config.mainAssemblyName);

    // Optional: enable C#-side debug output (will prefix lines with #)
    try {
      if (enableDebug === true) {
        exports.FluidHtnWasm.PlannerBridge.EnablePlannerDebug(true);
        console.log('[fluid-htn.worker] Enabled PlannerBridge debug');
      }
    } catch (err) {
      console.warn('[fluid-htn.worker] EnablePlannerDebug failed', err);
    }

    let planText;
    if (type === 'runDemo') {
      // Return demo action list as comma-separated string
      const demo = exports.FluidHtnWasm.PlannerBridge.RunDemo();
      const actions = String(demo || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const t1 = performance.now();
      self.postMessage({ type: 'result', demo, actions, elapsedMs: Math.round(t1 - t0) });
      return;
    } else if (type === 'planRequest') {
      const payload = typeof request === 'string' ? request : JSON.stringify(request || {});
      console.log('[fluid-htn.worker] calling PlanBunkerRequest');
      planText = exports.FluidHtnWasm.PlannerBridge.PlanBunkerRequest(payload);
      // New JSON result shape from C#
      try {
        const result = JSON.parse(String(planText || '{}'));
        const t1 = performance.now();
        if (result && result.error) {
          self.postMessage({ type: 'error', message: String(result.error), elapsedMs: Math.round(t1 - t0), result });
          return;
        }
        self.postMessage({ type: 'result', result, steps: Array.isArray(result?.plan) ? result.plan : [], elapsedMs: Math.round(t1 - t0) });
        return;
      } catch (err) {
        // Fallthrough to legacy parsing
        console.error(err)
      }
    } else if (type === 'planJson') {
      const payload = typeof json === 'string' ? json : JSON.stringify(json || {});
      console.log('[fluid-htn.worker] calling PlanBunkerJson');
      planText = exports.FluidHtnWasm.PlannerBridge.PlanBunkerJson(payload);
    } else if (goalKey) {
      console.log('[fluid-htn.worker] calling PlanBunkerGoal', goalKey);
      planText = exports.FluidHtnWasm.PlannerBridge.PlanBunkerGoal(goalKey);
    } else {
      console.log('[fluid-htn.worker] calling PlanBunker (demo mission)');
      planText = exports.FluidHtnWasm.PlannerBridge.PlanBunker();
    }

    // Legacy text result fallback: Filter lines; drop empty and debug lines beginning with '#'
    const allLines = (planText || '').split('\n');
    const steps = allLines.map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    const t1 = performance.now();
    console.log('[fluid-htn.worker] plan: done', { elapsedMs: Math.round(t1 - t0), stepsCount: steps.length });
    if (enableDebug) {
      console.log('[fluid-htn.worker] plan lines:', steps);
    }
    self.postMessage({ type: 'result', steps, elapsedMs: Math.round(t1 - t0) });
  } catch (err) {
    const t1 = performance.now();
    console.error('[fluid-htn.worker] plan: error', err);
    self.postMessage({ type: 'error', message: String(err?.message || err), elapsedMs: Math.round(t1 - t0) });
  }
};


