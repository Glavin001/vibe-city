import { parentPort } from 'worker_threads';

let exportsRef = null;

async function ensureExports(dotnetUrl) {
  if (exportsRef) return exportsRef;
  const { dotnet } = await import(dotnetUrl);
  const { getAssemblyExports, getConfig } = await dotnet.create();
  const config = getConfig();
  exportsRef = await getAssemblyExports(config.mainAssemblyName);
  try {
    if (process?.env?.FLUIDHTN_DEBUG === '1') {
      exportsRef.FluidHtnWasm.PlannerBridge.EnablePlannerDebug(true);
    }
  } catch {}
  return exportsRef;
}

parentPort.on('message', async (msg) => {
  try {
    const { cmd } = msg || {};
    if (cmd === 'init') {
      await ensureExports(msg.dotnetUrl);
      parentPort.postMessage({ type: 'ready' });
      return;
    }
    if (cmd === 'runDemo') {
      const E = await ensureExports(msg.dotnetUrl);
      const result = E.FluidHtnWasm.PlannerBridge.RunDemo();
      parentPort.postMessage({ type: 'result', result });
      return;
    }
    if (cmd === 'planGoal') {
      const E = await ensureExports(msg.dotnetUrl);
      const result = E.FluidHtnWasm.PlannerBridge.PlanBunkerGoal(msg.goalKey);
      parentPort.postMessage({ type: 'result', result });
      return;
    }
    if (cmd === 'planJson') {
      const E = await ensureExports(msg.dotnetUrl);
      const result = E.FluidHtnWasm.PlannerBridge.PlanBunkerJson(msg.json);
      parentPort.postMessage({ type: 'result', result });
      return;
    }
    if (cmd === 'planRequest') {
      const E = await ensureExports(msg.dotnetUrl);
      const json = typeof msg.json === 'string' ? msg.json : JSON.stringify(msg.json ?? msg.request ?? {});
      const resultJson = E.FluidHtnWasm.PlannerBridge.PlanBunkerRequest(json);
      let result;
      try {
        result = JSON.parse(resultJson);
      } catch (err) {
        result = { error: 'InvalidJSON', done: false, logs: [], finalState: {}, raw: String(resultJson || '') };
      }
      parentPort.postMessage({ type: 'result', result });
      return;
    }
    parentPort.postMessage({ type: 'error', error: `Unknown cmd ${cmd}` });
  } catch (err) {
    parentPort.postMessage({ type: 'error', error: String(err?.message || err) });
  }
});


