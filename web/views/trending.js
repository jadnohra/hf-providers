// Landing page: loads the top model and shows its full detail view.
// Uses pre-cached state.models when available, falls back to API.

import * as api from '../lib/hf-api.js';
import { render as renderModel } from './model.js';
import { state } from '../app.js';

export function render(container) {
  const DEFAULT_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

  // Use default model if available in cache, otherwise first cached model with params
  if (state.models && state.models.length) {
    const defaultMatch = state.models.find(m => m.id === DEFAULT_MODEL);
    const modelId = defaultMatch ? DEFAULT_MODEL
      : (state.models.find(m => m.safetensors?.total) || state.models[0]).id;
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
