// Browse all providers: sortable table with static metadata + live model counts.

import * as api from '../lib/hf-api.js';
import { wireSort } from '../lib/sort.js';

const PROVIDERS = [
  { id: 'cerebras', name: 'Cerebras', focus: 'Fast inference', tasks: 'text' },
  { id: 'cohere', name: 'Cohere', focus: 'Enterprise NLP', tasks: 'text, embed' },
  { id: 'fal-ai', name: 'fal', focus: 'Image/video generation', tasks: 'image, video' },
  { id: 'featherless-ai', name: 'Featherless', focus: 'Open models', tasks: 'text' },
  { id: 'fireworks-ai', name: 'Fireworks', focus: 'Fast + cheap', tasks: 'text, image' },
  { id: 'groq', name: 'Groq', focus: 'Ultra-fast (LPU)', tasks: 'text' },
  { id: 'hyperbolic', name: 'Hyperbolic', focus: 'Open models', tasks: 'text, image' },
  { id: 'nebius', name: 'Nebius', focus: 'EU cloud', tasks: 'text, image, embed' },
  { id: 'novita', name: 'Novita', focus: 'Low cost', tasks: 'text, image' },
  { id: 'nscale', name: 'Nscale', focus: 'EU cloud', tasks: 'text' },
  { id: 'ovhcloud', name: 'OVHcloud', focus: 'EU sovereign', tasks: 'text' },
  { id: 'publicai', name: 'Public AI', focus: 'Open models', tasks: 'text' },
  { id: 'replicate', name: 'Replicate', focus: 'Broad model zoo', tasks: 'text, image, audio' },
  { id: 'sambanova', name: 'SambaNova', focus: 'Fast inference', tasks: 'text' },
  { id: 'scaleway', name: 'Scaleway', focus: 'EU cloud', tasks: 'text' },
  { id: 'together', name: 'Together AI', focus: 'Open models + fine-tuning', tasks: 'text, image, embed' },
  { id: 'wavespeed', name: 'WaveSpeed', focus: 'Image generation', tasks: 'image' },
  { id: 'zai-org', name: 'Z.ai', focus: 'Open models', tasks: 'text' },
  { id: 'hf-inference', name: 'HF Inference', focus: 'HF native', tasks: 'text, image, audio, embed' },
];

export function render(container) {
  let html = `<div style="margin-bottom:16px">
    <span style="font-size:16px;font-weight:800">All providers</span>
    <span style="font-size:11px;color:var(--dm);margin-left:8px">${PROVIDERS.length} inference providers</span>
  </div>`;

  html += `<table class="mt" id="prov-table">
    <thead><tr>
      <th>Provider</th><th>Focus</th><th>Tasks</th><th>Live models</th>
    </tr></thead>
    <tbody>`;

  for (const p of PROVIDERS) {
    html += `<tr>
      <td class="name"><a class="link" href="#/provider/${esc(p.id)}">${esc(p.name)}</a></td>
      <td>${esc(p.focus)}</td>
      <td>${esc(p.tasks)}</td>
      <td class="prov-count" data-id="${esc(p.id)}"><span style="color:var(--dm)">...</span></td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  wireSort(container.querySelector('#prov-table'));

  // Fetch live model counts in parallel (small requests, limit=1 just to count)
  for (const p of PROVIDERS) {
    api.modelsByProvider(p.id, 200).then(results => {
      const td = container.querySelector(`.prov-count[data-id="${p.id}"]`);
      if (td) td.textContent = String(results.length);
    }).catch(() => {
      const td = container.querySelector(`.prov-count[data-id="${p.id}"]`);
      if (td) td.textContent = '';
    });
  }
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
