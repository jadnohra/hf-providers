// Thin wrapper around the wasm-bindgen generated module.

let wasm = null;

export async function load() {
  const mod = await import('../pkg/hf_providers.js');
  await mod.default();
  wasm = mod;
}

export function findGpu(gpus, input) {
  return wasm.find_gpu(gpus, input);
}

export function estimatePerf(gpu, params, quant, runtime) {
  return wasm.estimate_perf(gpu, params, quant, runtime);
}

export function bestQuant(gpu, params, runtime) {
  return wasm.best_quant(gpu, params, runtime);
}

export function machineReport(gpu) {
  return wasm.machine_report(gpu);
}

export function getReferenceModels() {
  return wasm.get_reference_models();
}

export function generateSnippet(modelId, provider, lang) {
  return wasm.generate_snippet(modelId, provider, lang);
}

export function costPerMillion(priceHr, tokS) {
  return wasm.cost_per_million(priceHr, tokS);
}

export function fmtParams(n) {
  return wasm.fmt_params(n);
}

export function paramHint(name) {
  return wasm.param_hint(name);
}
