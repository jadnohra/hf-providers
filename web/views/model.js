// Model detail view: providers, hw cards, cost comparison, snippets, variants.

import * as api from '../lib/hf-api.js';
import { parseModel, readiness } from '../lib/parse.js';
import * as wasm from '../lib/wasm.js';
import { wireSort } from '../lib/sort.js';
import { state } from '../app.js';

export function render(container, match) {
  const modelId = match[1];
  container.innerHTML = `<div class="loading">Loading ${esc(modelId)}...</div>`;
  let cancelled = false;

  // Call both endpoints in parallel:
  // - modelInfo: full model data (safetensors, tags, library, etc.)
  // - searchModels: enriched provider data (pricing, throughput, latency, features)
  Promise.all([
    api.modelInfo(modelId),
    api.searchModels(modelId, 5),
  ]).then(([infoRaw, searchResults]) => {
    if (cancelled) return;
    const model = parseModel(infoRaw);
    if (!model) {
      container.innerHTML = `<div class="loading">Could not parse model data</div>`;
      return;
    }

    // Enrich providers from search results (which have full pricing/perf data)
    const searchMatch = searchResults.find(r => r.id === modelId);
    if (searchMatch) {
      const enriched = parseModel(searchMatch);
      if (enriched && enriched.providers.length) {
        // Replace providers with enriched versions
        model.providers = enriched.providers;
      }
    }

    renderModel(container, model);
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed: ${esc(err.message)}</div>`;
  });

  return () => { cancelled = true; };
}

function renderModel(container, model) {
  const params = model.safetensorsParams;
  let html = '';

  // Model title
  const parts = model.id.split('/');
  const org = parts.length > 1 ? parts[0] : '';
  const name = parts.length > 1 ? parts.slice(1).join('/') : model.id;
  html += `<div style="text-align:center;margin-bottom:8px">
    <span style="font-size:11px;color:var(--mt)">${esc(org)}/</span><span style="font-size:14px;font-weight:700">${esc(name)}</span>
  </div>`;

  // Meta pills
  html += '<div class="meta-pills center">';
  if (params) {
    html += `<span class="mp"><b>${esc(fmtP(params))}</b> params</span>`;
    html += `<span class="mp">Q4: <b>${fmtGB(params, 0.5)}</b></span>`;
    html += `<span class="mp">Q8: <b>${fmtGB(params, 1.0)}</b></span>`;
    html += `<span class="mp">FP16: <b>${fmtGB(params, 2.0)}</b></span>`;
  }
  if (model.libraryName) html += `<span class="mp">${esc(model.libraryName)}</span>`;
  if (model.pipelineTag) html += `<span class="mp">${esc(model.pipelineTag)}</span>`;
  html += `<span class="mp">${fmtNum(model.likes)} likes</span>`;
  html += `<span class="mp">${fmtNum(model.downloads)} downloads</span>`;
  html += '</div>';

  // Providers section
  html += renderProviders(model);

  // Hardware estimation cards
  if (params) {
    html += renderHardwareCards(model, params);
  }

  // Cost comparison
  if (params) {
    html += renderCostComparison(model, params);
  }

  // Provider chips section ("What does a provider serve?")
  html += renderProviderChips(model);

  container.innerHTML = html;

  // Wire up filter pills
  wireFilters(container, model);
  // Wire up snippet tabs
  wireSnippets(container);
  // Wire cost toggle
  wireCostToggle(container);
  // Sortable columns
  wireSort(container.querySelector('#provider-table'));
}

function renderProviders(model) {
  const providers = model.providers.filter(p => p.status === 'live');
  if (!providers.length) {
    return `<div class="sec">
      <div class="sec-head"><span class="sec-q">Where can I run it via API?</span><div class="sec-line"></div></div>
      <div class="loading">No providers available</div>
    </div>`;
  }

  let html = `<div class="sec">
    <div class="sec-head"><span class="sec-q">Where can I run it via API?</span><div class="sec-line"></div></div>
    <div class="filter-bar" id="filter-bar">
      <span class="fp on" data-filter="all">All</span>
      <span class="fp" data-filter="hot">Hot only</span>
      <span class="fp" data-filter="tools">Tool use</span>
      <span class="fp" data-filter="json">JSON mode</span>
      <span class="fp" data-filter="cheapest">Cheapest first</span>
      <span class="fp" data-filter="fastest">Fastest first</span>
    </div>
    <table class="mt" id="provider-table">
      <thead><tr><th>Status</th><th>Provider</th><th>$/1M in</th><th>$/1M out</th><th>Throughput</th><th>Tools</th><th>JSON</th></tr></thead>
      <tbody id="provider-tbody">`;

  html += providerRows(providers, model.id);

  html += `</tbody></table>`;

  // Variants bar
  html += renderVariants(model);

  // Snippet preview (first live provider)
  const firstProv = providers[0];
  html += renderSnippet(model.id, firstProv.name);

  html += '</div>';
  return html;
}

function renderVariants(model) {
  // Extract variant hints from model name: look for related models in tags
  // For now, extract base model info from tags
  const id = model.id;
  const parts = id.split('/');
  if (parts.length < 2) return '';
  const org = parts[0];
  const name = parts.slice(1).join('/');

  // Find related model patterns (same org, similar base name)
  const baseName = name.replace(/-Instruct$|-it$|-Chat$/, '');
  if (baseName === name) return ''; // no variant suffix to strip

  return `<div class="variants"><span>Related:</span>
    <a class="var-link" href="#/model/${esc(org)}/${esc(baseName)}">${esc(baseName)}</a>
  </div>`;
}

function providerRows(providers) {
  let html = '';
  for (const p of providers) {
    const r = readiness(p);
    const dotClass = r === 'hot' ? 'dt-hot' : r === 'warm' ? 'dt-warm' : 'dt-cold';
    const slClass = r === 'hot' ? 'sl-hot' : r === 'warm' ? 'sl-warm' : 'sl-cold';
    const ttft = p.latency != null ? `${Math.round(p.latency * 1000)}ms` : '';

    html += `<tr data-provider="${esc(p.name)}"
      data-readiness="${r}"
      data-tools="${p.supportsTools === true}"
      data-json="${p.supportsStructured === true}"
      data-price="${p.outputPrice ?? 999999}"
      data-throughput="${p.throughput ?? 0}">
      <td><span class="dt ${dotClass}"></span><span class="sl ${slClass}">${r}</span>${ttft ? `<span class="ttft">${ttft}</span>` : ''}</td>
      <td class="name"><a class="link" href="#/provider/${esc(p.name)}">${esc(p.name)}</a></td>
      <td>${p.inputPrice != null ? '$' + p.inputPrice.toFixed(2) : ''}</td>
      <td>${p.outputPrice != null ? '$' + p.outputPrice.toFixed(2) : ''}</td>
      <td>${p.throughput != null ? Math.round(p.throughput) + ' tok/s' : ''}</td>
      <td style="color:var(${p.supportsTools === true ? '--gn' : '--dm'})">${p.supportsTools === true ? 'yes' : p.supportsTools === false ? 'no' : ''}</td>
      <td style="color:var(${p.supportsStructured === true ? '--gn' : '--dm'})">${p.supportsStructured === true ? 'yes' : p.supportsStructured === false ? 'no' : ''}</td>
    </tr>`;
  }
  return html;
}

function renderSnippet(modelId, providerName) {
  const snippet = wasm.generateSnippet(modelId, providerName, 'curl') || '';
  return `<div class="snip-preview" id="snippet-preview" data-model="${esc(modelId)}" data-provider="${esc(providerName)}">
    <div class="snip-bar">
      <div class="snip-tabs">
        <button class="snt on" data-lang="curl">curl</button>
        <button class="snt" data-lang="python">python</button>
        <button class="snt" data-lang="js">js</button>
      </div>
      <span class="snip-copy" id="snip-copy">Copy</span>
    </div>
    <div class="snip-code" id="snip-code">${esc(snippet)}</div>
  </div>`;
}

function renderHardwareCards(model, params) {
  const gpuKeys = ['rtx_4090', 'rtx_5090', 'm4_pro_48', 'm4_max_128', 'a100_pcie_80_gb'];
  const gpus = state.hardware || [];

  let cards = '';
  for (const key of gpuKeys) {
    const entry = gpus.find(([k]) => k === key);
    if (!entry) continue;
    const [, gpu] = entry;
    const runtimes = [];
    if (gpu.mlx_decode_eff != null) runtimes.push('mlx');
    runtimes.push('llama.cpp');

    let bestResult = null;
    let bestRt = '';
    for (const rt of runtimes) {
      const result = wasm.bestQuant(gpu, params, rt);
      if (result && (!bestResult || (result[1].decode_tok_s || 0) > (bestResult[1].decode_tok_s || 0))) {
        bestResult = result;
        bestRt = rt;
      }
    }

    const vramLabel = `${gpu.vram_gb}GB`;
    const vendor = gpu.vendor === 'apple' ? 'Apple Silicon' : gpu.vendor === 'nvidia' ? 'Desktop' : gpu.vendor;

    if (bestResult) {
      const [quantLabel, est] = bestResult;
      const decode = est.decode_tok_s;
      const weightStr = est.weight_gb.toFixed(0) + ' GB';
      const rtSuffix = runtimes.length > 1 ? ` (${bestRt})` : '';
      let fitClass, fitText;
      if (decode && decode >= 30) {
        fitClass = 'fit-y';
        fitText = `comfortable · ${Math.round(decode)} tok/s${rtSuffix}`;
      } else if (decode) {
        fitClass = 'fit-t';
        fitText = `tight · ${Math.round(decode)} tok/s${rtSuffix}`;
      } else {
        fitClass = 'fit-n';
        fitText = "doesn't fit";
      }
      cards += `<a class="hw-card" href="#/hw/${key}">
        <div class="hn">${esc(gpu.name)}</div>
        <div class="ht">${esc(vendor)} · ${vramLabel}</div>
        <div class="hm">${quantLabel} · ${weightStr}</div>
        <div class="hf ${fitClass}">${fitText}</div>
      </a>`;
    } else {
      const weightStr = (params * 0.5 / 1e9).toFixed(0) + ' GB';
      cards += `<a class="hw-card" href="#/hw/${key}">
        <div class="hn">${esc(gpu.name)}</div>
        <div class="ht">${esc(vendor)} · ${vramLabel}</div>
        <div class="hm">Q4 · ${weightStr} needed</div>
        <div class="hf fit-n">doesn't fit</div>
      </a>`;
    }
  }

  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">What can my hardware run?</span><div class="sec-line"></div><a class="sec-more" href="#/hw/rtx_4090">Pick your hardware</a></div>
    <div class="hw-row">${cards}</div>
  </div>`;
}

function renderCostComparison(model, params) {
  const cloud = state.cloud || [];
  const gpus = state.hardware || [];

  // Gather API data
  const apiData = model.providers
    .filter(p => p.status === 'live' && (p.outputPrice != null || p.throughput != null))
    .map(p => ({ name: p.name, price: p.outputPrice, tok: p.throughput }));

  // Gather cloud data
  const cloudData = [];
  for (const [, offering] of cloud) {
    const gpuEntry = gpus.find(([k]) => k === offering.gpu);
    if (!gpuEntry) continue;
    const [, gpu] = gpuEntry;
    const runtimes = [];
    if (gpu.mlx_decode_eff != null) runtimes.push('mlx');
    runtimes.push('llama.cpp');
    let bestDecode = 0;
    for (const rt of runtimes) {
      const totalVram = gpu.vram_gb * offering.gpu_count;
      if (params * 0.5 / 1e9 > totalVram * 0.85) continue;
      const result = wasm.bestQuant(gpu, params, rt);
      if (result && result[1].decode_tok_s) {
        const d = result[1].decode_tok_s * offering.gpu_count;
        if (d > bestDecode) bestDecode = d;
      }
    }
    if (bestDecode > 0) {
      const costPerM = wasm.costPerMillion(offering.price_hr * offering.gpu_count, bestDecode);
      cloudData.push({ name: `${offering.gpu} · ${offering.provider}`, price: costPerM, tok: bestDecode });
    }
  }

  // Gather local data
  const elecRate = 0.15;
  const localData = [];
  for (const key of ['m4_max_128', 'm4_pro_48', 'm4_pro_24', 'rtx_4090', 'rtx_5090', 'a6000']) {
    const entry = gpus.find(([k]) => k === key);
    if (!entry) continue;
    const [, gpu] = entry;
    const runtimes = [];
    if (gpu.mlx_decode_eff != null) runtimes.push('mlx');
    runtimes.push('llama.cpp');
    let bestDecode = 0;
    for (const rt of runtimes) {
      const result = wasm.bestQuant(gpu, params, rt);
      if (result && result[1].decode_tok_s && result[1].decode_tok_s > bestDecode) bestDecode = result[1].decode_tok_s;
    }
    if (bestDecode > 0) {
      const costPerM = wasm.costPerMillion((gpu.tdp_w / 1000) * elecRate, bestDecode);
      localData.push({ name: gpu.name, price: costPerM, tok: bestDecode });
    }
  }

  function buildCol(title, tagCls, tagLabel, entries, mode) {
    const sorted = entries.slice().sort((a, b) =>
      mode === 'cheapest' ? (a.price ?? 999) - (b.price ?? 999) : (b.tok ?? 0) - (a.tok ?? 0)
    ).slice(0, 4);

    let html = `<div class="cost-col"><div class="cc-head">${esc(title)} <span class="tg ${tagCls}">${mode === 'cheapest' ? '$/1M out' : 'tok/s'}</span></div>`;
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const cls = i === 0 ? 'cc-best' : '';
      const val = mode === 'cheapest'
        ? (e.price != null ? '$' + (e.price < 1 ? e.price.toFixed(3) : e.price.toFixed(2)) : '')
        : (e.tok != null ? Math.round(e.tok) + ' tok/s' : '');
      html += `<div class="cc-row"><span>${esc(e.name)}</span><span class="${cls}">${val}</span></div>`;
    }
    if (!sorted.length) html += '<div class="cc-row"><span>No data</span><span></span></div>';
    html += '</div>';
    return html;
  }

  function renderMode(mode) {
    return buildCol('API', 'tg-gn', '', apiData, mode) +
           buildCol('Cloud rental', 'tg-bl', '', cloudData, mode) +
           buildCol('Buy & run', 'tg-am', '', localData, mode);
  }

  return `<div class="sec">
    <div class="sec-head">
      <span class="sec-q" id="cost-title">What's the cheapest way to run it?</span>
      <div class="sec-line"></div>
      <div class="filter-bar" id="cost-toggle" style="margin-bottom:0">
        <span class="fp on" data-mode="cheapest">Cheapest</span>
        <span class="fp" data-mode="fastest">Fastest</span>
      </div>
    </div>
    <div class="cost-cols" id="cost-cols-cheapest">${renderMode('cheapest')}</div>
    <div class="cost-cols" id="cost-cols-fastest" style="display:none">${renderMode('fastest')}</div>
  </div>`;
}

function wireCostToggle(container) {
  const toggle = container.querySelector('#cost-toggle');
  if (!toggle) return;
  const title = container.querySelector('#cost-title');
  const cheapest = container.querySelector('#cost-cols-cheapest');
  const fastest = container.querySelector('#cost-cols-fastest');

  toggle.addEventListener('click', e => {
    const fp = e.target.closest('.fp');
    if (!fp) return;
    toggle.querySelectorAll('.fp').forEach(p => p.classList.remove('on'));
    fp.classList.add('on');
    const mode = fp.dataset.mode;
    if (title) title.textContent = mode === 'cheapest' ? "What's the cheapest way to run it?" : "What's the fastest way to run it?";
    if (cheapest) cheapest.style.display = mode === 'cheapest' ? '' : 'none';
    if (fastest) fastest.style.display = mode === 'fastest' ? '' : 'none';
  });
}

function renderProviderChips(model) {
  const liveProviders = model.providers.filter(p => p.status === 'live');
  if (!liveProviders.length) return '';

  let chips = '';
  for (const p of liveProviders.slice(0, 6)) {
    const throughput = p.throughput ? `${Math.round(p.throughput)} tok/s` : '';
    chips += `<a class="prov-chip" href="#/provider/${esc(p.name)}">
      <div class="pn">${esc(p.name)}</div>
      ${throughput ? `<div class="pm">${throughput}</div>` : ''}
    </a>`;
  }

  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">What does a provider serve?</span><div class="sec-line"></div><a class="sec-more" href="#/provider/${esc(liveProviders[0].name)}">Browse all</a></div>
    <div class="prov-strip">${chips}</div>
  </div>`;
}

function wireFilters(container, model) {
  const bar = container.querySelector('#filter-bar');
  if (!bar) return;
  const tbody = container.querySelector('#provider-tbody');
  if (!tbody) return;

  bar.addEventListener('click', e => {
    const fp = e.target.closest('.fp');
    if (!fp) return;
    const filter = fp.dataset.filter;

    if (filter === 'all') {
      bar.querySelectorAll('.fp').forEach(p => p.classList.remove('on'));
      fp.classList.add('on');
    } else {
      bar.querySelector('[data-filter="all"]').classList.remove('on');
      fp.classList.toggle('on');
      if (!bar.querySelector('.fp.on')) {
        bar.querySelector('[data-filter="all"]').classList.add('on');
      }
    }

    const active = new Set();
    bar.querySelectorAll('.fp.on').forEach(p => active.add(p.dataset.filter));

    const rows = Array.from(tbody.querySelectorAll('tr'));

    if (active.has('cheapest') || active.has('fastest')) {
      const sorted = rows.slice().sort((a, b) => {
        if (active.has('cheapest')) return parseFloat(a.dataset.price) - parseFloat(b.dataset.price);
        return parseFloat(b.dataset.throughput) - parseFloat(a.dataset.throughput);
      });
      for (const row of sorted) tbody.appendChild(row);
      rows.forEach(r => r.style.display = '');
    } else if (active.has('all')) {
      rows.forEach(r => r.style.display = '');
    } else {
      rows.forEach(r => {
        let show = true;
        if (active.has('hot') && r.dataset.readiness !== 'hot') show = false;
        if (active.has('tools') && r.dataset.tools !== 'true') show = false;
        if (active.has('json') && r.dataset.json !== 'true') show = false;
        r.style.display = show ? '' : 'none';
      });
    }
  });
}

function wireSnippets(container) {
  const preview = container.querySelector('#snippet-preview');
  if (!preview) return;
  const modelId = preview.dataset.model;
  const provider = preview.dataset.provider;
  const codeEl = preview.querySelector('#snip-code');
  const copyEl = preview.querySelector('#snip-copy');

  preview.querySelectorAll('.snt').forEach(tab => {
    tab.addEventListener('click', () => {
      preview.querySelectorAll('.snt').forEach(t => t.classList.remove('on'));
      tab.classList.add('on');
      const code = wasm.generateSnippet(modelId, provider, tab.dataset.lang) || '';
      codeEl.textContent = code;
    });
  });

  if (copyEl) {
    copyEl.addEventListener('click', () => {
      navigator.clipboard.writeText(codeEl.textContent).then(() => {
        copyEl.textContent = 'Copied!';
        setTimeout(() => { copyEl.textContent = 'Copy'; }, 1200);
      });
    });
  }
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

function fmtGB(params, bytesPerParam) {
  const gb = params * bytesPerParam / 1e9;
  return `${gb.toFixed(0)}GB`;
}

function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
