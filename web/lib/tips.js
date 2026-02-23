// Tooltip helpers for hover info across views.
// Global floating tooltip: any element with data-tip="text" gets a styled tooltip on hover.
// Also supports tip() helper that sets data-tip inline.

import * as wasm from './wasm.js';
import { state } from '../app.js';

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

// Global floating tooltip element (created once, positioned via JS)
let tipEl = null;

export function initGlobalTip() {
  tipEl = document.createElement('div');
  tipEl.className = 'gtip';
  document.body.appendChild(tipEl);

  document.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-tip]');
    if (!target) { tipEl.style.display = 'none'; return; }
    const text = target.dataset.tip;
    if (!text) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = esc(text).replace(/ · /g, ' &middot; ').replace(/\n/g, '<br>');
    tipEl.style.display = 'block';
    const rect = target.getBoundingClientRect();
    const tipRect = tipEl.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    if (left < 4) left = 4;
    if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - 4 - tipRect.width;
    let top = rect.top - tipRect.height - 6;
    if (top < 4) top = rect.bottom + 6;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  });

  document.addEventListener('mouseout', e => {
    const target = e.target.closest('[data-tip]');
    if (target && !target.contains(e.relatedTarget)) {
      tipEl.style.display = 'none';
    }
  });
}

/// Wrap content with data-tip attribute. `lines` is an array of strings.
export function tip(innerHtml, lines) {
  if (!lines || !lines.length) return innerHtml;
  const text = lines.join(' \u00b7 ');
  return `<span data-tip="${esc(text)}">${innerHtml}</span>`;
}

/// Build tooltip lines for a hardware key.
export function hwTip(gpuKey) {
  const gpus = state.hardware || [];
  const entry = gpus.find(([k]) => k === gpuKey);
  if (!entry) return null;
  const [, gpu] = entry;
  return hwTipFromSpec(gpu);
}

export function hwTipFromSpec(gpu) {
  const lines = [
    gpu.name,
    `${gpu.vram_gb} GB VRAM · ${Math.round(gpu.mem_bw_gb_s)} GB/s`,
    `${gpu.fp16_tflops.toFixed(1)} TFLOPS · ${gpu.tdp_w}W`,
  ];
  if (gpu.street_usd) lines.push(`~$${gpu.street_usd.toLocaleString()} street`);
  return lines;
}

/// Build tooltip lines for a provider (given provider info from a model).
export function providerTip(prov) {
  const lines = [prov.name];
  if (prov.throughput != null) lines.push(`${Math.round(prov.throughput)} tok/s`);
  if (prov.outputPrice != null) lines.push(`$${prov.outputPrice.toFixed(2)}/1M out`);
  if (prov.latency != null) lines.push(`${Math.round(prov.latency * 1000)}ms TTFT`);
  if (prov.supportsTools === true) lines.push('Tool use: yes');
  if (prov.supportsStructured === true) lines.push('JSON mode: yes');
  return lines;
}

/// Build tooltip lines for a model (given parsed model object).
export function modelTip(model) {
  const lines = [model.id];
  if (model.safetensorsParams) lines.push(fmtP(model.safetensorsParams) + ' params');
  if (model.pipelineTag) lines.push(model.pipelineTag);
  const liveCount = model.providers.filter(p => p.status === 'live').length;
  if (liveCount) lines.push(liveCount + ' provider' + (liveCount > 1 ? 's' : ''));
  return lines;
}

/// Build tooltip for a model by its param count + name (for reference models in hw view).
export function refModelTip(short, params, gpuSpec) {
  const lines = [short, fmtP(params) + ' params'];
  if (gpuSpec) {
    const runtimes = [];
    if (gpuSpec.mlx_decode_eff != null) runtimes.push('mlx');
    runtimes.push('llama.cpp');
    for (const rt of runtimes) {
      const result = wasm.bestQuant(gpuSpec, params, rt);
      if (result) {
        const [q, est] = result;
        const decode = est.decode_tok_s ? Math.round(est.decode_tok_s) + ' tok/s' : '';
        lines.push(`${rt}: ${q} ${est.weight_gb.toFixed(0)}GB ${decode}`);
      } else {
        lines.push(`${rt}: doesn't fit`);
      }
    }
  }
  return lines;
}
