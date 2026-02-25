// Boot: load Wasm + data, init router + search.

import * as wasm from './lib/wasm.js';
import * as router from './lib/router.js';
import * as search from './lib/search.js';
import { initGlobalTip } from './lib/tips.js';
import { detectGpu } from './lib/gpu-detect.js';
import { render as renderTrending } from './views/trending.js';
import { render as renderModel } from './views/model.js';
import { render as renderHardware } from './views/hardware.js';
import { render as renderProvider } from './views/provider.js';
import { render as renderBrowseModels } from './views/browse-models.js';
import { render as renderBrowseHw } from './views/browse-hw.js';
import { render as renderBrowseProviders } from './views/browse-providers.js';
import { render as renderBrowseCloud } from './views/browse-cloud.js';
import { render as renderStats } from './views/stats.js';

export const state = {
  hardware: null,
  cloud: null,
  models: null,
  myGpu: null,
};

async function boot() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const [, hwResp, clResp] = await Promise.all([
      wasm.load(),
      fetch('data/hardware.json'),
      fetch('data/cloud.json'),
    ]);

    state.hardware = await hwResp.json();
    state.cloud = await clResp.json();

    // Models cache is optional (needs fetch-models.py to be run)
    try {
      const mdResp = await fetch('data/models.json');
      if (mdResp.ok) state.models = await mdResp.json();
    } catch {}

    // Detect user's GPU via WebGL
    state.myGpu = detectGpu(state.hardware);

    // Update hero subtitle with actual counts
    const modelCount = state.models ? state.models.length : '';
    const sub = document.getElementById('hero-sub');
    if (sub) {
      const parts = [];
      if (state.myGpu && state.myGpu.key && !state.myGpu.needsPicker) {
        parts.push(`<a href="#/hw/${state.myGpu.key}">${state.myGpu.gpu.name}</a>`);
      }
      parts.push(`<a href="#/providers">19 providers</a>`);
      parts.push(`<a href="#/hardware">${state.hardware.length} hardware configs</a>`);
      parts.push(`<a href="#/cloud">${state.cloud.length} cloud offerings</a>`);
      if (modelCount) parts.push(`<a href="#/models">${modelCount} models</a>`);
      sub.innerHTML = parts.join(' \u00b7 ') + ' \u2014 compared in one place';
    }

  } catch (err) {
    content.innerHTML = `<div class="loading">Failed to load: ${err.message}</div>`;
    return;
  }

  // Register routes
  router.register(/^\/$/, renderTrending);
  router.register(/^\/models$/, renderBrowseModels);
  router.register(/^\/hardware$/, renderBrowseHw);
  router.register(/^\/providers$/, renderBrowseProviders);
  router.register(/^\/cloud$/, renderBrowseCloud);
  router.register(/^\/stats$/, renderStats);
  router.register(/^\/model\/(.+)$/, renderModel);
  router.register(/^\/hw\/(.+)$/, renderHardware);
  router.register(/^\/provider\/(.+)$/, renderProvider);

  // Init search + global tooltips
  search.init();
  initGlobalTip();

  // Start routing
  router.start();
}

boot();
