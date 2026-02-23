// Boot: load Wasm + data, init router + search.

import * as wasm from './lib/wasm.js';
import * as router from './lib/router.js';
import * as search from './lib/search.js';
import { render as renderTrending } from './views/trending.js';
import { render as renderModel } from './views/model.js';
import { render as renderHardware } from './views/hardware.js';
import { render as renderProvider } from './views/provider.js';
import { render as renderBrowseModels } from './views/browse-models.js';
import { render as renderBrowseHw } from './views/browse-hw.js';
import { render as renderBrowseProviders } from './views/browse-providers.js';

export const state = {
  hardware: null,
  cloud: null,
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

    // Update hero subtitle with actual counts
    const sub = document.getElementById('hero-sub');
    if (sub) {
      sub.textContent = `19 providers · ${state.hardware.length} hardware configs · ${state.cloud.length} cloud offerings — compared in one place`;
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
  router.register(/^\/model\/(.+)$/, renderModel);
  router.register(/^\/hw\/(.+)$/, renderHardware);
  router.register(/^\/provider\/(.+)$/, renderProvider);

  // Init search
  search.init();

  // Start routing
  router.start();
}

boot();
