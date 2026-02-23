// Browse all cloud GPU rental offerings: sortable table with pricing, GPU specs.

import { wireSort } from '../lib/sort.js';
import { state } from '../app.js';

export function render(container) {
  const cloud = state.cloud || [];
  const gpus = state.hardware || [];
  if (!cloud.length) {
    container.innerHTML = '<div class="loading">No cloud data loaded</div>';
    return;
  }

  let html = `<div style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
    <span style="font-size:16px;font-weight:800">All cloud offerings</span>
    <span style="font-size:11px;color:var(--dm)">${cloud.length} offerings</span>
    <input class="search" id="filter-cloud" placeholder="Filter..." autocomplete="off" style="margin-left:auto;padding:5px 10px;font-size:11px;max-width:200px">
  </div>`;

  html += `<table class="mt" id="cloud-table">
    <thead><tr>
      <th>Offering</th><th>Provider</th><th>GPU</th><th>GPUs</th><th>VRAM</th><th>$/hr</th><th>Spot $/hr</th><th>Region</th>
    </tr></thead>
    <tbody>`;

  for (const [, o] of cloud) {
    const gpuEntry = gpus.find(([k]) => k === o.gpu);
    const gpuName = gpuEntry ? gpuEntry[1].name : o.gpu;
    const gpuSpec = gpuEntry ? gpuEntry[1] : null;
    const totalVram = gpuSpec ? gpuSpec.vram_gb * o.gpu_count : '';
    const gpuTitle = gpuSpec
      ? gpuSpec.vram_gb + ' GB VRAM \u00b7 ' + Math.round(gpuSpec.mem_bw_gb_s) + ' GB/s \u00b7 ' + gpuSpec.fp16_tflops.toFixed(1) + ' TFLOPS'
      : '';
    const region = Array.isArray(o.region) ? o.region.join(', ') : '';
    const totalPrice = o.price_hr * o.gpu_count;
    const spotTotal = o.spot_hr ? o.spot_hr * o.gpu_count : null;

    html += `<tr>
      <td class="name">${o.url ? `<a class="link" href="${esc(o.url)}" target="_blank" rel="noopener" data-tip="${esc(o.name + (o.interconnect ? ' \u00b7 ' + o.interconnect : ''))}">${esc(o.name)}</a>` : esc(o.name)}</td>
      <td>${esc(o.provider)}</td>
      <td><a class="link" href="#/hw/${esc(o.gpu)}" data-tip="${esc(gpuTitle)}">${esc(gpuName)}</a></td>
      <td>${o.gpu_count > 1 ? o.gpu_count + 'x' : '1'}</td>
      <td>${totalVram ? totalVram + ' GB' : ''}</td>
      <td data-sort="${totalPrice}">$${totalPrice.toFixed(2)}</td>
      <td>${spotTotal != null ? '$' + spotTotal.toFixed(2) : ''}</td>
      <td>${esc(region)}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  wireSort(container.querySelector('#cloud-table'));
  wireFilter(container);
}

function wireFilter(container) {
  const input = container.querySelector('#filter-cloud');
  const table = container.querySelector('#cloud-table');
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
