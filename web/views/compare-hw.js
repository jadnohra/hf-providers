// Hardware vs Hardware comparison view: /compare/rtx-4090-vs-m4-max-128
// Side-by-side spec comparison + reference model table via wasm.machineReport().

import * as wasm from '../lib/wasm.js';
import { wireSort } from '../lib/sort.js';
import { navigate } from '../lib/router.js';
import { state } from '../app.js';
import {
  esc, fmtP, fmtTokS, ratioCell, gpuKeyToSlug,
  canonicalOrder, populateHwDropdown,
} from '../lib/compare-utils.js';

export function render(container, keyA, keyB) {
  const gpus = state.hardware || [];
  const entryA = gpus.find(([k]) => k === keyA);
  const entryB = gpus.find(([k]) => k === keyB);

  if (!entryA || !entryB) {
    container.innerHTML = `<div class="loading">Hardware not found</div>`;
    return;
  }

  const gpuA = entryA[1];
  const gpuB = entryB[1];

  let html = '';

  // ── Spec comparison header ──
  html += `<div class="cmp-header">
    <div class="cmp-side">
      <div class="cmp-side-name">${esc(gpuA.name)} <span class="cmp-picker"><button class="switch-btn" id="pick-a">switch \u25be</button><div class="dd" id="pick-a-dd" style="min-width:300px"></div></span></div>
      <div class="cmp-side-meta">${esc(vendorLabel(gpuA))}</div>
    </div>
    <div class="cmp-vs">vs</div>
    <div class="cmp-side" style="text-align:right">
      <div class="cmp-side-name"><span class="cmp-picker"><button class="switch-btn" id="pick-b">switch \u25be</button><div class="dd" id="pick-b-dd" style="min-width:300px"></div></span> ${esc(gpuB.name)}</div>
      <div class="cmp-side-meta">${esc(vendorLabel(gpuB))}</div>
    </div>
  </div>`;

  // Spec grid side-by-side
  html += `<div class="sec"><div class="sec-head"><span class="sec-q">Specs</span><div class="sec-line"></div></div>
    <table class="mt">
      <thead><tr><th>Metric</th><th>${esc(gpuA.name)}</th><th>${esc(gpuB.name)}</th><th>vs</th></tr></thead>
      <tbody>`;

  const specs = [
    { label: 'VRAM', a: gpuA.vram_gb, b: gpuB.vram_gb, fmt: v => v + ' GB', higher: true },
    { label: 'Bandwidth', a: gpuA.mem_bw_gb_s, b: gpuB.mem_bw_gb_s, fmt: v => Math.round(v) + ' GB/s', higher: true },
    { label: 'FP16 TFLOPS', a: gpuA.fp16_tflops, b: gpuB.fp16_tflops, fmt: v => v.toFixed(1), higher: true },
    { label: 'TDP', a: gpuA.tdp_w, b: gpuB.tdp_w, fmt: v => v + 'W', higher: false },
  ];
  if (gpuA.street_usd || gpuB.street_usd) {
    specs.push({ label: 'Street price', a: gpuA.street_usd || 0, b: gpuB.street_usd || 0, fmt: v => v ? '$' + v.toLocaleString() : '\u2014', higher: false });
  }

  for (const s of specs) {
    const aCls = (s.a && s.b && ((s.higher && s.a >= s.b) || (!s.higher && s.a <= s.b))) ? 'cc-best' : '';
    const bCls = (s.a && s.b && ((s.higher && s.b >= s.a) || (!s.higher && s.b <= s.a))) ? 'cc-best' : '';
    html += `<tr>
      <td>${esc(s.label)}</td>
      <td class="${aCls}">${s.fmt(s.a)}</td>
      <td class="${bCls}">${s.fmt(s.b)}</td>
      <td style="text-align:center;font-size:10px">${s.a && s.b ? ratioCell(s.a, s.b, s.higher) : ''}</td>
    </tr>`;
  }

  html += '</tbody></table></div>';

  // ── Reference model comparison table ──
  const reportA = wasm.machineReport(gpuA) || [];
  const reportB = wasm.machineReport(gpuB) || [];

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

  html += `<div class="sec"><div class="sec-head"><span class="sec-q">Reference models</span><div class="sec-line"></div></div>
    <table class="mt" id="hw-cmp-table">
    <thead><tr>
      <th>Model</th><th>Params</th>
      <th colspan="3" style="text-align:center;border-left:2px solid var(--bd)">${esc(gpuA.name)}</th>
      <th colspan="3" style="text-align:center;border-left:2px solid var(--bd)">${esc(gpuB.name)}</th>
      <th rowspan="2" style="border-left:2px solid var(--bd);text-align:center">vs</th>
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

    const ratio = decA && decB ? ratioCell(decA, decB, true)
      : (decA && !decB) ? `<span style="color:var(--dm)">only</span>`
      : (!decA && decB) ? `<span style="color:var(--dm)">\u2014</span>`
      : '';

    html += `<tr>
      <td class="name"><a class="link" href="/model/${esc(ref.id)}" data-tip="${esc(ref.id + ' \u00b7 ' + fmtP(ref.params) + ' params')}">${esc(ref.short)}</a></td>
      <td>${fmtP(ref.params)}</td>
      <td style="border-left:2px solid var(--bd);${noA}">${bestA ? bestA.quant : '\u2014'}</td>
      <td class="${decACls}" style="${noA}">${decA ? Math.round(decA) + ' tok/s' : '\u2014'}</td>
      <td style="${noA}">${bestA?.prefill ? fmtTokS(bestA.prefill) : '\u2014'}</td>
      <td style="border-left:2px solid var(--bd);${noB}">${bestB ? bestB.quant : '\u2014'}</td>
      <td class="${decBCls}" style="${noB}">${decB ? Math.round(decB) + ' tok/s' : '\u2014'}</td>
      <td style="${noB}">${bestB?.prefill ? fmtTokS(bestB.prefill) : '\u2014'}</td>
      <td style="border-left:2px solid var(--bd);text-align:center;font-size:10px">${ratio}</td>
    </tr>`;
  }

  html += '</tbody></table>';

  html += `<div style="margin-top:8px;display:flex;gap:16px;font-size:10px;color:var(--dm)">
    <span>${esc(gpuA.name)}: ${gpuA.vram_gb}GB \u00b7 ${Math.round(gpuA.mem_bw_gb_s)} GB/s \u00b7 ${gpuA.tdp_w}W${gpuA.street_usd ? ' \u00b7 $' + gpuA.street_usd.toLocaleString() : ''}</span>
    <span>${esc(gpuB.name)}: ${gpuB.vram_gb}GB \u00b7 ${Math.round(gpuB.mem_bw_gb_s)} GB/s \u00b7 ${gpuB.tdp_w}W${gpuB.street_usd ? ' \u00b7 $' + gpuB.street_usd.toLocaleString() : ''}</span>
  </div>`;

  html += '</div>';

  // ── Cross-links ──
  html += `<div class="sec"><div class="sec-head"><span class="sec-q">Detail pages</span><div class="sec-line"></div></div>
    <div class="prov-strip">
      <a class="prov-chip" href="/hw/${esc(keyA)}"><div class="pn">${esc(gpuA.name)}</div><div class="pm">${gpuA.vram_gb}GB VRAM</div></a>
      <a class="prov-chip" href="/hw/${esc(keyB)}"><div class="pn">${esc(gpuB.name)}</div><div class="pm">${gpuB.vram_gb}GB VRAM</div></a>
    </div>
  </div>`;

  container.innerHTML = html;
  wireSort(container.querySelector('#hw-cmp-table'));

  // Wire HW pickers
  wireHwPicker(container, '#pick-a', '#pick-a-dd', keyA, keyB, 'a');
  wireHwPicker(container, '#pick-b', '#pick-b-dd', keyB, keyA, 'b');
}

function wireHwPicker(container, btnSel, ddSel, currentKey, otherKey, side) {
  const btn = container.querySelector(btnSel);
  const dd = container.querySelector(ddSel);
  if (!btn || !dd) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (dd.classList.contains('open')) {
      dd.classList.remove('open');
      return;
    }
    populateHwDropdown(dd, currentKey, state.hardware, item => {
      dd.classList.remove('open');
      const [a, b] = side === 'a'
        ? canonicalOrder(gpuKeyToSlug(item.key), gpuKeyToSlug(otherKey))
        : canonicalOrder(gpuKeyToSlug(otherKey), gpuKeyToSlug(item.key));
      navigate(`/compare/${a}-vs-${b}`);
    });
    dd.classList.add('open');
    const inp = dd.querySelector('.dd-search');
    if (inp) inp.focus();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest(btnSel) && !e.target.closest(ddSel)) {
      dd.classList.remove('open');
    }
  });
}

function vendorLabel(gpu) {
  if (gpu.vendor === 'apple') return 'Apple Silicon';
  if (gpu.vendor === 'nvidia') return 'NVIDIA ' + (gpu.arch || '');
  if (gpu.vendor === 'amd') return 'AMD ' + (gpu.arch || '');
  return (gpu.vendor || '') + ' ' + (gpu.arch || '');
}
