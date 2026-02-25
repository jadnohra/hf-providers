// Model detail view: providers, hw cards, cost comparison, snippets, variants.

import * as api from '../lib/hf-api.js';
import { parseModel, readiness } from '../lib/parse.js';
import * as wasm from '../lib/wasm.js';
import { wireSort } from '../lib/sort.js';
import { tip, hwTip } from '../lib/tips.js';
import { navigate } from '../lib/router.js';
import { state } from '../app.js';

export function render(container, match, opts = {}) {
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
        model.providers = enriched.providers;
      }
    }

    renderModel(container, model, opts);
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed: ${esc(err.message)}</div>`;
  });

  return () => { cancelled = true; };
}

function renderModel(container, model, opts = {}) {
  let params = model.safetensorsParams;
  // Fallback chain: cached exact match → related model in cache → paramHint from name
  if (!params && state.models) {
    const cached = state.models.find(m => m.id === model.id);
    if (cached?.safetensors?.total) params = cached.safetensors.total;
  }
  if (!params && state.models) {
    // Search for a related model (same org, similar name) that has params
    const org = model.id.split('/')[0];
    const baseName = model.id.split('/').pop().replace(/-Instruct$|-it$|-Chat$|-GGUF$/, '');
    for (const m of state.models) {
      if (m.safetensors?.total && m.id.startsWith(org + '/') && m.id.includes(baseName)) {
        params = m.safetensors.total;
        break;
      }
    }
  }
  if (!params) {
    const hint = wasm.paramHint(model.id.split('/').pop());
    if (hint) {
      const hm = String(hint).match(/([0-9.]+)/);
      if (hm) {
        const n = parseFloat(hm[1]);
        if (hint.includes('B') || hint.includes('b')) params = n * 1e9;
        else if (hint.includes('M') || hint.includes('m')) params = n * 1e6;
      }
    }
  }
  let html = '';

  const parts = model.id.split('/');
  const org = parts.length > 1 ? parts[0] : '';
  const name = parts.length > 1 ? parts.slice(1).join('/') : model.id;

  if (opts.embedded) {
    // Compact title for landing page
    html += `<div style="text-align:center;margin-bottom:8px">
      <span style="font-size:11px;color:var(--mt)">${esc(org)}/</span><a href="/model/${esc(model.id)}" style="font-size:14px;font-weight:700;color:var(--tx);text-decoration:none">${esc(name)}</a>
    </div>`;
  } else {
    // Full header (same style as HW/provider)
    let specGrid = '';
    if (params) {
      specGrid += `<div class="spec-item"><div class="spec-val">${esc(fmtP(params))}</div><div class="spec-label">Params</div></div>`;
      specGrid += `<div class="spec-item"><div class="spec-val">${fmtGB(params, 0.5)}</div><div class="spec-label">Q4</div></div>`;
      specGrid += `<div class="spec-item"><div class="spec-val">${fmtGB(params, 1.0)}</div><div class="spec-label">Q8</div></div>`;
      specGrid += `<div class="spec-item"><div class="spec-val">${fmtGB(params, 2.0)}</div><div class="spec-label">FP16</div></div>`;
    }
    specGrid += `<div class="spec-item"><div class="spec-val">${fmtNum(model.likes)}</div><div class="spec-label">Likes</div></div>`;
    specGrid += `<div class="spec-item"><div class="spec-val">${fmtNum(model.downloads)}</div><div class="spec-label">Downloads</div></div>`;

    const tags = [model.libraryName, model.pipelineTag].filter(Boolean).join(' \u00b7 ');

    html += `<div class="spec-header">
      <div style="position:relative">
        <div class="spec-title">${esc(name)}</div>
        <div class="spec-type">${esc(org)}${tags ? ' \u00b7 ' + esc(tags) : ''} <button class="switch-btn" id="model-switch">switch \u25be</button></div>
        <div class="dd" id="model-switch-dd" style="position:absolute;left:0;top:100%;min-width:340px;z-index:100;max-height:360px;overflow-y:auto"></div>
      </div>
      <div class="spec-grid">${specGrid}</div>
    </div>`;
  }

  // Variants section (related models from same org)
  html += renderVariants(model);

  // Providers section
  html += renderProviders(model);

  // Cost comparison
  if (params) {
    html += renderCostComparison(model, params);
  } else {
    html += `<div class="sec">
      <div class="sec-head"><span class="sec-q">What's the cheapest way to run it?</span><div class="sec-line"></div></div>
      <div style="color:var(--dm);font-size:11px">No parameter count available for this model</div>
    </div>`;
  }

  // Hardware estimation cards
  if (params) {
    html += renderHardwareCards(model, params);
  } else {
    html += `<div class="sec">
      <div class="sec-head"><span class="sec-q">What can my hardware run?</span><div class="sec-line"></div></div>
      <div style="color:var(--dm);font-size:11px">No parameter count available for this model</div>
    </div>`;
  }

  // Provider chips section ("What does a provider serve?")
  html += renderProviderChips(model);

  container.innerHTML = html;

  // Wire model switch
  wireModelSwitch(container);
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

  let html = `<div class="sec" id="sec-providers">
    <div class="sec-head"><span class="sec-q">Where can I run it via API?</span><div class="sec-line"></div></div>
    <table class="mt" id="provider-table">
      <thead><tr><th>Status</th><th>Provider</th><th>$/1M in</th><th>$/1M out</th><th>Throughput</th><th>Tools</th><th>JSON</th></tr></thead>
      <tbody id="provider-tbody">`;

  html += providerRows(providers, model.id);

  html += `</tbody></table>`;

  // Snippet preview (first live provider)
  const firstProv = providers[0];
  html += renderSnippet(model.id, firstProv.name);

  html += '</div>';
  return html;
}

function renderVariants(model) {
  // Find related variants from cache (exclude quantization repacks)
  if (!state.models) return '';
  const parts = model.id.split('/');
  if (parts.length < 2) return '';
  const org = parts[0];
  const name = parts.slice(1).join('/');

  const SUFFIXES = /-Instruct$|-it$|-Chat$|-GGUF$|-AWQ$|-GPTQ$|-fp8$|-BF16$|-EXL2$|-MLX$/i;
  const QUANT_RE = /GGUF|AWQ|GPTQ|EXL2|MLX|fp8|BF16/i;
  const baseName = name.replace(SUFFIXES, '');

  const variants = state.models.filter(m => {
    if (m.id === model.id) return false;
    if (!m.id.startsWith(org + '/')) return false;
    const mName = m.id.split('/').slice(1).join('/');
    if (QUANT_RE.test(mName)) return false;  // skip quantization repacks
    const mBase = mName.replace(SUFFIXES, '');
    return mBase === baseName || baseName.startsWith(mBase + '-') || mBase.startsWith(baseName + '-');
  }).slice(0, 8);

  if (!variants.length) return '';

  let chips = '';
  for (const v of variants) {
    const vName = v.id.split('/').slice(1).join('/');
    const params = v.safetensors?.total;
    const provCount = Array.isArray(v.inferenceProviderMapping)
      ? v.inferenceProviderMapping.filter(p => p.status === 'live').length : 0;
    let hint = '';
    if (params) hint += fmtP(params);
    if (provCount) hint += (hint ? ' \u00b7 ' : '') + provCount + ' providers';
    chips += `<a class="var-chip" href="/model/${esc(v.id)}" data-tip="${esc(v.id)}">
      <div class="pn">${esc(vName)}</div>
      ${hint ? `<div class="pm">${esc(hint)}</div>` : ''}
    </a>`;
  }

  return `<div class="sec" style="margin-bottom:12px">
    <div class="sec-head"><span class="sec-q">Related variants</span><div class="sec-line"></div></div>
    <div class="variants-sec">${chips}</div>
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
      <td class="name"><a class="link" href="/provider/${esc(p.name)}" data-tip="${esc(provTitle(p))}">${esc(p.name)}</a></td>
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
  if (state.myGpu && state.myGpu.key && !gpuKeys.includes(state.myGpu.key)) {
    gpuKeys.unshift(state.myGpu.key);
  }
  const gpus = state.hardware || [];

  let cards = '';
  for (const key of gpuKeys) {
    const entry = gpus.find(([k]) => k === key);
    if (!entry) continue;
    const [, gpu] = entry;
    const isYours = state.myGpu && state.myGpu.key === key;
    const yoursLabel = isYours ? ' <span class="hw-yours">(yours)</span>' : '';
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
    const tipLines = hwTip(key);

    if (bestResult) {
      const [quantLabel, est] = bestResult;
      const decode = est.decode_tok_s;
      const weightStr = est.weight_gb.toFixed(0) + ' GB';
      const rtSuffix = runtimes.length > 1 ? ` (${bestRt})` : '';
      let fitClass, fitText;
      if (decode && decode >= 30) {
        fitClass = 'fit-y';
        fitText = `comfortable \u00b7 ${Math.round(decode)} tok/s${rtSuffix}`;
      } else if (decode) {
        fitClass = 'fit-t';
        fitText = `tight \u00b7 ${Math.round(decode)} tok/s${rtSuffix}`;
      } else {
        fitClass = 'fit-n';
        fitText = "doesn't fit";
      }
      cards += `<a class="hw-card${isYours ? ' yours' : ''}" href="/hw/${key}">
        <div class="hn">${tip(esc(gpu.name), tipLines)}${yoursLabel}</div>
        <div class="ht">${esc(vendor)} \u00b7 ${vramLabel}</div>
        <div class="hm">${quantLabel} \u00b7 ${weightStr}</div>
        <div class="hf ${fitClass}">${fitText}</div>
      </a>`;
    } else {
      const weightStr = (params * 0.5 / 1e9).toFixed(0) + ' GB';
      cards += `<a class="hw-card${isYours ? ' yours' : ''}" href="/hw/${key}">
        <div class="hn">${tip(esc(gpu.name), tipLines)}${yoursLabel}</div>
        <div class="ht">${esc(vendor)} \u00b7 ${vramLabel}</div>
        <div class="hm">Q4 \u00b7 ${weightStr} needed</div>
        <div class="hf fit-n">doesn't fit</div>
      </a>`;
    }
  }

  return `<div class="sec" id="sec-hw">
    <div class="sec-head"><span class="sec-q">What can my hardware run?</span><div class="sec-line"></div><a class="sec-more" href="/hw/rtx_4090">Pick your hardware</a></div>
    <div class="hw-row">${cards}</div>
  </div>`;
}

