// Browse all hardware: sortable table of every GPU/chip in the registry.

import { wireSort } from '../lib/sort.js';
import { state } from '../app.js';

export function render(container) {
  const gpus = state.hardware || [];
  if (!gpus.length) {
    container.innerHTML = '<div class="loading">No hardware data loaded</div>';
    return;
  }

  let html = '';

  // "Your hardware" section if GPU detected
  const my = state.myGpu;
  if (my && my.key && my.gpu) {
    const g = my.gpu;
    html += `<div class="sec" style="margin-bottom:16px">
      <div class="sec-head"><span class="sec-q">Your hardware</span><div class="sec-line"></div></div>
      <a class="your-hw" href="#/hw/${esc(my.key)}">
        <span class="your-hw-name">${esc(g.name)}</span>
        <span class="your-hw-specs">${g.vram_gb} GB \u00b7 ${Math.round(g.mem_bw_gb_s)} GB/s \u00b7 ${g.fp16_tflops.toFixed(1)} TFLOPS</span>
      </a>
    </div>`;
  }

  html += `<div style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
    <span style="font-size:16px;font-weight:800">All hardware</span>
    <span style="font-size:11px;color:var(--dm)">${gpus.length} entries</span>
    <input class="search" id="filter-hw" placeholder="Filter..." autocomplete="off" style="margin-left:auto;padding:5px 10px;font-size:11px;max-width:200px">
  </div>`;

  html += `<table class="mt" id="hw-table">
    <thead><tr>
      <th>Name</th><th>Vendor</th><th>VRAM</th><th>BW (GB/s)</th><th>FP16 TFLOPS</th><th>TDP</th><th>Street $</th>
    </tr></thead>
    <tbody>`;

  const myKey = state.myGpu && state.myGpu.key;
  for (const [key, gpu] of gpus) {
    const yours = key === myKey ? ' <span class="hw-yours">(yours)</span>' : '';
    html += `<tr>
      <td class="name"><a class="link" href="#/hw/${esc(key)}" data-tip="${esc(gpu.vram_gb + ' GB VRAM \u00b7 ' + Math.round(gpu.mem_bw_gb_s) + ' GB/s \u00b7 ' + gpu.fp16_tflops.toFixed(1) + ' TFLOPS \u00b7 ' + gpu.tdp_w + 'W' + (gpu.street_usd ? ' \u00b7 ~$' + gpu.street_usd.toLocaleString() : ''))}">${esc(gpu.name)}</a>${yours}</td>
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
  wireFilter(container);
}

function wireFilter(container) {
  const input = container.querySelector('#filter-hw');
  const table = container.querySelector('#hw-table');
  if (!input || !table) return;

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    table.querySelectorAll('tbody tr').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  });
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
