// Model detail view: providers, hw cards, cost comparison, snippets, variants.

import * as api from '../lib/hf-api.js';
import { parseModel, readiness } from '../lib/parse.js';
import * as wasm from '../lib/wasm.js';
import { wireSort } from '../lib/sort.js';
import { tip, hwTip } from '../lib/tips.js';
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
    chips += `<a class="var-chip" href="#/model/${esc(v.id)}" data-tip="${esc(v.id)}">
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
      <td class="name"><a class="link" href="#/provider/${esc(p.name)}" data-tip="${esc(provTitle(p))}">${esc(p.name)}</a></td>
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
      cards += `<a class="hw-card" href="#/hw/${key}">
        <div class="hn">${tip(esc(gpu.name), tipLines)}</div>
        <div class="ht">${esc(vendor)} \u00b7 ${vramLabel}</div>
        <div class="hm">${quantLabel} \u00b7 ${weightStr}</div>
        <div class="hf ${fitClass}">${fitText}</div>
      </a>`;
    } else {
      const weightStr = (params * 0.5 / 1e9).toFixed(0) + ' GB';
      cards += `<a class="hw-card" href="#/hw/${key}">
        <div class="hn">${tip(esc(gpu.name), tipLines)}</div>
        <div class="ht">${esc(vendor)} \u00b7 ${vramLabel}</div>
        <div class="hm">Q4 \u00b7 ${weightStr} needed</div>
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
    .filter(p => p.status === 'live')
    .map(p => ({
      name: p.name, price: p.outputPrice, tok: p.throughput,
      href: '#/provider/' + p.name,
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
        href: offering.url || '#/hw/' + offering.gpu,
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
        href: '#/hw/' + key,
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
    chips += `<a class="prov-chip" href="#/provider/${esc(p.name)}" data-tip="${esc(provTitle(p))}">
      <div class="pn">${esc(p.name)}</div>
      ${throughput ? `<div class="pm">${throughput}</div>` : ''}
    </a>`;
  }

  return `<div class="sec">
    <div class="sec-head"><span class="sec-q">What does a provider serve?</span><div class="sec-line"></div><a class="sec-more" href="#/provider/${esc(liveProviders[0].name)}">Pick a provider</a></div>
    <div class="prov-strip">${chips}</div>
  </div>`;
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
