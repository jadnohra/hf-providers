// Provider detail view: header (clickable to switch), comparison chips, unified model table.
// Uses pre-cached state.models when available, falls back to API.
// Click title to switch provider. Click comparison chip to compare; click again to unselect.

import * as api from '../lib/hf-api.js';
import { parseModel, readiness } from '../lib/parse.js';
import { wireSort } from '../lib/sort.js';
import { state } from '../app.js';

const PROVIDERS = [
  { id: 'cerebras', name: 'Cerebras' }, { id: 'cohere', name: 'Cohere' },
  { id: 'fal-ai', name: 'fal' }, { id: 'featherless-ai', name: 'Featherless' },
  { id: 'fireworks-ai', name: 'Fireworks' }, { id: 'groq', name: 'Groq' },
  { id: 'hyperbolic', name: 'Hyperbolic' }, { id: 'nebius', name: 'Nebius' },
  { id: 'novita', name: 'Novita' }, { id: 'nscale', name: 'Nscale' },
  { id: 'ovhcloud', name: 'OVHcloud' }, { id: 'publicai', name: 'Public AI' },
  { id: 'replicate', name: 'Replicate' }, { id: 'sambanova', name: 'SambaNova' },
  { id: 'scaleway', name: 'Scaleway' }, { id: 'together', name: 'Together AI' },
  { id: 'wavespeed', name: 'WaveSpeed' }, { id: 'zai-org', name: 'Z.ai' },
  { id: 'hf-inference', name: 'HF Inference' },
];

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

export function render(container, match) {
  const providerId = match[1];
  const provInfo = PROVIDERS.find(p => p.id === providerId);
  const displayName = provInfo ? provInfo.name : providerId;

  container.innerHTML = `<div class="loading">Loading models for ${esc(displayName)}...</div>`;
  let cancelled = false;

  modelsForProvider(providerId).then(results => {
    if (cancelled) return;

    const models = results.map(parseModel).filter(Boolean);
    const rows = [];
    for (const m of models) {
      const prov = m.providers.find(p => p.name === providerId);
      if (prov) rows.push({ model: m, prov });
    }

    const overlapping = new Set();
    for (const { model } of rows) {
      for (const p of model.providers) {
        if (p.name !== providerId && p.status === 'live') overlapping.add(p.name);
      }
    }

    let hotCount = 0;
    let maxThroughput = 0;
    for (const r of rows) {
      const rd = readiness(r.prov);
      if (rd === 'hot') hotCount++;
      if (r.prov.throughput && r.prov.throughput > maxThroughput) maxThroughput = r.prov.throughput;
    }

    let html = '';

    // Header (clickable title to switch provider)
    html += `<div class="prov-header">
      <div style="position:relative">
        <div class="prov-title" id="prov-switch" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:4px;text-decoration-color:var(--dm)">${esc(displayName)} <span style="font-size:11px;color:var(--dm)">\u25be</span></div>
        <div class="dd" id="prov-switch-dd" style="position:absolute;left:0;top:100%;min-width:240px;z-index:100;max-height:360px;overflow-y:auto"></div>
      </div>
      <div class="prov-stats">
        <div class="ps-item"><div class="ps-val">${rows.length}</div><div class="ps-label">Models</div></div>
        <div class="ps-item"><div class="ps-val">${hotCount}</div><div class="ps-label">Hot</div></div>
        ${maxThroughput ? `<div class="ps-item"><div class="ps-val">${Math.round(maxThroughput)}</div><div class="ps-label">Max tok/s</div></div>` : ''}
      </div>
    </div>`;

    // Pick provider to compare
    html += `<div class="sec">
      <div class="sec-head"><span class="sec-q">Pick provider to compare</span><div class="sec-line"></div></div>
      <div class="prov-strip" id="compare-chips">`;

    for (const p of PROVIDERS) {
      if (p.id === providerId) continue;
      const hasOverlap = overlapping.has(p.id);
      const dimStyle = hasOverlap ? '' : 'opacity:0.35';
      html += `<div class="prov-chip compare-pick" data-id="${esc(p.id)}" style="cursor:pointer;${dimStyle}">
        <div class="pn">${esc(p.name)}</div>
      </div>`;
    }

    html += `</div></div>`;

    // Model table container
    html += `<div class="sec" id="model-table-sec"></div>`;

    container.innerHTML = html;

    wireProviderSwitch(container, providerId);
    renderSingleTable(container, displayName, rows);
    wireCompare(container, providerId, displayName, rows);
  }).catch(err => {
    if (cancelled) return;
    container.innerHTML = `<div class="loading">Failed: ${esc(err.message)}</div>`;
  });

  return () => { cancelled = true; };
}

