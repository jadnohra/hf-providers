// Hardware detail view: spec header (clickable to switch), model check (detailed),
// HW comparison (with search + unselect), reference models, cloud rentals, electricity cost.

import * as wasm from '../lib/wasm.js';
import * as api from '../lib/hf-api.js';
import { parseModel } from '../lib/parse.js';
import { wireSort } from '../lib/sort.js';
import { tip, hwTipFromSpec } from '../lib/tips.js';
import { state } from '../app.js';

// Cache trending models for the empty-query dropdown
let trendingCache = null;

export function render(container, match) {
  const gpuKey = match[1];
  const gpus = state.hardware || [];
  const found = wasm.findGpu(gpus, gpuKey);

  if (!found) {
    container.innerHTML = `<div class="loading">Hardware not found: ${esc(gpuKey)}</div>`;
    return;
  }

  // Pre-fetch trending if not cached
  if (!trendingCache) {
    if (state.models) {
      trendingCache = state.models.filter(m => m.safetensors?.total).slice(0, 8);
    } else {
      api.trendingModels(8).then(results => {
        trendingCache = results.filter(m => m.id && m.safetensors?.total);
      }).catch(() => {});
    }
  }

  const [key, gpu] = found;
  let html = '';

  html += renderSpecHeader(key, gpu);
  html += renderModelCheck();
  html += renderHwCompare(key);
  html += renderModelTable(gpu);
  html += renderCloudRentals(key, gpu);
  html += renderElectricityCost(gpu);

  container.innerHTML = html;

  container.querySelectorAll('.mt').forEach(wireSort);
  wireSpecSwitch(container);
  wireModelCheck(container, gpu);
  wireHwCompare(container, key, gpu);
}

// ── Spec header (clickable title to switch HW) ──

function renderSpecHeader(key, gpu) {
  const vendor = gpu.vendor === 'apple' ? 'Apple Silicon'
    : gpu.vendor === 'nvidia' ? 'NVIDIA ' + gpu.arch
    : gpu.vendor === 'amd' ? 'AMD ' + gpu.arch
    : gpu.vendor + ' ' + gpu.arch;

  const elecMonthly = (gpu.tdp_w / 1000 * 0.15 * 24 * 30).toFixed(0);

  let specs = `
    <div class="spec-item"><div class="spec-val">${gpu.vram_gb}GB</div><div class="spec-label">VRAM</div></div>
    <div class="spec-item"><div class="spec-val">${Math.round(gpu.mem_bw_gb_s)}</div><div class="spec-label">GB/s BW</div></div>
    <div class="spec-item"><div class="spec-val">${gpu.fp16_tflops.toFixed(1)}</div><div class="spec-label">TFLOPS</div></div>
    <div class="spec-item"><div class="spec-val">${gpu.tdp_w}W</div><div class="spec-label">TDP</div></div>`;

  if (gpu.street_usd) {
    specs += `<div class="spec-item"><div class="spec-val">$${gpu.street_usd.toLocaleString()}</div><div class="spec-label">Street</div></div>`;
  }
  specs += `<div class="spec-item"><div class="spec-val">$${elecMonthly}</div><div class="spec-label">/mo elec</div></div>`;

  return `<div class="spec-header">
    <div style="position:relative">
      <div class="spec-title" id="hw-switch" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:4px;text-decoration-color:var(--dm)">${esc(gpu.name)} <span style="font-size:11px;color:var(--dm)">\u25be</span></div>
      <div class="spec-type">${esc(vendor)}</div>
      <div class="dd" id="hw-switch-dd" style="position:absolute;left:0;top:100%;min-width:300px;z-index:100;max-height:360px;overflow-y:auto"></div>
    </div>
    <div class="spec-grid">${specs}</div>
  </div>`;
}

function wireSpecSwitch(container) {
  const title = container.querySelector('#hw-switch');
  const dd = container.querySelector('#hw-switch-dd');
  if (!title || !dd) return;

  title.addEventListener('click', e => {
    e.stopPropagation();
    if (dd.classList.contains('open')) {
      dd.classList.remove('open');
      return;
    }
    populateHwDropdown(dd, '', item => {
      window.location.hash = '#/hw/' + item.key;
      dd.classList.remove('open');
    });
    dd.classList.add('open');
    const inp = dd.querySelector('.dd-search');
    if (inp) inp.focus();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#hw-switch') && !e.target.closest('#hw-switch-dd')) {
      dd.classList.remove('open');
    }
  });
}

