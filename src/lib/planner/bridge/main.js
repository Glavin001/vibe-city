import { dotnet } from './_framework/dotnet.js';

const { getAssemblyExports, getConfig } = await dotnet.create();
const config = getConfig();
const exports = await getAssemblyExports(config.mainAssemblyName);

const result = exports.FluidHtnWasm.PlannerBridge.RunDemo();

if (typeof document !== 'undefined') {
  const el = document.getElementById('out');
  if (el) el.textContent = result;
}
console.log('Fluid HTN plan:', result);