function renderCostComparison(model, params) {
  const cloud = state.cloud || [];
  const gpus = state.hardware || [];

  // Gather API data
  const apiData = model.providers
    .filter(p => p.status === 'live')
    .map(p => ({
      name: p.name, price: p.outputPrice, tok: p.throughput,
      href: '/provider/' + p.name,
      tipLines: [
        p.inputPrice != null ? '$' + p.inputPrice.toFixed(2) + '/1M input' : null,
        p.outputPrice != null ? '$' + p.outputPrice.toFixed(2) + '/1M output' : null,
        p.throughput != null ? Math.round(p.throughput) + ' tok/s' : null,
        p.latency != null ? Math.round(p.latency * 1000) + 'ms TTFT' : null,
      ].filter(Boolean)
    }));

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
      const gpuLabel = offering.gpu_count > 1 ? offering.gpu_count + 'x ' + gpu.name : gpu.name;
      cloudData.push({
        name: gpuLabel + ' \u00b7 ' + offering.provider,
        price: costPerM, tok: bestDecode,
        href: offering.url || '/hw/' + offering.gpu,
        external: !!offering.url,
        tipLines: [
          offering.name,
          '$' + (offering.price_hr * offering.gpu_count).toFixed(2) + '/hr',
          gpu.vram_gb * offering.gpu_count + ' GB VRAM \u00b7 ' + Math.round(gpu.mem_bw_gb_s) + ' GB/s',
          Math.round(bestDecode) + ' tok/s estimated decode',
        ]
      });
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
      localData.push({
        name: gpu.name, price: costPerM, tok: bestDecode,
        href: '/hw/' + key,
        tipLines: [
          gpu.vram_gb + ' GB VRAM \u00b7 ' + Math.round(gpu.mem_bw_gb_s) + ' GB/s',
          gpu.tdp_w + 'W TDP',
          gpu.street_usd ? '~$' + gpu.street_usd.toLocaleString() + ' street' : null,
          Math.round(bestDecode) + ' tok/s estimated decode',
        ].filter(Boolean)
      });
    }
  }

  function buildCol(title, tagCls, entries, mode) {
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
      const ext = e.external ? ' target="_blank" rel="noopener"' : '';
      html += `<a class="cc-row" href="${esc(e.href || '#')}"${ext}><span>${tip(esc(e.name), e.tipLines)}</span><span class="${cls}">${val}</span></a>`;
    }
    if (!sorted.length) html += '<div class="cc-row"><span>No data</span><span></span></div>';
    html += '</div>';
    return html;
  }

  function renderMode(mode) {
    return buildCol('API', 'tg-gn', apiData, mode) +
           buildCol('Cloud rental', 'tg-bl', cloudData, mode) +
           buildCol('Buy & run', 'tg-am', localData, mode);
  }

  return `<div class="sec" id="sec-cost">
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
    chips += `<a class="prov-chip" href="/provider/${esc(p.name)}" data-tip="${esc(provTitle(p))}">
      <div class="pn">${esc(p.name)}</div>
      ${throughput ? `<div class="pm">${throughput}</div>` : ''}
    </a>`;
  }

  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">What does a provider serve?</span><div class="sec-line"></div><a class="sec-more" href="/provider/${esc(liveProviders[0].name)}">Pick a provider</a></div>
    <div class="prov-strip">${chips}</div>
  </div>`;
}