// ── Shared HW dropdown builder ──

function populateHwDropdown(dd, initialQuery, onSelect) {
  const gpus = state.hardware || [];
  const popular = ['rtx_4090', 'rtx_5090', 'm4_max_128', 'm4_pro_48', 'm4_pro_24', 'a100_pcie_80_gb', 'h100_sxm5_80_gb', 'rtx_3090', 'rx_7900_xtx'];

  function renderList(query) {
    const q = query.toLowerCase().replace(/[-_ ]/g, '');
    let matches;
    if (!q) {
      // Show popular first
      const popEntries = popular.map(k => gpus.find(([gk]) => gk === k)).filter(Boolean);
      matches = popEntries;
    } else {
      matches = gpus.filter(([key, gpu]) => {
        const k = key.replace(/_/g, '');
        const n = gpu.name.toLowerCase().replace(/[-_ ]/g, '');
        return k.includes(q) || n.includes(q);
      }).slice(0, 20);
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

  dd.innerHTML = `<input class="dd-search" placeholder="Search hardware..." style="display:block;width:calc(100% - 16px);margin:6px 8px;padding:6px 8px;font-size:11px;border:1px solid var(--bd);border-radius:4px;outline:none">`
    + `<div class="dd-list">${renderList(initialQuery)}</div>`;

  const inp = dd.querySelector('.dd-search');
  const list = dd.querySelector('.dd-list');

  inp.addEventListener('input', () => {
    list.innerHTML = renderList(inp.value.trim());
    wireItems();
  });

  inp.addEventListener('click', e => e.stopPropagation());

  function wireItems() {
    list.querySelectorAll('.dd-item').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', e => {
        e.stopPropagation();
        onSelect({ key: el.dataset.key });
      });
      el.addEventListener('mouseenter', () => {
        list.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
        el.classList.add('hl');
      });
    });
  }
  wireItems();
}

// ── Check a model ──

