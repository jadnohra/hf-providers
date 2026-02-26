// Shared utilities for comparison and check pages.

export const PROVIDERS = [
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

const PROVIDER_IDS = new Set(PROVIDERS.map(p => p.id));

/** "rtx-4090" -> "rtx_4090" */
export function slugToGpuKey(slug) {
  return slug.replace(/-/g, '_');
}

/** "rtx_4090" -> "rtx-4090" */
export function gpuKeyToSlug(key) {
  return key.replace(/_/g, '-');
}

/**
 * Resolve a compare slug (the full part after /compare/) into two items.
 * Split on '-vs-', but handle provider IDs that contain hyphens
 * by checking exact provider ID matches first.
 *
 * Returns { a, b, type } where type is 'provider' or 'hw',
 * or null if the slug can't be resolved.
 */
export function resolveCompareSlug(slug, hardware) {
  // Try all possible '-vs-' split points
  const splits = [];
  let idx = slug.indexOf('-vs-');
  while (idx !== -1) {
    splits.push(idx);
    idx = slug.indexOf('-vs-', idx + 1);
  }

  for (const i of splits) {
    const left = slug.slice(0, i);
    const right = slug.slice(i + 4); // '-vs-'.length === 4

    // Check provider pair first (exact match on known IDs)
    if (PROVIDER_IDS.has(left) && PROVIDER_IDS.has(right)) {
      return { a: left, b: right, type: 'provider' };
    }

    // Check hardware pair (slug->key conversion, look up in hardware)
    const keyA = slugToGpuKey(left);
    const keyB = slugToGpuKey(right);
    const hwA = hardware && hardware.find(([k]) => k === keyA);
    const hwB = hardware && hardware.find(([k]) => k === keyB);
    if (hwA && hwB) {
      return { a: keyA, b: keyB, type: 'hw' };
    }
  }

  return null;
}

/** Enforce alphabetical canonical ordering. Returns [a, b] sorted. */
export function canonicalOrder(a, b) {
  return a <= b ? [a, b] : [b, a];
}

/** Render a ratio cell with color coding. higherIsBetter controls color direction. */
export function ratioCell(valA, valB, higherIsBetter) {
  if (valA == null || valB == null || valA <= 0 || valB <= 0) return '';
  const r = valA / valB;
  let color, label;
  if (r >= 0.95 && r <= 1.05) {
    color = 'var(--dm)';
    label = '~1x';
  } else {
    color = (higherIsBetter ? r > 1 : r < 1) ? 'var(--gn)' : 'var(--rd)';
    label = r.toFixed(1) + 'x';
  }
  return `<span style="color:${color};font-weight:600">${label}</span>`;
}

/** HTML-escape a string. */
export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Format a parameter count: 1.5B, 13M, 405K */
export function fmtP(n) {
  if (n >= 1e9) {
    const b = n / 1e9;
    return b >= 100 ? `${b.toFixed(0)}B` : `${b.toFixed(1)}B`;
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return `${(n / 1e3).toFixed(0)}K`;
}

/** Format throughput: "1.2k tok/s" or "405 tok/s" */
export function fmtTokS(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k tok/s`;
  return `${Math.round(v)} tok/s`;
}

/** Provider ID -> display name */
export function providerName(id) {
  const p = PROVIDERS.find(p => p.id === id);
  return p ? p.name : id;
}

/** Popular GPU keys for dropdowns */
export const POPULAR_GPUS = [
  'rtx_4090', 'rtx_5090', 'm4_max_128', 'm4_pro_48', 'm4_pro_24',
  'a100_pcie_80_gb', 'h100_sxm5_80_gb', 'rtx_3090', 'rx_7900_xtx',
];

/**
 * Build a searchable hardware dropdown and attach event handlers.
 * dd: the dropdown container element
 * currentKey: GPU key to exclude (optional)
 * hardware: state.hardware array
 * onSelect: callback({key, gpu}) when item is picked
 */
export function populateHwDropdown(dd, currentKey, hardware, onSelect) {
  const gpus = hardware || [];

  function renderList(query) {
    const q = query.toLowerCase().replace(/[-_ ]/g, '');
    let matches;
    if (!q) {
      const popEntries = POPULAR_GPUS.map(k => gpus.find(([gk]) => gk === k)).filter(Boolean);
      matches = popEntries.filter(([k]) => k !== currentKey);
    } else {
      matches = gpus.filter(([key, gpu]) => {
        if (key === currentKey) return false;
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
    + `<div class="dd-list">${renderList('')}</div>`;

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
        const key = el.dataset.key;
        const entry = gpus.find(([k]) => k === key);
        onSelect({ key, gpu: entry ? entry[1] : null });
      });
      el.addEventListener('mouseenter', () => {
        list.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
        el.classList.add('hl');
      });
    });
  }
  wireItems();
}

/**
 * Build a provider picker dropdown.
 * dd: the dropdown container element
 * currentId: provider to exclude (optional)
 * onSelect: callback(providerId) when item is picked
 */
export function populateProviderDropdown(dd, currentId, onSelect) {
  let html = '';
  for (const p of PROVIDERS) {
    if (p.id === currentId) continue;
    html += `<div class="dd-item" data-id="${esc(p.id)}" style="cursor:pointer">
      <div class="dd-name">${esc(p.name)}</div>
    </div>`;
  }
  dd.innerHTML = html;

  dd.querySelectorAll('.dd-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      dd.querySelectorAll('.dd-item').forEach(x => x.classList.remove('hl'));
      el.classList.add('hl');
    });
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      dd.classList.remove('open');
      onSelect(el.dataset.id);
    });
  });
}
