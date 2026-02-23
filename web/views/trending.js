// Landing page: loads the top trending model and shows its full detail view,
// matching the mockup's model view layout.

import * as api from '../lib/hf-api.js';
import { render as renderModel } from './model.js';

export function render(container) {
  container.innerHTML = '<div class="loading">Loading...</div>';
  let cancelled = false;

  api.trendingModels(1).then(results => {
    if (cancelled) return;
    if (!results.length || !results[0].id) {
      container.innerHTML = '<div class="loading">No trending models found</div>';
      return;
    }
    // Render the model detail view for the top trending model.
    const modelId = results[0].id;
    const fakeMatch = [null, modelId];
    renderModel(container, fakeMatch);
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed to load: ${err.message}</div>`;
  });

  return () => { cancelled = true; };
}