function wireModelSwitch(container) {
  const btn = container.querySelector('#model-switch');
  const dd = container.querySelector('#model-switch-dd');
  if (!btn || !dd) return;

  const models = state.models || [];

  function renderList(query) {
    const q = query.toLowerCase();
    let matches;
    if (!q) {
      matches = models.filter(m => m.safetensors?.total).slice(0, 10);
    } else {
      matches = models.filter(m => m.id.toLowerCase().includes(q)).slice(0, 10);
    }

    let html = '';
    for (const m of matches) {
      const mParts = m.id.split('/');
      const mOrg = mParts.length > 1 ? mParts[0] : '';
      const mName = mParts.length > 1 ? mParts.slice(1).join('/') : m.id;
      const params = m.safetensors?.total;
      const hint = params ? fmtP(params) : '';
      html += `<div class="dd-item" data-id="${esc(m.id)}" style="cursor:pointer">
        <div class="dd-name">${mOrg ? `<span class="o">${esc(mOrg)}/</span>` : ''}${esc(mName)}</div>
        <div class="dd-hint">${esc(hint)}</div>
      </div>`;
    }
    if (!html) html = '<div style="padding:8px;text-align:center;color:var(--dm);font-size:11px">No matches</div>';
    return html;
  }

  function wireItems() {
    dd.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        dd.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
        el.classList.add('hl');
      });
      el.addEventListener('click', e => {
        e.stopPropagation();
        dd.classList.remove('open');
        navigate('/model/' + el.dataset.id);
      });
    });
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (dd.classList.contains('open')) {
      dd.classList.remove('open');
      return;
    }
    dd.innerHTML = `<input class="dd-search" placeholder="Search models..." style="display:block;width:calc(100% - 16px);margin:6px 8px;padding:6px 8px;font-size:11px;border:1px solid var(--bd);border-radius:4px;outline:none">`
      + `<div class="dd-list">${renderList('')}</div>`;
    dd.classList.add('open');
    const inp = dd.querySelector('.dd-search');
    const list = dd.querySelector('.dd-list');
    inp.focus();
    inp.addEventListener('click', ev => ev.stopPropagation());
    inp.addEventListener('input', () => {
      list.innerHTML = renderList(inp.value.trim());
      wireItems();
    });
    wireItems();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#model-switch') && !e.target.closest('#model-switch-dd')) {
      dd.classList.remove('open');
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

function provTitle(p) {
  return [
    p.inputPrice != null ? '$' + p.inputPrice.toFixed(2) + '/1M in' : '',
    p.outputPrice != null ? '$' + p.outputPrice.toFixed(2) + '/1M out' : '',
    p.throughput != null ? Math.round(p.throughput) + ' tok/s' : '',
    p.latency != null ? Math.round(p.latency * 1000) + 'ms TTFT' : '',
  ].filter(Boolean).join(' \u00b7 ');
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
