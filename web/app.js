// Boot: load Wasm + data, init router + search.

import * as wasm from './lib/wasm.js';
import * as router from './lib/router.js';
import * as search from './lib/search.js';
import { initGlobalTip } from './lib/tips.js';
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

    // Update hero subtitle with actual counts
    const modelCount = state.models ? state.models.length : '';
    const sub = document.getElementById('hero-sub');
    if (sub) {
      sub.innerHTML = `<a href="#/providers">19 providers</a> · <a href="#/hardware">${state.hardware.length} hardware configs</a> · <a href="#/cloud">${state.cloud.length} cloud offerings</a>`
        + (modelCount ? ` · <a href="#/models">${modelCount} models</a>` : '') + ' \u2014 compared in one place';
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
