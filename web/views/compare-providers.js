// Provider vs Provider comparison view: /compare/cerebras-vs-sambanova
// Side-by-side table of shared models with price, throughput, ratio column.

import * as api from '../lib/hf-api.js';
import { parseModel } from '../lib/parse.js';
import { wireSort } from '../lib/sort.js';
import { navigate } from '../lib/router.js';
import { state } from '../app.js';
import {
  esc, fmtP, ratioCell, providerName,
  canonicalOrder, populateProviderDropdown,
} from '../lib/compare-utils.js';

function modelsForProvider(provId) {
  if (state.models) {
    return Promise.resolve(
      state.models.filter(m =>
        Array.isArray(m.inferenceProviderMapping) &&
        m.inferenceProviderMapping.some(ipm => ipm.provider === provId && ipm.status === 'live')
      )
    );
  }
  return api.modelsByProvider(provId, 50);
}

export function render(container, idA, idB) {
  const nameA = providerName(idA);
  const nameB = providerName(idB);

  container.innerHTML = `<div class="loading">Loading comparison...</div>`;
  let cancelled = false;

  Promise.all([modelsForProvider(idA), modelsForProvider(idB)]).then(([resultsA, resultsB]) => {
    if (cancelled) return;

    const modelsA = resultsA.map(parseModel).filter(Boolean);
    const modelsB = resultsB.map(parseModel).filter(Boolean);

    const aMap = new Map();
    for (const m of modelsA) {
      const prov = m.providers.find(p => p.name === idA);
      if (prov) aMap.set(m.id, { model: m, prov });
    }
    const bMap = new Map();
    for (const m of modelsB) {
      const prov = m.providers.find(p => p.name === idB);
      if (prov) bMap.set(m.id, { model: m, prov });
    }

    const allIds = new Set([...aMap.keys(), ...bMap.keys()]);
    const both = [], onlyA = [], onlyB = [];
    for (const id of allIds) {
      const inA = aMap.get(id);
      const inB = bMap.get(id);
      if (inA && inB) both.push({ model: inA.model, a: inA.prov, b: inB.prov });
      else if (inA) onlyA.push({ model: inA.model, a: inA.prov });
      else onlyB.push({ model: inB.model, b: inB.prov });
    }

    // Summary stats
    let avgTokA = 0, avgTokB = 0, cntTokA = 0, cntTokB = 0;
    let avgPriceA = 0, avgPriceB = 0, cntPriceA = 0, cntPriceB = 0;
    for (const { a, b } of both) {
      if (a.throughput) { avgTokA += a.throughput; cntTokA++; }
      if (b.throughput) { avgTokB += b.throughput; cntTokB++; }
      if (a.outputPrice != null) { avgPriceA += a.outputPrice; cntPriceA++; }
      if (b.outputPrice != null) { avgPriceB += b.outputPrice; cntPriceB++; }
    }
    avgTokA = cntTokA ? avgTokA / cntTokA : 0;
    avgTokB = cntTokB ? avgTokB / cntTokB : 0;
    avgPriceA = cntPriceA ? avgPriceA / cntPriceA : 0;
    avgPriceB = cntPriceB ? avgPriceB / cntPriceB : 0;

    let html = '';

    // Header with pickers
    html += `<div class="cmp-header">
      <div class="cmp-side">
        <div class="cmp-side-name">${esc(nameA)} <span class="cmp-picker"><button class="switch-btn" id="pick-a">switch \u25be</button><div class="dd" id="pick-a-dd"></div></span></div>
        <div class="cmp-side-meta">${aMap.size} models</div>
      </div>
      <div class="cmp-vs">vs</div>
      <div class="cmp-side" style="text-align:right">
        <div class="cmp-side-name"><span class="cmp-picker"><button class="switch-btn" id="pick-b">switch \u25be</button><div class="dd" id="pick-b-dd"></div></span> ${esc(nameB)}</div>
        <div class="cmp-side-meta">${bMap.size} models</div>
      </div>
    </div>`;

    // Summary stats (shared models only)
    if (both.length) {
      html += `<div class="sec"><div class="sec-head"><span class="sec-q">Summary (${both.length} shared models)</span><div class="sec-line"></div></div>
        <div class="spec-grid">
          <div class="spec-item"><div class="spec-val">${aMap.size}</div><div class="spec-label">${esc(nameA)} models</div></div>
          <div class="spec-item"><div class="spec-val">${bMap.size}</div><div class="spec-label">${esc(nameB)} models</div></div>
          <div class="spec-item"><div class="spec-val">${both.length}</div><div class="spec-label">Shared</div></div>`;
      if (cntTokA && cntTokB) {
        const tokACls = avgTokA >= avgTokB ? 'cc-best' : '';
        const tokBCls = avgTokB >= avgTokA ? 'cc-best' : '';
        html += `<div class="spec-item"><div class="spec-val ${tokACls}">${Math.round(avgTokA)}</div><div class="spec-label">${esc(nameA)} avg tok/s</div></div>
          <div class="spec-item"><div class="spec-val ${tokBCls}">${Math.round(avgTokB)}</div><div class="spec-label">${esc(nameB)} avg tok/s</div></div>`;
      }
      if (cntPriceA && cntPriceB) {
        const prACls = avgPriceA <= avgPriceB ? 'cc-best' : '';
        const prBCls = avgPriceB <= avgPriceA ? 'cc-best' : '';
        html += `<div class="spec-item"><div class="spec-val ${prACls}">$${avgPriceA.toFixed(2)}</div><div class="spec-label">${esc(nameA)} avg $/1M</div></div>
          <div class="spec-item"><div class="spec-val ${prBCls}">$${avgPriceB.toFixed(2)}</div><div class="spec-label">${esc(nameB)} avg $/1M</div></div>`;
      }
      html += `</div></div>`;
    }

    // Comparison table
    html += `<div class="sec"><div class="sec-head"><span class="sec-q">${esc(nameA)} vs ${esc(nameB)}</span><div class="sec-line"></div></div>
      <table class="mt" id="cmp-table">
      <thead><tr>
        <th>Model</th>
        <th colspan="2" style="text-align:center;border-left:2px solid var(--bd)">${esc(nameA)}</th>
        <th colspan="2" style="text-align:center;border-left:2px solid var(--bd)">${esc(nameB)}</th>
        <th rowspan="2" style="border-left:2px solid var(--bd);text-align:center">vs</th>
      </tr>
      <tr>
        <th></th>
        <th style="border-left:2px solid var(--bd)">$/1M out</th><th>tok/s</th>
        <th style="border-left:2px solid var(--bd)">$/1M out</th><th>tok/s</th>
      </tr></thead>
      <tbody>`;

    if (both.length) {
      html += `<tr class="group-row"><td colspan="6">Both providers \u00b7 ${both.length} model${both.length !== 1 ? 's' : ''}</td></tr>`;
      for (const { model, a, b } of both) html += compareRow(model, a, b);
    }
    if (onlyA.length) {
      html += `<tr class="group-row"><td colspan="6">Only on ${esc(nameA)} \u00b7 ${onlyA.length}</td></tr>`;
      for (const { model, a } of onlyA) html += compareRow(model, a, null);
    }
    if (onlyB.length) {
      html += `<tr class="group-row"><td colspan="6">Only on ${esc(nameB)} \u00b7 ${onlyB.length}</td></tr>`;
      for (const { model, b } of onlyB) html += compareRow(model, null, b);
    }

    html += '</tbody></table>';
    html += `<div style="font-size:9px;color:var(--dm);margin-top:6px">${both.length + onlyA.length + onlyB.length} total \u00b7 ${both.length} shared \u00b7 ${onlyA.length} only ${esc(nameA)} \u00b7 ${onlyB.length} only ${esc(nameB)}</div>`;
    html += '</div>';

    container.innerHTML = html;
    wireSort(container.querySelector('#cmp-table'));

    // Wire provider pickers
    wirePicker(container, '#pick-a', '#pick-a-dd', idA, idB, 'a');
    wirePicker(container, '#pick-b', '#pick-b-dd', idB, idA, 'b');

  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Error: ${esc(err.message)}</div>`;
  });

  return () => { cancelled = true; };
}

function wirePicker(container, btnSel, ddSel, currentId, otherId, side) {
  const btn = container.querySelector(btnSel);
  const dd = container.querySelector(ddSel);
  if (!btn || !dd) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (dd.classList.contains('open')) {
      dd.classList.remove('open');
      return;
    }
    populateProviderDropdown(dd, currentId, newId => {
      const [a, b] = side === 'a'
        ? canonicalOrder(newId, otherId)
        : canonicalOrder(otherId, newId);
      navigate(`/compare/${a}-vs-${b}`);
    });
    dd.classList.add('open');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest(btnSel) && !e.target.closest(ddSel)) {
      dd.classList.remove('open');
    }
  });
}

function compareRow(model, a, b) {
  const shortName = model.id.split('/').pop();
  const aPrice = a?.outputPrice;
  const bPrice = b?.outputPrice;
  const aTok = a?.throughput;
  const bTok = b?.throughput;

  const aPriceCls = (aPrice != null && bPrice != null && aPrice <= bPrice) ? 'cc-best' : '';
  const bPriceCls = (aPrice != null && bPrice != null && bPrice <= aPrice) ? 'cc-best' : '';
  const aTokCls = (aTok != null && bTok != null && aTok >= bTok) ? 'cc-best' : '';
  const bTokCls = (aTok != null && bTok != null && bTok >= aTok) ? 'cc-best' : '';

  const aStyle = a ? '' : 'color:var(--dm)';
  const bStyle = b ? '' : 'color:var(--dm)';

  let ratio = '';
  if (aTok != null && bTok != null && aTok > 0 && bTok > 0) {
    ratio = ratioCell(aTok, bTok, true);
  } else if (aPrice != null && bPrice != null && aPrice > 0 && bPrice > 0) {
    const r = bPrice / aPrice;
    const color = r >= 1.05 ? 'var(--gn)' : r <= 0.95 ? 'var(--rd)' : 'var(--dm)';
    const label = r >= 0.95 && r <= 1.05 ? '~1x' : r.toFixed(1) + 'x$';
    ratio = `<span style="color:${color};font-weight:600">${label}</span>`;
  } else if (a && !b) {
    ratio = `<span style="color:var(--dm)">only</span>`;
  } else if (!a && b) {
    ratio = `<span style="color:var(--dm)">\u2014</span>`;
  }

  return `<tr>
    <td class="name"><a class="link" href="/model/${esc(model.id)}" data-tip="${esc(model.id + (model.safetensorsParams ? ' \u00b7 ' + fmtP(model.safetensorsParams) : ''))}">${esc(shortName)}</a></td>
    <td class="${aPriceCls}" style="border-left:2px solid var(--bd);${aStyle}">${aPrice != null ? '$' + aPrice.toFixed(2) : (a ? '' : '\u2014')}</td>
    <td class="${aTokCls}" style="${aStyle}">${aTok != null ? Math.round(aTok) : (a ? '' : '\u2014')}</td>
    <td class="${bPriceCls}" style="border-left:2px solid var(--bd);${bStyle}">${bPrice != null ? '$' + bPrice.toFixed(2) : (b ? '' : '\u2014')}</td>
    <td class="${bTokCls}" style="${bStyle}">${bTok != null ? Math.round(bTok) : (b ? '' : '\u2014')}</td>
    <td style="border-left:2px solid var(--bd);text-align:center;font-size:10px">${ratio}</td>
  </tr>`;
}