// ── Provider switcher dropdown ──

function wireProviderSwitch(container, currentId) {
  const title = container.querySelector('#prov-switch');
  const dd = container.querySelector('#prov-switch-dd');
  if (!title || !dd) return;

  title.addEventListener('click', e => {
    e.stopPropagation();
    if (dd.classList.contains('open')) {
      dd.classList.remove('open');
      return;
    }

    let html = '';
    for (const p of PROVIDERS) {
      const isCurrent = p.id === currentId;
      const style = isCurrent ? 'font-weight:700' : '';
      html += `<div class="dd-item" data-id="${esc(p.id)}" style="cursor:pointer;${style}">
        <div class="dd-name">${esc(p.name)}</div>
      </div>`;
    }
    dd.innerHTML = html;
    dd.classList.add('open');

    dd.querySelectorAll('.dd-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        dd.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
        el.classList.add('hl');
      });
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        dd.classList.remove('open');
        window.location.hash = '#/provider/' + el.dataset.id;
      });
    });
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#prov-switch') && !e.target.closest('#prov-switch-dd')) {
      dd.classList.remove('open');
    }
  });
}

// ── Single provider table ──

function renderSingleTable(container, displayName, rows) {
  const sec = container.querySelector('#model-table-sec');

  let html = `<div class="sec-head"><span class="sec-q">Models on ${esc(displayName)}</span><div class="sec-line"></div></div>
    <table class="mt" id="prov-table">
      <thead><tr><th>Status</th><th>Model</th><th>Task</th><th>$/1M in</th><th>$/1M out</th><th>Throughput</th><th>Tools</th><th>JSON</th></tr></thead>
      <tbody>`;

  for (const { model, prov } of rows) {
    const r = readiness(prov);
    const dotClass = r === 'hot' ? 'dt-hot' : r === 'warm' ? 'dt-warm' : 'dt-cold';
    const slClass = r === 'hot' ? 'sl-hot' : r === 'warm' ? 'sl-warm' : 'sl-cold';
    const shortName = model.id.split('/').pop();
    html += `<tr>
      <td><span class="dt ${dotClass}"></span><span class="sl ${slClass}">${r}</span></td>
      <td class="name"><a class="link" href="#/model/${esc(model.id)}">${esc(shortName)}</a></td>
      <td>${esc(prov.task || model.pipelineTag || '')}</td>
      <td>${prov.inputPrice != null ? '$' + prov.inputPrice.toFixed(2) : ''}</td>
      <td>${prov.outputPrice != null ? '$' + prov.outputPrice.toFixed(2) : ''}</td>
      <td>${prov.throughput != null ? Math.round(prov.throughput) + ' tok/s' : ''}</td>
      <td style="color:var(${prov.supportsTools === true ? '--gn' : '--dm'})">${prov.supportsTools === true ? 'yes' : prov.supportsTools === false ? 'no' : ''}</td>
      <td style="color:var(${prov.supportsStructured === true ? '--gn' : '--dm'})">${prov.supportsStructured === true ? 'yes' : prov.supportsStructured === false ? 'no' : ''}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  sec.innerHTML = html;
  wireSort(sec.querySelector('#prov-table'));
}

// ── Comparison ──

function wireCompare(container, providerId, displayName, rows) {
  const chips = container.querySelectorAll('.compare-pick');
  const sec = container.querySelector('#model-table-sec');

  const aMap = new Map();
  for (const { model, prov } of rows) {
    aMap.set(model.id, { model, prov });
  }

  chips.forEach(chip => {
    chip.addEventListener('click', async () => {
      const wasSelected = chip.classList.contains('selected');

      chips.forEach(c => {
        c.style.borderColor = '';
        c.style.background = '';
        c.classList.remove('selected');
      });

      if (wasSelected) {
        renderSingleTable(container, displayName, rows);
        return;
      }

      chip.classList.add('selected');
      chip.style.borderColor = 'var(--ac)';
      chip.style.background = 'var(--ac-s)';

      const otherId = chip.dataset.id;
      const otherInfo = PROVIDERS.find(p => p.id === otherId);
      const otherName = otherInfo ? otherInfo.name : otherId;

      sec.innerHTML = '<div class="loading">Loading comparison...</div>';

      try {
        const otherResults = await modelsForProvider(otherId);
        const otherModels = otherResults.map(parseModel).filter(Boolean);

        const bMap = new Map();
        for (const m of otherModels) {
          const prov = m.providers.find(p => p.name === otherId);
          if (prov) bMap.set(m.id, { model: m, prov });
        }

        const allIds = new Set([...aMap.keys(), ...bMap.keys()]);

        const both = [];
        const onlyA = [];
        const onlyB = [];
        for (const id of allIds) {
          const inA = aMap.get(id);
          const inB = bMap.get(id);
          if (inA && inB) both.push({ model: inA.model, a: inA.prov, b: inB.prov });
          else if (inA) onlyA.push({ model: inA.model, a: inA.prov });
          else onlyB.push({ model: inB.model, b: inB.prov });
        }

        let html = `<div class="sec-head"><span class="sec-q">${esc(displayName)} vs ${esc(otherName)}</span><div class="sec-line"></div></div>
          <table class="mt" id="prov-table">
          <thead><tr>
            <th>Model</th>
            <th colspan="2" style="text-align:center;border-left:2px solid var(--bd)">${esc(displayName)}</th>
            <th colspan="2" style="text-align:center;border-left:2px solid var(--bd)">${esc(otherName)}</th>
          </tr>
          <tr>
            <th></th>
            <th style="border-left:2px solid var(--bd)">$/1M out</th><th>tok/s</th>
            <th style="border-left:2px solid var(--bd)">$/1M out</th><th>tok/s</th>
          </tr></thead>
          <tbody>`;

        if (both.length) {
          html += `<tr class="group-row"><td colspan="5">Both providers \u00b7 ${both.length} model${both.length !== 1 ? 's' : ''}</td></tr>`;
          for (const { model, a, b } of both) html += compareRow(model, a, b);
        }
        if (onlyA.length) {
          html += `<tr class="group-row"><td colspan="5">Only on ${esc(displayName)} \u00b7 ${onlyA.length}</td></tr>`;
          for (const { model, a } of onlyA) html += compareRow(model, a, null);
        }
        if (onlyB.length) {
          html += `<tr class="group-row"><td colspan="5">Only on ${esc(otherName)} \u00b7 ${onlyB.length}</td></tr>`;
          for (const { model, b } of onlyB) html += compareRow(model, null, b);
        }

        html += '</tbody></table>';
        html += `<div style="font-size:9px;color:var(--dm);margin-top:6px">${both.length + onlyA.length + onlyB.length} total \u00b7 ${both.length} shared \u00b7 ${onlyA.length} only ${esc(displayName)} \u00b7 ${onlyB.length} only ${esc(otherName)}</div>`;

        sec.innerHTML = html;
        wireSort(sec.querySelector('#prov-table'));
      } catch (err) {
        sec.innerHTML = `<div class="loading">Error: ${esc(err.message)}</div>`;
      }
    });
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

  return `<tr>
    <td class="name"><a class="link" href="#/model/${esc(model.id)}">${esc(shortName)}</a></td>
    <td class="${aPriceCls}" style="border-left:2px solid var(--bd);${aStyle}">${aPrice != null ? '$' + aPrice.toFixed(2) : (a ? '' : '\u2014')}</td>
    <td class="${aTokCls}" style="${aStyle}">${aTok != null ? Math.round(aTok) : (a ? '' : '\u2014')}</td>
    <td class="${bPriceCls}" style="border-left:2px solid var(--bd);${bStyle}">${bPrice != null ? '$' + bPrice.toFixed(2) : (b ? '' : '\u2014')}</td>
    <td class="${bTokCls}" style="${bStyle}">${bTok != null ? Math.round(bTok) : (b ? '' : '\u2014')}</td>
  </tr>`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