function renderModelCheck() {
  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">Check a model</span><div class="sec-line"></div></div>
    <div class="search-wrap" style="max-width:none;margin:0">
      <input class="search" id="hw-model-input" placeholder="Type a model name, e.g. Llama-3.3-70B..." autocomplete="off">
      <div class="dd" id="hw-model-dd"></div>
    </div>
    <div id="hw-model-result" style="margin-top:8px"></div>
  </div>`;
}

function wireModelCheck(container, gpu) {
  const input = container.querySelector('#hw-model-input');
  const dd = container.querySelector('#hw-model-dd');
  const result = container.querySelector('#hw-model-result');
  if (!input || !dd || !result) return;

  let timer = null;
  let hlIdx = -1;
  let ddItems = [];

  function renderSuggestions(models) {
    ddItems = models;
    hlIdx = -1;
    if (!models.length) { dd.classList.remove('open'); return; }
    let html = '';
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      const parts = m.id.split('/');
      const org = parts.length > 1 ? parts[0] : '';
      const name = parts.length > 1 ? parts.slice(1).join('/') : m.id;
      const params = m.safetensors?.total;
      let hint = '';
      if (params) hint += fmtP(params);
      if (m.pipeline_tag) hint += (hint ? ' \u00b7 ' : '') + m.pipeline_tag;
      html += `<div class="dd-item" data-idx="${i}">
        <span class="dd-tag dd-tag-m">model</span>
        <div class="dd-name">${org ? `<span class="o">${esc(org)}/</span>${esc(name)}` : esc(name)}</div>
        <div class="dd-hint">${esc(hint)}</div>
      </div>`;
    }
    dd.innerHTML = html;
    dd.classList.add('open');

    dd.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        dd.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
        el.classList.add('hl');
        hlIdx = parseInt(el.dataset.idx);
      });
      el.addEventListener('click', () => selectModel(parseInt(el.dataset.idx)));
    });
  }

  function showOnFocus() {
    const query = input.value.trim();
    if (query.length >= 2) {
      search(query);
    } else if (trendingCache && trendingCache.length) {
      renderSuggestions(trendingCache.slice(0, 6));
    }
  }

  async function search(query) {
    if (query.length < 2) {
      if (trendingCache && trendingCache.length) renderSuggestions(trendingCache.slice(0, 6));
      return;
    }
    if (state.models) {
      const q = query.toLowerCase();
      const matches = state.models.filter(m => m.id.toLowerCase().includes(q) && m.safetensors?.total).slice(0, 6);
      renderSuggestions(matches);
    } else {
      try {
        const results = await api.searchModels(query, 6);
        renderSuggestions(results.filter(m => m.id));
      } catch { dd.classList.remove('open'); }
    }
  }

  function selectModel(idx) {
    const raw = ddItems[idx];
    if (!raw) return;
    dd.classList.remove('open');
    input.value = raw.id;
    checkModel(raw);
  }

  function checkModel(raw) {
    const model = parseModel(raw);
    if (!model) {
      result.innerHTML = '<div class="loading">Could not parse model</div>';
      return;
    }

    const params = model.safetensorsParams;
    if (!params) {
      result.innerHTML = '<div class="loading">No parameter count available for this model</div>';
      return;
    }

    const runtimes = [];
    if (gpu.mlx_decode_eff != null) runtimes.push('mlx');
    runtimes.push('llama.cpp');

    const QUANTS = ['Q4', 'Q8', 'FP16'];
    const rows = [];

    for (const rt of runtimes) {
      for (const q of QUANTS) {
        const est = wasm.estimatePerf(gpu, params, q, rt);
        if (!est) continue;
        const fits = est.fit === 'Full';
        rows.push({
          quant: q,
          runtime: rt,
          fits,
          weight_gb: est.weight_gb,
          decode: est.decode_tok_s,
          prefill: est.prefill_tok_s,
        });
      }
    }

    const shortName = model.id.split('/').pop();
    let html = `<div style="margin-bottom:6px">
      <a class="link" href="#/model/${esc(model.id)}" style="font-weight:700">${esc(shortName)}</a>
      <span style="color:var(--dm);margin-left:6px">${fmtP(params)} params</span>
    </div>`;

    if (!rows.length) {
      html += '<div style="color:var(--dm)">No estimates available</div>';
      result.innerHTML = html;
      return;
    }

    const multiRuntime = runtimes.length > 1;

    html += `<table class="mt" style="margin-top:4px">
      <thead><tr><th>Quant</th><th>Weights</th><th>Fit</th><th>Decode</th><th>Prefill</th>${multiRuntime ? '<th>Runtime</th>' : ''}</tr></thead>
      <tbody>`;

    for (const r of rows) {
      let fitClass, fitText;
      if (!r.fits) {
        fitClass = 'fit-n';
        fitText = "won't fit";
      } else if (r.decode && r.decode >= 30) {
        fitClass = 'fit-y';
        fitText = 'comfortable';
      } else {
        fitClass = 'fit-t';
        fitText = 'tight';
      }

      const dimStyle = r.fits ? '' : 'color:var(--dm)';
      html += `<tr>
        <td style="${dimStyle}">${r.quant}</td>
        <td style="${dimStyle}">${r.weight_gb.toFixed(0)} GB</td>
        <td><span class="${fitClass}">${fitText}</span></td>
        <td style="${dimStyle}">${r.decode ? Math.round(r.decode) + ' tok/s' : '\u2014'}</td>
        <td style="${dimStyle}">${r.prefill ? fmtTokS(r.prefill) : '\u2014'}</td>
        ${multiRuntime ? `<td style="${dimStyle}">${r.runtime}</td>` : ''}
      </tr>`;
    }

    html += '</tbody></table>';
    result.innerHTML = html;
  }

  input.addEventListener('focus', showOnFocus);

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value.trim()), 200);
  });

  input.addEventListener('keydown', e => {
    if (!dd.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hlIdx = Math.min(hlIdx + 1, ddItems.length - 1);
      dd.querySelectorAll('.dd-item').forEach((el, i) => el.classList.toggle('hl', i === hlIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hlIdx = Math.max(hlIdx - 1, 0);
      dd.querySelectorAll('.dd-item').forEach((el, i) => el.classList.toggle('hl', i === hlIdx));
    } else if (e.key === 'Enter' && hlIdx >= 0) {
      e.preventDefault();
      selectModel(hlIdx);
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#hw-model-input') && !e.target.closest('#hw-model-dd')) {
      dd.classList.remove('open');
    }
  });
}

// ── HW comparison (search + chips + unselect) ──

function renderHwCompare(currentKey) {
  const gpus = state.hardware || [];
  const popular = ['rtx_4090', 'rtx_5090', 'm4_max_128', 'm4_pro_48', 'm4_pro_24', 'a100_pcie_80_gb', 'h100_sxm5_80_gb', 'rtx_3090', 'rx_7900_xtx'];

  let chips = '';
  for (const k of popular) {
    if (k === currentKey) continue;
    const entry = gpus.find(([gk]) => gk === k);
    if (!entry) continue;
    const tipLines = hwTipFromSpec(entry[1]);
    chips += `<div class="prov-chip compare-hw-pick" data-key="${esc(k)}" style="cursor:pointer">
      <div class="pn">${tip(esc(entry[1].name), tipLines)}</div>
      <div class="pm">${entry[1].vram_gb}GB</div>
    </div>`;
  }

  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">Compare with another HW</span><div class="sec-line"></div>
      <a class="sec-more" href="#/hardware">Browse all</a></div>
    <div style="position:relative;margin-bottom:8px">
      <input class="search" id="hw-compare-search" placeholder="Search hardware to compare..." autocomplete="off" style="padding:6px 12px;font-size:11px">
      <div class="dd" id="hw-compare-search-dd" style="max-height:280px;overflow-y:auto"></div>
    </div>
    <div class="prov-strip" id="hw-compare-chips">${chips}</div>
    <div id="hw-compare-result" style="margin-top:12px"></div>
  </div>`;
}

