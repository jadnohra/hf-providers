// Landing page: loads the top model and shows its full detail view.
// Uses pre-cached state.models when available, falls back to API.

import * as api from '../lib/hf-api.js';
import { render as renderModel } from './model.js';
import { state } from '../app.js';

export function render(container) {
  // Use cached top model if available
  if (state.models && state.models.length) {
    const modelId = state.models[0].id;
    return renderModel(container, [null, modelId]);
  }

  container.innerHTML = '<div class="loading">Loading...</div>';
  let cancelled = false;

  api.trendingModels(1).then(results => {
    if (cancelled) return;
    if (!results.length || !results[0].id) {
      container.innerHTML = '<div class="loading">No trending models found</div>';
      return;
    }
    const modelId = results[0].id;
    renderModel(container, [null, modelId]);
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed to load: ${err.message}</div>`;
  });

  return () => { cancelled = true; };
}
