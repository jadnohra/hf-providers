// Landing page: My Machine card (if GPU detected) + top model detail view.
// Uses pre-cached state.models when available, falls back to API.

import * as api from '../lib/hf-api.js';
import * as wasm from '../lib/wasm.js';
import { render as renderModel } from './model.js';
import { state } from '../app.js';
import { detectGpu, storeChoice, clearStored } from '../lib/gpu-detect.js';

export function render(container) {
  // Insert My Machine card zone above model content
  const mmHtml = renderMyMachine();
  const modelDiv = document.createElement('div');

  if (mmHtml) {
    const mmDiv = document.createElement('div');
    mmDiv.innerHTML = mmHtml;
    container.appendChild(mmDiv);
    wireMyMachine(mmDiv);
    container.appendChild(modelDiv);
  } else {
    container.appendChild(modelDiv);
  }

  // Render model detail into the model div, propagate cleanup
  return renderModelInto(modelDiv);
}

function renderModelInto(container) {
  const DEFAULT_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

  if (state.models && state.models.length) {
    const defaultMatch = state.models.find(m => m.id === DEFAULT_MODEL);
    const modelId = defaultMatch ? DEFAULT_MODEL
      : (state.models.find(m => m.safetensors?.total) || state.models[0]).id;
    return renderModel(container, [null, modelId], { embedded: true });
  }

  container.innerHTML = '<div class="loading">Loading...</div>';
  let cancelled = false;

  api.trendingModels(1).then(results => {
    if (cancelled) return;
    if (!results.length || !results[0].id) {
      container.innerHTML = '<div class="loading">No trending models found</div>';
      return;
    }
    renderModel(container, [null, results[0].id], { embedded: true });
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed to load: ${err.message}</div>`;
  });

  return () => { cancelled = true; };
}

// ── My Machine card ──

function renderMyMachine() {
  const detected = state.myGpu;
  if (!detected) {
    // No GPU detected: show fallback with manual picker
    return renderFallbackCard();
  }
  if (detected.needsPicker) {
    return renderPickerCard(detected);
  }
  return renderFullCard(detected.key, detected.gpu);
}

function renderFallbackCard() {
  return `<div class="sec mm-sec">
    <div class="sec-head">
      <span class="sec-q">What runs on my machine?</span>
      <div class="sec-line"></div>
    </div>
    <div class="search-wrap mm-hw-search" style="max-width:none;margin:0">
      <input class="search mm-hw-input" placeholder="Pick your hardware..." autocomplete="off" style="padding:6px 12px;font-size:11px">
      <div class="dd mm-hw-dd" style="max-height:280px;overflow-y:auto"></div>
    </div>
  </div>`;
}

function renderPickerCard(detected) {
  const chipName = detected.chip.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  let btns = '';
  for (const v of detected.variants) {
    btns += `<button class="mm-mem-btn" data-key="${esc(v.key)}">${v.gpu.vram_gb} GB</button>`;
  }
  return `<div class="sec mm-sec">
    <div class="sec-head">
      <span class="sec-q">${esc(chipName)} detected \u2014 select memory</span>
      <div class="sec-line"></div>
    </div>
    <div class="mm-btns">${btns}</div>
  </div>`;
}

function renderFullCard(key, gpu) {
  const report = wasm.machineReport(gpu);
  if (!report || !report.length) return null;

  const comfortable = [];
  const tight = [];
  const wontRun = [];

  for (const m of report) {
    const fitting = m.results.filter(r => r.fits);
    if (!fitting.length) {
      wontRun.push(m);
      continue;
    }
    const best = fitting.reduce((a, b) => (a.decode || 0) > (b.decode || 0) ? a : b);
    if (best.decode && best.decode >= 30) {
      comfortable.push({ ...m, best });
    } else {
      tight.push({ ...m, best });
    }
  }

  const multiRuntime = gpu.mlx_decode_eff != null;
  const expanded = mmExpanded();
  const totalFit = comfortable.length + tight.length;

  const summary = [];
  if (comfortable.length) summary.push(`${comfortable.length} comfortable`);
  if (tight.length) summary.push(`${tight.length} tight`);
  const summaryHtml = summary.length ? `<span class="mm-summary">${summary.join(', ')}</span>` : '';

  const toggleLabel = expanded ? COLLAPSE_ICON + 'collapse' : EXPAND_ICON + 'expand';

  let html = `<div class="sec mm-sec">
    <div class="sec-head">
      <span class="sec-q">What runs on my <a href="#/hw/${esc(key)}">${esc(gpu.name)}</a>?</span>
      ${summaryHtml}
      <div class="sec-line"></div>
      <button class="mm-expand" data-show-label="${totalFit ? `show ${totalFit} models` : 'show'}">${toggleLabel}</button>
      <button class="mm-change" title="Select memory size">select memory size</button>
    </div>`;

  html += `<div class="mm-body"${expanded ? '' : ' style="display:none"'}>`;
  html += `<table class="mt">
    <thead><tr><th>Model</th><th>Quant</th><th>Decode</th></tr></thead>
    <tbody>`;

  if (comfortable.length) {
    html += `<tr class="group-row"><td colspan="3"><span class="fit-y">comfortable</span> \u2014 fits, 30+ tok/s</td></tr>`;
    for (const m of comfortable) {
      const rt = multiRuntime ? ` (${m.best.runtime})` : '';
      html += `<tr>
        <td class="name"><a class="link" href="#/model/${esc(m.id)}" data-tip="${esc(m.id + ' \u00b7 ' + fmtP(m.params) + ' params')}">${esc(m.short)}</a></td>
        <td>${m.best.quant || ''}</td>
        <td>${m.best.decode ? Math.round(m.best.decode) + ' tok/s' + rt : ''}</td>
      </tr>`;
    }
  }

  if (tight.length) {
    html += `<tr class="group-row"><td colspan="3"><span class="fit-t">tight</span> \u2014 fits, &lt;30 tok/s</td></tr>`;
    for (const m of tight) {
      const rt = multiRuntime ? ` (${m.best.runtime})` : '';
      html += `<tr>
        <td class="name"><a class="link" href="#/model/${esc(m.id)}" data-tip="${esc(m.id + ' \u00b7 ' + fmtP(m.params) + ' params')}">${esc(m.short)}</a></td>
        <td>${m.best.quant || ''}</td>
        <td>${m.best.decode ? Math.round(m.best.decode) + ' tok/s' + rt : ''}</td>
      </tr>`;
    }
  }

  if (wontRun.length) {
    html += `<tr class="group-row"><td colspan="3"><span class="fit-n">won't run</span> \u2014 doesn't fit</td></tr>`;
    for (const m of wontRun) {
      html += `<tr>
        <td class="name" style="color:var(--dm)" data-tip="${esc(m.id + ' \u00b7 ' + fmtP(m.params) + ' params')}">${esc(m.short)}</td>
        <td style="color:var(--dm)">\u2014</td>
        <td style="color:var(--dm)">\u2014</td>
      </tr>`;
    }
  }

  html += '</tbody></table></div></div>';
  return html;
}

function wireMyMachine(container) {
  // Collapse toggle
  container.querySelectorAll('.mm-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.closest('.mm-sec');
      const body = sec && sec.querySelector('.mm-body');
      if (!body) return;
      const wasCollapsed = body.style.display === 'none';
      body.style.display = wasCollapsed ? '' : 'none';
      btn.innerHTML = wasCollapsed ? COLLAPSE_ICON + 'collapse' : EXPAND_ICON + 'expand';
      setMmExpanded(wasCollapsed);
    });
  });

  // Change button (re-detect)
  container.querySelectorAll('.mm-change').forEach(btn => {
    btn.addEventListener('click', () => {
      clearStored();
      state.myGpu = detectGpu(state.hardware);
      rerender();
    });
  });

  // Memory picker buttons
  container.querySelectorAll('.mm-mem-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectHwKey(btn.dataset.key);
    });
  });

  // Fallback hardware search dropdown
  wireHwSearch(container);
}

function selectHwKey(key) {
  storeChoice(key);
  const entry = (state.hardware || []).find(([k]) => k === key);
  if (entry) {
    state.myGpu = { key: entry[0], gpu: entry[1] };
    rerender();
  }
}

function rerender() {
  const content = document.getElementById('content');
  if (content) {
    content.innerHTML = '';
    render(content);
  }
}

function wireHwSearch(container) {
  const input = container.querySelector('.mm-hw-input');
  const dd = container.querySelector('.mm-hw-dd');
  if (!input || !dd) return;

  const gpus = state.hardware || [];
  const popular = ['rtx_4090', 'rtx_5090', 'm4_max_128', 'm4_pro_48', 'm4_pro_24', 'a100_pcie_80_gb', 'h100_sxm5_80_gb', 'rtx_3090', 'rx_7900_xtx'];

  function renderList(query) {
    const q = query.toLowerCase().replace(/[-_ ]/g, '');
    let matches;
    if (!q) {
      matches = popular.map(k => gpus.find(([gk]) => gk === k)).filter(Boolean);
    } else {
      matches = gpus.filter(([key, gpu]) => {
        const k = key.replace(/_/g, '');
        const n = gpu.name.toLowerCase().replace(/[-_ ]/g, '');
        return k.includes(q) || n.includes(q);
      }).slice(0, 12);
    }

    let html = '';
    for (const [key, gpu] of matches) {
      html += `<div class="dd-item" data-key="${esc(key)}">
        <div class="dd-name">${esc(gpu.name)}</div>
        <div class="dd-hint">${gpu.vram_gb}GB \u00b7 ${esc(gpu.vendor)}</div>
      </div>`;
    }
    if (!html) html = '<div style="padding:8px;text-align:center;color:var(--dm);font-size:11px">No matches</div>';
    return html;
  }

  function wireItems() {
    dd.querySelectorAll('.dd-item').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', e => {
        e.stopPropagation();
        dd.classList.remove('open');
        selectHwKey(el.dataset.key);
      });
      el.addEventListener('mouseenter', () => {
        dd.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
        el.classList.add('hl');
      });
    });
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      dd.innerHTML = renderList(input.value.trim());
      dd.classList.add('open');
      wireItems();
    }, 150);
  });

  input.addEventListener('focus', () => {
    dd.innerHTML = renderList(input.value.trim());
    dd.classList.add('open');
    wireItems();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.mm-hw-search')) {
      dd.classList.remove('open');
    }
  });
}

// ── Collapse state + icons ──

const EXPAND_ICON = '<svg width="8" height="9" viewBox="0 0 10 9" style="vertical-align:middle;margin-right:3px"><path d="M2 0l3 2L8 0M2 3l3 2L8 3M2 6l3 2L8 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COLLAPSE_ICON = '<svg width="8" height="9" viewBox="0 0 10 9" style="vertical-align:middle;margin-right:3px"><path d="M2 2L5 0 8 2M2 5L5 3 8 5M2 8L5 6 8 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const MM_EXP_KEY = 'my-gpu-expanded';
function mmExpanded() {
  try { return localStorage.getItem(MM_EXP_KEY) === '1'; } catch { return false; }
}
function setMmExpanded(v) {
  try { localStorage.setItem(MM_EXP_KEY, v ? '1' : '0'); } catch {}
}

// ── Helpers ──

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