function wireHwCompare(container, currentKey, currentGpu) {
  const chips = container.querySelectorAll('.compare-hw-pick');
  const result = container.querySelector('#hw-compare-result');
  const searchInput = container.querySelector('#hw-compare-search');
  const searchDd = container.querySelector('#hw-compare-search-dd');
  const gpus = state.hardware || [];

  function doCompare(otherKey) {
    const otherEntry = gpus.find(([k]) => k === otherKey);
    if (!otherEntry) return;
    const [, otherGpu] = otherEntry;

    // Highlight the matching chip if it exists
    chips.forEach(c => {
      c.style.borderColor = '';
      c.style.background = '';
      c.classList.remove('selected');
    });
    const matchingChip = container.querySelector(`.compare-hw-pick[data-key="${otherKey}"]`);
    if (matchingChip) {
      matchingChip.classList.add('selected');
      matchingChip.style.borderColor = 'var(--ac)';
      matchingChip.style.background = 'var(--ac-s)';
    }

    renderComparison(result, container, currentGpu, otherGpu);
  }

  function clearCompare() {
    chips.forEach(c => {
      c.style.borderColor = '';
      c.style.background = '';
      c.classList.remove('selected');
    });
    result.innerHTML = '';
  }

  // Wire chips
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.classList.contains('selected')) {
        clearCompare();
      } else {
        doCompare(chip.dataset.key);
      }
    });
  });

  // Wire search input
  if (searchInput && searchDd) {
    let timer = null;

    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = searchInput.value.trim().toLowerCase().replace(/[-_ ]/g, '');
        if (!q) { searchDd.classList.remove('open'); return; }

        const matches = gpus.filter(([key, gpu]) => {
          if (key === currentKey) return false;
          const k = key.replace(/_/g, '');
          const n = gpu.name.toLowerCase().replace(/[-_ ]/g, '');
          return k.includes(q) || n.includes(q);
        }).slice(0, 10);

        if (!matches.length) { searchDd.classList.remove('open'); return; }

        let html = '';
        for (const [key, gpu] of matches) {
          html += `<div class="dd-item" data-key="${esc(key)}" style="cursor:pointer">
            <div class="dd-name">${esc(gpu.name)}</div>
            <div class="dd-hint">${gpu.vram_gb}GB \u00b7 ${esc(gpu.vendor)}</div>
          </div>`;
        }
        searchDd.innerHTML = html;
        searchDd.classList.add('open');

        searchDd.querySelectorAll('.dd-item').forEach(el => {
          el.addEventListener('mouseenter', () => {
            searchDd.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
            el.classList.add('hl');
          });
          el.addEventListener('click', () => {
            searchDd.classList.remove('open');
            searchInput.value = '';
            doCompare(el.dataset.key);
          });
        });
      }, 150);
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) searchInput.dispatchEvent(new Event('input'));
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#hw-compare-search') && !e.target.closest('#hw-compare-search-dd')) {
        searchDd.classList.remove('open');
      }
    });
  }
}

