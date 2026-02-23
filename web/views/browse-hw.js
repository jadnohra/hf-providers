// Browse all hardware: sortable table of every GPU/chip in the registry.

import * as wasm from '../lib/wasm.js';
import { wireSort } from '../lib/sort.js';
import { state } from '../app.js';

export function render(container) {
  const gpus = state.hardware || [];
  if (!gpus.length) {
    container.innerHTML = '<div class="loading">No hardware data loaded</div>';
    return;
  }

  let html = `<div style="margin-bottom:16px">
    <span style="font-size:16px;font-weight:800">All hardware</span>
    <span style="font-size:11px;color:var(--dm);margin-left:8px">${gpus.length} entries</span>
  </div>`;

  html += `<table class="mt" id="hw-table">
    <thead><tr>
      <th>Name</th><th>Vendor</th><th>VRAM</th><th>BW (GB/s)</th><th>FP16 TFLOPS</th><th>TDP</th><th>Street $</th>
    </tr></thead>
    <tbody>`;

  for (const [key, gpu] of gpus) {
    html += `<tr>
      <td class="name"><a class="link" href="#/hw/${esc(key)}">${esc(gpu.name)}</a></td>
      <td>${esc(gpu.vendor)}</td>
      <td>${gpu.vram_gb} GB</td>
      <td>${Math.round(gpu.mem_bw_gb_s)}</td>
      <td>${gpu.fp16_tflops.toFixed(1)}</td>
      <td>${gpu.tdp_w}W</td>
      <td>${gpu.street_usd ? '$' + gpu.street_usd.toLocaleString() : ''}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  wireSort(container.querySelector('#hw-table'));
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
