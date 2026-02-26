// "Can I run X on Y" check view: /check/meta-llama/Llama-3.3-70B-Instruct/rtx-4090
// Quant table with fit/weight/decode/prefill, verdict, alternatives.

import * as wasm from '../lib/wasm.js';
import * as api from '../lib/hf-api.js';
import { parseModel } from '../lib/parse.js';
import { navigate } from '../lib/router.js';
import { state } from '../app.js';
import {
  esc, fmtP, fmtTokS, slugToGpuKey, gpuKeyToSlug,
  POPULAR_GPUS, populateHwDropdown,
} from '../lib/compare-utils.js';

export function render(container, modelId, gpuSlug) {
  const gpuKey = slugToGpuKey(gpuSlug);
  const gpus = state.hardware || [];
  const found = wasm.findGpu(gpus, gpuKey);

  if (!found) {
    container.innerHTML = `<div class="loading">Hardware not found: ${esc(gpuSlug)}</div>`;
    return;
  }

  const [key, gpu] = found;

  container.innerHTML = `<div class="loading">Checking ${esc(modelId)} on ${esc(gpu.name)}...</div>`;
  let cancelled = false;

  resolveModel(modelId).then(raw => {
    if (cancelled) return;
    if (!raw) {
      container.innerHTML = `<div class="loading">Model not found: ${esc(modelId)}</div>`;
      return;
    }

    const model = parseModel(raw);
    if (!model) {
      container.innerHTML = `<div class="loading">Could not parse model: ${esc(modelId)}</div>`;
      return;
    }

    const params = model.safetensorsParams;
    if (!params) {
      container.innerHTML = `<div class="loading">No parameter count available for ${esc(modelId)}</div>`;
      return;
    }

    const shortName = model.id.split('/').pop();
    const isMoe = wasm.isMoe(shortName);

    // Compute estimates
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

    // Determine overall verdict
    const fittingRows = rows.filter(r => r.fits);
    const bestFit = fittingRows.length > 0
      ? fittingRows.reduce((a, b) => (a.decode || 0) > (b.decode || 0) ? a : b)
      : null;

    let verdictClass, verdictText;
    if (!bestFit) {
      verdictClass = 'verdict-no';
      verdictText = `${shortName} won't fit on ${gpu.name}`;
    } else if (bestFit.decode && bestFit.decode >= 30) {
      verdictClass = 'verdict-yes';
      verdictText = `Yes -- ${shortName} runs comfortably on ${gpu.name}`;
    } else {
      verdictClass = 'verdict-tight';
      verdictText = `Tight -- ${shortName} fits on ${gpu.name} but performance may be limited`;
    }

    let html = '';

    // Header with pickers
    html += `<div class="spec-header" style="display:block">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <a class="link" href="/model/${esc(model.id)}" style="font-size:18px;font-weight:800;letter-spacing:-.5px">${esc(shortName)}</a>
        <span style="color:var(--dm);font-size:12px">on</span>
        <a class="link" href="/hw/${esc(key)}" style="font-size:18px;font-weight:800;letter-spacing:-.5px">${esc(gpu.name)}</a>
      </div>
      <div style="margin-top:4px;font-size:11px;color:var(--dm)">${fmtP(params)} params \u00b7 ${gpu.vram_gb}GB VRAM \u00b7 ${Math.round(gpu.mem_bw_gb_s)} GB/s</div>
    </div>`;

    if (isMoe) {
      html += `<div class="moe-warn" style="margin-bottom:12px">MoE model -- estimates may be inaccurate if param count reflects active params only</div>`;
    }

    // Verdict box
    html += `<div class="verdict-box"><span class="${verdictClass}">${esc(verdictText)}</span>`;
    if (bestFit) {
      html += `<div style="margin-top:4px;font-size:11px;color:var(--dm)">Best: ${bestFit.quant} at ${Math.round(bestFit.decode)} tok/s decode, ${bestFit.weight_gb.toFixed(0)} GB weights</div>`;
    }
    html += '</div>';

    // Quant table
    if (rows.length) {
      const multiRuntime = runtimes.length > 1;
      html += `<div class="sec"><div class="sec-head"><span class="sec-q">Quantization options</span><div class="sec-line"></div></div>
        <table class="mt">
          <thead><tr><th>Quant</th><th>Weights</th><th>Fit</th><th>Decode</th><th>Prefill</th>${multiRuntime ? '<th>Runtime</th>' : ''}</tr></thead>
          <tbody>`;

      for (const r of rows) {
        let fitClass, fitText;
        if (!r.fits) {
          fitClass = 'fit-n'; fitText = "won't fit";
        } else if (r.decode && r.decode >= 30) {
          fitClass = 'fit-y'; fitText = 'comfortable';
        } else {
          fitClass = 'fit-t'; fitText = 'tight';
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

      html += '</tbody></table></div>';
    }

    // Alternatives: other popular GPUs
    html += renderAlternatives(model, params, key);

    // Pickers: switch model or GPU
    html += `<div class="sec"><div class="sec-head"><span class="sec-q">Try another GPU</span><div class="sec-line"></div></div>
      <div class="search-wrap" style="max-width:none;margin:0">
        <button class="switch-btn" id="check-hw-switch" style="padding:6px 14px;font-size:11px">Switch GPU \u25be</button>
        <div class="dd" id="check-hw-dd" style="position:absolute;left:0;top:100%;min-width:300px;z-index:100;max-height:360px;overflow-y:auto"></div>
      </div>
    </div>`;

    container.innerHTML = html;

    // Wire GPU picker
    const hwBtn = container.querySelector('#check-hw-switch');
    const hwDd = container.querySelector('#check-hw-dd');
    if (hwBtn && hwDd) {
      hwBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (hwDd.classList.contains('open')) {
          hwDd.classList.remove('open');
          return;
        }
        populateHwDropdown(hwDd, key, state.hardware, item => {
          hwDd.classList.remove('open');
          navigate(`/check/${model.id}/${gpuKeyToSlug(item.key)}`);
        });
        hwDd.classList.add('open');
        const inp = hwDd.querySelector('.dd-search');
        if (inp) inp.focus();
      });

      document.addEventListener('click', e => {
        if (!e.target.closest('#check-hw-switch') && !e.target.closest('#check-hw-dd')) {
          hwDd.classList.remove('open');
        }
      });
    }

  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Error: ${esc(err.message)}</div>`;
  });

  return () => { cancelled = true; };
}

function resolveModel(modelId) {
  if (state.models) {
    const m = state.models.find(m => m.id === modelId);
    if (m) return Promise.resolve(m);
  }
  return api.searchModels(modelId, 1).then(results => {
    const exact = results.find(m => m.id === modelId);
    return exact || (results.length ? results[0] : null);
  });
}

function renderAlternatives(model, params, currentKey) {
  const gpus = state.hardware || [];
  // Use popular GPUs + a few more for alternatives
  const altKeys = [...POPULAR_GPUS, 'rtx_4080', 'rtx_3080_ti', 'm3_max_96', 'm4_max_64', 'h200_sxm_141_gb'];
  const alts = [];

  for (const altKey of altKeys) {
    if (altKey === currentKey) continue;
    const entry = gpus.find(([k]) => k === altKey);
    if (!entry) continue;
    const altGpu = entry[1];

    // Get best fitting result
    const runtimes = [];
    if (altGpu.mlx_decode_eff != null) runtimes.push('mlx');
    runtimes.push('llama.cpp');

    let bestDecode = null;
    let bestQuant = null;
    let bestWeight = null;
    let bestFits = false;

    for (const rt of runtimes) {
      for (const q of ['Q4', 'Q8', 'FP16']) {
        const est = wasm.estimatePerf(altGpu, params, q, rt);
        if (!est || est.fit !== 'Full') continue;
        if (!bestDecode || (est.decode_tok_s || 0) > bestDecode) {
          bestDecode = est.decode_tok_s;
          bestQuant = q;
          bestWeight = est.weight_gb;
          bestFits = true;
        }
      }
    }

    if (bestFits) {
      alts.push({ key: altKey, gpu: altGpu, decode: bestDecode, quant: bestQuant, weight: bestWeight });
    }
  }

  if (!alts.length) return '';

  alts.sort((a, b) => (b.decode || 0) - (a.decode || 0));

  let html = `<div class="sec"><div class="sec-head"><span class="sec-q">Alternatives that fit</span><div class="sec-line"></div></div>
    <div class="hw-row">`;

  for (const alt of alts.slice(0, 8)) {
    let fitClass;
    if (alt.decode && alt.decode >= 30) fitClass = 'fit-y';
    else fitClass = 'fit-t';

    html += `<a class="hw-card" href="/check/${esc(model.id)}/${gpuKeyToSlug(alt.key)}">
      <div class="hn">${esc(alt.gpu.name)}</div>
      <div class="ht">${alt.gpu.vram_gb}GB VRAM</div>
      <div class="hm">${alt.quant} \u00b7 ${alt.weight.toFixed(0)} GB</div>
      <div class="hf ${fitClass}">${alt.decode ? Math.round(alt.decode) + ' tok/s' : '\u2014'}</div>
    </a>`;
  }

  html += '</div></div>';
  return html;
}