function renderComparison(result, container, currentGpu, otherGpu) {
  const reportA = wasm.machineReport(currentGpu) || [];
  const reportB = wasm.machineReport(otherGpu) || [];

  const mapA = new Map();
  for (const m of reportA) mapA.set(m.id, m);
  const mapB = new Map();
  for (const m of reportB) mapB.set(m.id, m);

  const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

  function bestForModel(m) {
    if (!m) return null;
    const fitting = m.results.filter(r => r.fits);
    if (!fitting.length) return null;
    return fitting.reduce((a, b) => (a.decode || 0) > (b.decode || 0) ? a : b);
  }

  let html = `<table class="mt" id="hw-compare-table">
    <thead><tr>
      <th>Model</th><th>Params</th>
      <th colspan="3" style="text-align:center;border-left:2px solid var(--bd)">${esc(currentGpu.name)}</th>
      <th colspan="3" style="text-align:center;border-left:2px solid var(--bd)">${esc(otherGpu.name)}</th>
    </tr>
    <tr>
      <th></th><th></th>
      <th style="border-left:2px solid var(--bd)">Quant</th><th>Decode</th><th>Prefill</th>
      <th style="border-left:2px solid var(--bd)">Quant</th><th>Decode</th><th>Prefill</th>
    </tr></thead>
    <tbody>`;

  for (const id of allIds) {
    const mA = mapA.get(id);
    const mB = mapB.get(id);
    const ref = mA || mB;
    const bestA = bestForModel(mA);
    const bestB = bestForModel(mB);

    const decA = bestA?.decode;
    const decB = bestB?.decode;
    const decACls = (decA && decB && decA >= decB) ? 'cc-best' : '';
    const decBCls = (decA && decB && decB >= decA) ? 'cc-best' : '';

    const noA = !bestA ? 'color:var(--dm)' : '';
    const noB = !bestB ? 'color:var(--dm)' : '';

    html += `<tr>
      <td class="name"><a class="link" href="#/model/${esc(ref.id)}">${esc(ref.short)}</a></td>
      <td>${fmtP(ref.params)}</td>
      <td style="border-left:2px solid var(--bd);${noA}">${bestA ? bestA.quant : '\u2014'}</td>
      <td class="${decACls}" style="${noA}">${decA ? Math.round(decA) + ' tok/s' : '\u2014'}</td>
      <td style="${noA}">${bestA?.prefill ? fmtTokS(bestA.prefill) : '\u2014'}</td>
      <td style="border-left:2px solid var(--bd);${noB}">${bestB ? bestB.quant : '\u2014'}</td>
      <td class="${decBCls}" style="${noB}">${decB ? Math.round(decB) + ' tok/s' : '\u2014'}</td>
      <td style="${noB}">${bestB?.prefill ? fmtTokS(bestB.prefill) : '\u2014'}</td>
    </tr>`;
  }

  html += '</tbody></table>';

  html += `<div style="margin-top:8px;display:flex;gap:16px;font-size:10px;color:var(--dm)">
    <span>${esc(currentGpu.name)}: ${currentGpu.vram_gb}GB \u00b7 ${Math.round(currentGpu.mem_bw_gb_s)} GB/s \u00b7 ${currentGpu.tdp_w}W${currentGpu.street_usd ? ' \u00b7 $' + currentGpu.street_usd.toLocaleString() : ''}</span>
    <span>${esc(otherGpu.name)}: ${otherGpu.vram_gb}GB \u00b7 ${Math.round(otherGpu.mem_bw_gb_s)} GB/s \u00b7 ${otherGpu.tdp_w}W${otherGpu.street_usd ? ' \u00b7 $' + otherGpu.street_usd.toLocaleString() : ''}</span>
  </div>`;

  result.innerHTML = html;
  wireSort(container.querySelector('#hw-compare-table'));
}

// ── Reference models ──

