// Browse models: paginated trending models grid.

import * as api from '../lib/hf-api.js';
import { wireSort } from '../lib/sort.js';

export function render(container) {
  container.innerHTML = '<div class="loading">Loading models...</div>';
  let cancelled = false;

  api.trendingModels(50).then(results => {
    if (cancelled) return;
    const models = results.filter(m => m.id);

    let html = `<div style="margin-bottom:16px">
      <span style="font-size:16px;font-weight:800">Trending models</span>
      <span style="font-size:11px;color:var(--dm);margin-left:8px">${models.length} models</span>
    </div>`;

    html += `<table class="mt" id="models-table">
      <thead><tr>
        <th>Model</th><th>Task</th><th>Params</th><th>Likes</th><th>Downloads</th><th>Providers</th>
      </tr></thead>
      <tbody>`;

    for (const m of models) {
      const parts = m.id.split('/');
      const org = parts.length > 1 ? parts[0] : '';
      const name = parts.length > 1 ? parts.slice(1).join('/') : m.id;
      const params = m.safetensors?.total;
      const provCount = Array.isArray(m.inferenceProviderMapping)
        ? m.inferenceProviderMapping.filter(p => p.status === 'live').length : 0;

      html += `<tr>
        <td class="name"><a class="link" href="#/model/${esc(m.id)}">${org ? `<span style="color:var(--mt);font-weight:400">${esc(org)}/</span>` : ''}${esc(name)}</a></td>
        <td>${esc(m.pipeline_tag || '')}</td>
        <td>${params ? fmtP(params) : ''}</td>
        <td>${m.likes ? fmtNum(m.likes) : ''}</td>
        <td>${m.downloads ? fmtNum(m.downloads) : ''}</td>
        <td>${provCount || ''}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    wireSort(container.querySelector('#models-table'));
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed: ${esc(err.message)}</div>`;
  });

  return () => { cancelled = true; };
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtP(n) {
  if (n >= 1e9) {
    const b = n / 1e9;
    return b >= 100 ? `${b.toFixed(0)}B` : `${b.toFixed(1)}B`;
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return `${(n / 1e3).toFixed(0)}K`;
}

function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
