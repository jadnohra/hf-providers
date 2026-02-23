// Search dropdown with local search (pre-cached) + API fallback.
// Supports both the hero search (landing page) and the top-bar search (detail pages).

import * as api from './hf-api.js';
import * as router from './router.js';
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

let trendingCache = null;

export function init() {
  // Use pre-cached models for trending if available
  if (state.models && state.models.length) {
    trendingCache = state.models.slice(0, 5);
  } else {
    api.trendingModels(5).then(results => {
      trendingCache = results.filter(m => m.id);
    }).catch(() => {});
  }

  wireSearch('search-input', 'search-dd');
  wireSearch('top-search-input', 'top-search-dd');

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      document.querySelectorAll('.dd').forEach(dd => dd.classList.remove('open'));
    }
  });
}

function wireSearch(inputId, ddId) {
  const input = document.getElementById(inputId);
  const dd = document.getElementById(ddId);
  if (!input || !dd) return;

  let timer = null;
  let hlIndex = -1;
  let items = [];

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(input.value), 150);
  });

  input.addEventListener('focus', () => render(input.value));

  input.addEventListener('keydown', e => {
    if (!dd.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hlIndex = Math.min(hlIndex + 1, items.length - 1);
      updateHL();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hlIndex = Math.max(hlIndex - 1, 0);
      updateHL();
    } else if (e.key === 'Enter' && hlIndex >= 0 && items[hlIndex]) {
      e.preventDefault();
      router.navigate(items[hlIndex].hash);
      dd.classList.remove('open');
      input.blur();
      input.value = '';
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
    }
  });

  function updateHL() {
    dd.querySelectorAll('.dd-item').forEach((el, i) => {
      el.classList.toggle('hl', i === hlIndex);
    });
    const hl = dd.querySelector('.hl');
    if (hl) hl.scrollIntoView({ block: 'nearest' });
  }

  async function render(query) {
    query = query.trim();
    items = [];
    hlIndex = -1;
    let html = '';

    if (!query) {
      if (trendingCache && trendingCache.length) {
        html += cat('Trending models');
        for (const m of trendingCache.slice(0, 3)) {
          const parts = m.id.split('/');
          const org = parts.length > 1 ? parts[0] : '';
          const name = parts.length > 1 ? parts.slice(1).join('/') : m.id;
          const params = m.safetensors?.total;
          let hint = '';
          if (params) hint += fmtP(params);
          if (m.pipeline_tag) hint += (hint ? ' · ' : '') + m.pipeline_tag;
          const hash = `#/model/${m.id}`;
          items.push({ hash });
          html += ddItem('dd-tag-m', 'model',
            org ? `<span class="o">${esc(org)}/</span>${esc(name)}` : esc(name),
            hint, hash, input);
        }
      }

      const defaultHw = ['rtx_4090', 'm4_max_128', 'm4_pro_48', 'rtx_5090', 'a100_pcie_80_gb', 'h100_sxm5_80_gb'];
      const hw = (state.hardware || []).filter(([k]) => defaultHw.includes(k));
      if (hw.length) {
        html += cat('Popular hardware');
        for (const [key, gpu] of hw) {
          const hash = `#/hw/${key}`;
          items.push({ hash });
          html += ddItem('dd-tag-h', 'hw', esc(gpu.name),
            `${gpu.vram_gb}GB · ${gpu.vendor}`, hash, input);
        }
      }

      html += cat('Top providers');
      for (const p of PROVIDERS.slice(0, 3)) {
        const hash = `#/provider/${p.id}`;
        items.push({ hash });
        html += ddItem('dd-tag-p', 'prov', esc(p.name), '', hash, input);
      }

      dd.innerHTML = html;
      dd.classList.add('open');
      return;
    }

    // Search hardware + providers locally
    const hwMatches = matchHardware(query);
    const provMatches = matchProviders(query);

    // Search models: local first, API fallback
    let modelMatches = [];
    if (query.length >= 2) {
      if (state.models) {
        const q = query.toLowerCase();
        modelMatches = state.models.filter(m =>
          m.id.toLowerCase().includes(q)
        ).slice(0, 5);
      } else {
        try {
          const results = await api.searchModels(query, 5);
          modelMatches = results.filter(m => m.id);
        } catch { /* ignore */ }
      }
    }

    if (modelMatches.length) {
      html += cat('Models');
      for (const m of modelMatches) {
        const parts = m.id.split('/');
        const org = parts.length > 1 ? parts[0] : '';
        const name = parts.length > 1 ? parts.slice(1).join('/') : m.id;
        const provCount = Array.isArray(m.inferenceProviderMapping)
          ? m.inferenceProviderMapping.filter(p => p.status === 'live').length : 0;
        const params = m.safetensors?.total;
        let hint = '';
        if (params) hint += fmtP(params);
        if (m.pipeline_tag) hint += (hint ? ' · ' : '') + m.pipeline_tag;
        if (provCount) hint += (hint ? ' · ' : '') + provCount + ' live';
        const hash = `#/model/${m.id}`;
        items.push({ hash });
        html += ddItem('dd-tag-m', 'model',
          org ? `<span class="o">${esc(org)}/</span>${esc(name)}` : esc(name),
          hint, hash, input);
      }
    }

    if (hwMatches.length) {
      html += cat('Hardware');
      for (const [key, gpu] of hwMatches) {
        const hash = `#/hw/${key}`;
        items.push({ hash });
        html += ddItem('dd-tag-h', 'hw', esc(gpu.name),
          `${gpu.vram_gb}GB · ${gpu.vendor}`, hash, input);
      }
    }

    if (provMatches.length) {
      html += cat('Providers');
      for (const p of provMatches) {
        const hash = `#/provider/${p.id}`;
        items.push({ hash });
        html += ddItem('dd-tag-p', 'prov', esc(p.name), '', hash, input);
      }
    }

    if (!html) {
      html = '<div style="padding:12px;text-align:center;color:var(--dm);font-size:11px">No results</div>';
    }

    dd.innerHTML = html;
    dd.classList.add('open');
  }
}

function matchHardware(query) {
  if (!state.hardware) return [];
  const q = query.toLowerCase().replace(/[-_ ]/g, '');
  return state.hardware.filter(([key, gpu]) => {
    const k = key.replace(/_/g, '');
    const n = gpu.name.toLowerCase().replace(/[-_ ]/g, '');
    return k.includes(q) || n.includes(q);
  }).slice(0, 4);
}

function matchProviders(query) {
  const q = query.toLowerCase();
  return PROVIDERS.filter(p =>
    p.id.includes(q) || p.name.toLowerCase().includes(q)
  ).slice(0, 4);
}

function cat(label) {
  return `<div class="dd-cat">${esc(label)}</div>`;
}

function ddItem(tagClass, tagLabel, name, hint, hash, input) {
  const inputId = input.id;
  return `<div class="dd-item"
    onmouseenter="this.parentNode.querySelectorAll('.dd-item').forEach(el=>el.classList.remove('hl'));this.classList.add('hl')"
    onclick="window.location.hash='${esc(hash)}';this.closest('.dd').classList.remove('open');document.getElementById('${inputId}').value=''"
    ><span class="dd-tag ${tagClass}">${tagLabel}</span>
    <div class="dd-name">${name}</div>
    <div class="dd-hint">${esc(hint)}</div></div>`;
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