function renderModelTable(gpu) {
  const report = wasm.machineReport(gpu);
  if (!report || !report.length) return '';

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

  let html = `<div class="sec">
    <div class="sec-head"><span class="sec-q">Reference models</span><div class="sec-line"></div></div>
    <table class="mt">
      <thead><tr><th>Model</th><th>Params</th><th>Quant</th><th>Weights</th><th>Decode</th><th>Prefill</th></tr></thead>
      <tbody>`;

  if (comfortable.length) {
    html += `<tr class="group-row"><td colspan="6"><span class="fit-y">comfortable</span> \u2014 fits in VRAM, 30+ tok/s</td></tr>`;
    for (const m of comfortable) {
      const rt = multiRuntime ? ` (${m.best.runtime})` : '';
      html += `<tr>
        <td class="name"><a class="link" href="#/model/${esc(m.id)}">${esc(m.short)}</a></td>
        <td>${fmtP(m.params)}</td>
        <td>${m.best.quant || ''}</td>
        <td>${m.best.weight_gb.toFixed(0)} GB</td>
        <td>${m.best.decode ? Math.round(m.best.decode) + ' tok/s' + rt : ''}</td>
        <td>${m.best.prefill ? fmtTokS(m.best.prefill) + rt : ''}</td>
      </tr>`;
    }
  }

  if (tight.length) {
    html += `<tr class="group-row"><td colspan="6"><span class="fit-t">tight</span> \u2014 fits but &lt;30 tok/s</td></tr>`;
    for (const m of tight) {
      const rt = multiRuntime ? ` (${m.best.runtime})` : '';
      html += `<tr>
        <td class="name"><a class="link" href="#/model/${esc(m.id)}">${esc(m.short)}</a></td>
        <td>${fmtP(m.params)}</td>
        <td>${m.best.quant || ''}</td>
        <td>${m.best.weight_gb.toFixed(0)} GB</td>
        <td>${m.best.decode ? Math.round(m.best.decode) + ' tok/s' + rt : ''}</td>
        <td>${m.best.prefill ? fmtTokS(m.best.prefill) + rt : ''}</td>
      </tr>`;
    }
  }

  if (wontRun.length) {
    html += `<tr class="group-row"><td colspan="6"><span class="fit-n">won't run</span> \u2014 doesn't fit even at Q4</td></tr>`;
    for (const m of wontRun) {
      const w = (m.params * 0.5 / 1e9).toFixed(0);
      html += `<tr>
        <td class="name" style="color:var(--dm)">${esc(m.short)}</td>
        <td style="color:var(--dm)">${fmtP(m.params)}</td>
        <td style="color:var(--dm)">\u2014</td>
        <td style="color:var(--dm)">${w} GB</td>
        <td style="color:var(--dm)">\u2014</td>
        <td style="color:var(--dm)">\u2014</td>
      </tr>`;
    }
  }

  html += '</tbody></table></div>';
  return html;
}

// ── Cloud rentals ──

function renderCloudRentals(gpuKey, gpu) {
  const cloud = state.cloud || [];
  const matching = cloud.filter(([, o]) => o.gpu === gpuKey).sort((a, b) => a[1].price_hr - b[1].price_hr);

  if (!matching.length) return '';

  let cards = '';
  for (const [, o] of matching.slice(0, 5)) {
    cards += `<a class="rent-card" href="${esc(o.url)}" target="_blank" rel="noopener">
      <div class="rn">${esc(o.provider)}</div>
      <div class="rp">${esc(o.name)}</div>
      <div class="rc">$${o.price_hr.toFixed(2)}/hr</div>
    </a>`;
  }

  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">Rent this GPU in the cloud</span><div class="sec-line"></div></div>
    <div class="rent-row">${cards}</div>
  </div>`;
}

// ── Electricity cost ──

function renderElectricityCost(gpu) {
  const report = wasm.machineReport(gpu);
  if (!report) return '';

  const elecRate = 0.15;
  const elecCostHr = (gpu.tdp_w / 1000) * elecRate;

  const entries = [];
  for (const m of report) {
    const fitting = m.results.filter(r => r.fits && r.decode);
    if (!fitting.length) continue;
    const best = fitting.reduce((a, b) => (a.decode || 0) > (b.decode || 0) ? a : b);
    const costPerM = wasm.costPerMillion(elecCostHr, best.decode);
    entries.push({ short: m.short, quant: best.quant, decode: best.decode, costPerM });
  }
  entries.sort((a, b) => a.costPerM - b.costPerM);

  if (!entries.length) return '';

  let html = `<div class="sec">
    <div class="sec-head"><span class="sec-q">Electricity cost per model</span><div class="sec-line"></div></div>
    <table class="mt">
      <thead><tr><th>Model</th><th>Quant</th><th>Decode</th><th>$/1M out tokens</th></tr></thead>
      <tbody>`;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const cls = i === 0 ? 'cc-best' : '';
    html += `<tr>
      <td class="name">${esc(e.short)}</td>
      <td>${e.quant}</td>
      <td>${Math.round(e.decode)} tok/s</td>
      <td class="${cls}">$${e.costPerM.toFixed(3)}</td>
    </tr>`;
  }

  html += '</tbody></table></div>';
  return html;
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

function fmtTokS(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k tok/s`;
  return `${Math.round(v)} tok/s`;
}
