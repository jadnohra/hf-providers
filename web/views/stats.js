// Fun Stats page: superlatives computed from cached data.

import { parseModel } from '../lib/parse.js';
import * as wasm from '../lib/wasm.js';
import { wireSort } from '../lib/sort.js';
import { state } from '../app.js';

export function render(container) {
  if (!state.models || !state.models.length) {
    container.innerHTML = '<div class="loading">Stats require pre-cached model data</div>';
    return;
  }

  const models = state.models.map(parseModel).filter(Boolean);
  const gpus = state.hardware || [];
  const cloud = state.cloud || [];
  const rows = [];

  // ── Model superlatives ──

  // Fastest inference
  {
    let best = null;
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status === 'live' && p.throughput != null && (!best || p.throughput > best.tok)) {
          best = { model: m.id, provider: p.name, tok: p.throughput };
        }
      }
    }
    if (best) {
      rows.push(row('Fastest inference', shortId(best.model),
        `${Math.round(best.tok)} tok/s via ${best.provider}`,
        '#/model/' + best.model));
    }
  }

  // Slowest inference
  {
    let worst = null;
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status === 'live' && p.throughput != null && p.throughput > 0 && (!worst || p.throughput < worst.tok)) {
          worst = { model: m.id, provider: p.name, tok: p.throughput };
        }
      }
    }
    if (worst) {
      rows.push(row('Slowest inference', shortId(worst.model),
        `${Math.round(worst.tok)} tok/s via ${worst.provider}`,
        '#/model/' + worst.model, 'worst'));
    }
  }

  // Cheapest inference
  {
    let best = null;
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status === 'live' && p.outputPrice != null && p.outputPrice > 0 && (!best || p.outputPrice < best.price)) {
          best = { model: m.id, provider: p.name, price: p.outputPrice };
        }
      }
    }
    if (best) {
      rows.push(row('Cheapest inference', shortId(best.model),
        `$${best.price.toFixed(2)}/1M out via ${best.provider}`,
        '#/model/' + best.model));
    }
  }

  // Priciest inference
  {
    let worst = null;
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status === 'live' && p.outputPrice != null && p.outputPrice > 0 && (!worst || p.outputPrice > worst.price)) {
          worst = { model: m.id, provider: p.name, price: p.outputPrice };
        }
      }
    }
    if (worst) {
      rows.push(row('Priciest inference', shortId(worst.model),
        `$${worst.price.toFixed(2)}/1M out via ${worst.provider}`,
        '#/model/' + worst.model, 'worst'));
    }
  }

  // Most providers
  {
    let best = null;
    for (const m of models) {
      const live = m.providers.filter(p => p.status === 'live').length;
      if (!best || live > best.count) {
        best = { model: m.id, count: live };
      }
    }
    if (best) {
      rows.push(row('Most providers', shortId(best.model),
        `${best.count} live providers`,
        '#/model/' + best.model));
    }
  }

  // Largest served model
  {
    let best = null;
    for (const m of models) {
      if (!m.safetensorsParams) continue;
      const live = m.providers.some(p => p.status === 'live');
      if (live && (!best || m.safetensorsParams > best.params)) {
        best = { model: m.id, params: m.safetensorsParams };
      }
    }
    if (best) {
      rows.push(row('Largest served', shortId(best.model),
        `${fmtP(best.params)} parameters`,
        '#/model/' + best.model));
    }
  }

  // Most liked
  {
    let best = null;
    for (const m of models) {
      if (m.likes > 0 && (!best || m.likes > best.likes)) {
        best = { model: m.id, likes: m.likes };
      }
    }
    if (best) {
      rows.push(row('Most liked', shortId(best.model),
        `${fmtNum(best.likes)} likes`,
        '#/model/' + best.model));
    }
  }

  // Least liked (with providers)
  {
    let worst = null;
    for (const m of models) {
      const live = m.providers.some(p => p.status === 'live');
      if (!live) continue;
      if (!worst || m.likes < worst.likes) {
        worst = { model: m.id, likes: m.likes };
      }
    }
    if (worst) {
      rows.push(row('Least liked', shortId(worst.model),
        `${fmtNum(worst.likes)} likes (but has providers!)`,
        '#/model/' + worst.model, 'worst'));
    }
  }

  // Most downloaded
  {
    let best = null;
    for (const m of models) {
      if (m.downloads > 0 && (!best || m.downloads > best.downloads)) {
        best = { model: m.id, downloads: m.downloads };
      }
    }
    if (best) {
      rows.push(row('Most downloaded', shortId(best.model),
        `${fmtNum(best.downloads)} downloads`,
        '#/model/' + best.model));
    }
  }

  // Most variants
  {
    const SUFFIXES = /-Instruct$|-it$|-Chat$|-GGUF$|-AWQ$|-GPTQ$|-fp8$|-BF16$|-EXL2$|-MLX$/i;
    const QUANT_RE = /GGUF|AWQ|GPTQ|EXL2|MLX|fp8|BF16/i;
    let best = null;
    for (const m of models) {
      const parts = m.id.split('/');
      if (parts.length < 2) continue;
      const org = parts[0];
      const name = parts.slice(1).join('/');
      if (QUANT_RE.test(name)) continue;
      const baseName = name.replace(SUFFIXES, '');
      let count = 0;
      for (const other of models) {
        if (other.id === m.id) continue;
        if (!other.id.startsWith(org + '/')) continue;
        const oName = other.id.split('/').slice(1).join('/');
        if (QUANT_RE.test(oName)) continue;
        const oBase = oName.replace(SUFFIXES, '');
        if (oBase === baseName || baseName.startsWith(oBase + '-') || oBase.startsWith(baseName + '-')) {
          count++;
        }
      }
      if (!best || count > best.count) {
        best = { model: m.id, count };
      }
    }
    if (best && best.count > 0) {
      rows.push(row('Most variants', shortId(best.model),
        `${best.count} related models`,
        '#/model/' + best.model));
    }
  }

  // ── Provider superlatives ──

  {
    const provStats = new Map();
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status !== 'live') continue;
        if (!provStats.has(p.name)) {
          provStats.set(p.name, { count: 0, maxTok: 0, prices: [] });
        }
        const s = provStats.get(p.name);
        s.count++;
        if (p.throughput != null && p.throughput > s.maxTok) s.maxTok = p.throughput;
        if (p.outputPrice != null && p.outputPrice > 0) s.prices.push(p.outputPrice);
      }
    }

    // Biggest catalog
    let biggestProv = null;
    for (const [name, s] of provStats) {
      if (!biggestProv || s.count > biggestProv.count) {
        biggestProv = { name, count: s.count };
      }
    }
    if (biggestProv) {
      rows.push(row('Biggest catalog', biggestProv.name,
        `${biggestProv.count} live models`,
        '#/provider/' + biggestProv.name));
    }

    // Speed king
    let fastestProv = null;
    for (const [name, s] of provStats) {
      if (s.maxTok > 0 && (!fastestProv || s.maxTok > fastestProv.tok)) {
        fastestProv = { name, tok: s.maxTok };
      }
    }
    if (fastestProv) {
      rows.push(row('Speed king', fastestProv.name,
        `${Math.round(fastestProv.tok)} tok/s peak`,
        '#/provider/' + fastestProv.name));
    }

    // Budget pick
    let cheapestProv = null;
    for (const [name, s] of provStats) {
      if (s.prices.length > 0) {
        const avg = s.prices.reduce((a, b) => a + b, 0) / s.prices.length;
        if (!cheapestProv || avg < cheapestProv.avg) {
          cheapestProv = { name, avg };
        }
      }
    }
    if (cheapestProv) {
      rows.push(row('Budget pick', cheapestProv.name,
        `$${cheapestProv.avg.toFixed(2)}/1M avg output`,
        '#/provider/' + cheapestProv.name));
    }
  }

  // ── Hardware superlatives ──

  // Most / least VRAM
  {
    let most = null, least = null;
    for (const [key, gpu] of gpus) {
      if (!most || gpu.vram_gb > most.vram) most = { key, name: gpu.name, vram: gpu.vram_gb };
      if (!least || gpu.vram_gb < least.vram) least = { key, name: gpu.name, vram: gpu.vram_gb };
    }
    if (most) rows.push(row('Most VRAM', most.name, `${most.vram} GB`, '#/hw/' + most.key));
    if (least) rows.push(row('Least VRAM', least.name, `${least.vram} GB`, '#/hw/' + least.key, 'worst'));
  }

  // Most / least watts (TDP)
  {
    let most = null, least = null;
    for (const [key, gpu] of gpus) {
      if (!most || gpu.tdp_w > most.tdp) most = { key, name: gpu.name, tdp: gpu.tdp_w };
      if (!least || gpu.tdp_w < least.tdp) least = { key, name: gpu.name, tdp: gpu.tdp_w };
    }
    if (most) rows.push(row('Power hungry', most.name, `${most.tdp}W TDP`, '#/hw/' + most.key, 'worst'));
    if (least) rows.push(row('Most efficient', least.name, `${least.tdp}W TDP`, '#/hw/' + least.key));
  }

  // Best local value
  {
    const refParams = 8e9;
    const elecRate = 0.15;
    let best = null;
    for (const [key, gpu] of gpus) {
      const runtimes = [];
      if (gpu.mlx_decode_eff != null) runtimes.push('mlx');
      runtimes.push('llama.cpp');
      for (const rt of runtimes) {
        const result = wasm.bestQuant(gpu, refParams, rt);
        if (result && result[1].decode_tok_s > 0) {
          const costPerM = wasm.costPerMillion((gpu.tdp_w / 1000) * elecRate, result[1].decode_tok_s);
          if (!best || costPerM < best.cost) {
            best = { key, name: gpu.name, cost: costPerM, tok: result[1].decode_tok_s };
          }
        }
      }
    }
    if (best) {
      rows.push(row('Best local value', best.name,
        `$${best.cost.toFixed(4)}/1M out (8B model)`,
        '#/hw/' + best.key));
    }
  }

  // Cheapest / priciest cloud
  {
    let cheapest = null, priciest = null;
    for (const [, o] of cloud) {
      const total = o.price_hr * (o.gpu_count || 1);
      const gpuEntry = gpus.find(([k]) => k === o.gpu);
      const gpuName = gpuEntry ? gpuEntry[1].name : o.gpu;
      const entry = { provider: o.provider, gpu: gpuName, price: total };
      if (!cheapest || total < cheapest.price) cheapest = entry;
      if (!priciest || total > priciest.price) priciest = entry;
    }
    if (cheapest) rows.push(row('Cheapest cloud GPU', cheapest.gpu,
      `$${cheapest.price.toFixed(2)}/hr on ${cheapest.provider}`, '#/cloud'));
    if (priciest) rows.push(row('Priciest cloud GPU', priciest.gpu,
      `$${priciest.price.toFixed(2)}/hr on ${priciest.provider}`, '#/cloud', 'worst'));
  }

  // ── Fun matchups ──

  // API vs local break-even
  {
    const gpu4090 = gpus.find(([k]) => k === 'rtx_4090');
    if (gpu4090) {
      const [, gpu] = gpu4090;
      const refParams = 8e9;
      const result = wasm.bestQuant(gpu, refParams, 'llama.cpp');
      if (result && result[1].decode_tok_s > 0) {
        const elecCostPerM = wasm.costPerMillion((gpu.tdp_w / 1000) * 0.15, result[1].decode_tok_s);
        let cheapestApi = null;
        for (const m of models) {
          if (!m.safetensorsParams || m.safetensorsParams < 7e9 || m.safetensorsParams > 10e9) continue;
          for (const p of m.providers) {
            if (p.status === 'live' && p.outputPrice != null && p.outputPrice > 0) {
              if (!cheapestApi || p.outputPrice < cheapestApi) cheapestApi = p.outputPrice;
            }
          }
        }
        if (cheapestApi && cheapestApi > elecCostPerM) {
          const savings = cheapestApi - elecCostPerM;
          const breakeven = (gpu.street_usd || 1800) / (savings / 1e6);
          rows.push(row('RTX 4090 break-even', fmtNum(Math.round(breakeven)) + ' tokens',
            `vs $${cheapestApi.toFixed(2)}/1M cheapest API (8B)`,
            '#/hw/rtx_4090', 'fun'));
        }
      }
    }
  }

  // Fits on a laptop?
  {
    const m4pro = gpus.find(([k]) => k === 'm4_pro_24');
    if (m4pro) {
      const [, gpu] = m4pro;
      let largest = null;
      for (const m of models) {
        if (!m.safetensorsParams) continue;
        const live = m.providers.some(p => p.status === 'live');
        if (!live) continue;
        const result = wasm.bestQuant(gpu, m.safetensorsParams, 'mlx');
        if (result && result[1].fit === 'Full' && result[1].decode_tok_s > 0) {
          if (!largest || m.safetensorsParams > largest.params) {
            largest = { model: m.id, params: m.safetensorsParams, tok: result[1].decode_tok_s };
          }
        }
      }
      if (largest) {
        rows.push(row('Fits on a laptop?', shortId(largest.model),
          `${fmtP(largest.params)} at ${Math.round(largest.tok)} tok/s (M4 Pro 24GB)`,
          '#/model/' + largest.model, 'fun'));
      }
    }
  }

  // ── More fun stats ──

  // Most tasks covered by one model
  {
    let best = null;
    for (const m of models) {
      const tasks = new Set();
      for (const p of m.providers) {
        if (p.status === 'live' && p.task) tasks.add(p.task);
      }
      if (tasks.size > 0 && (!best || tasks.size > best.count)) {
        best = { model: m.id, count: tasks.size, tasks: [...tasks].join(', ') };
      }
    }
    if (best && best.count > 1) {
      rows.push(row('Most versatile', shortId(best.model),
        `${best.count} tasks: ${best.tasks}`,
        '#/model/' + best.model, 'fun'));
    }
  }

  // Smallest model with a provider
  {
    let smallest = null;
    for (const m of models) {
      if (!m.safetensorsParams) continue;
      const live = m.providers.some(p => p.status === 'live');
      if (live && (!smallest || m.safetensorsParams < smallest.params)) {
        smallest = { model: m.id, params: m.safetensorsParams };
      }
    }
    if (smallest) {
      rows.push(row('Smallest served', shortId(smallest.model),
        `${fmtP(smallest.params)} parameters`,
        '#/model/' + smallest.model, 'fun'));
    }
  }

  // Most bandwidth (memory GB/s)
  {
    let best = null;
    for (const [key, gpu] of gpus) {
      if (!best || gpu.mem_bw_gb_s > best.bw) {
        best = { key, name: gpu.name, bw: gpu.mem_bw_gb_s };
      }
    }
    if (best) {
      rows.push(row('Most bandwidth', best.name,
        `${Math.round(best.bw)} GB/s`,
        '#/hw/' + best.key));
    }
  }

  // Best street price per GB VRAM
  {
    let best = null;
    for (const [key, gpu] of gpus) {
      if (!gpu.street_usd || !gpu.vram_gb) continue;
      const ratio = gpu.street_usd / gpu.vram_gb;
      if (!best || ratio < best.ratio) {
        best = { key, name: gpu.name, ratio, price: gpu.street_usd, vram: gpu.vram_gb };
      }
    }
    if (best) {
      rows.push(row('Best $/GB VRAM', best.name,
        `$${Math.round(best.ratio)}/GB ($${best.price} for ${best.vram}GB)`,
        '#/hw/' + best.key));
    }
  }

  // Worst street price per GB VRAM
  {
    let worst = null;
    for (const [key, gpu] of gpus) {
      if (!gpu.street_usd || !gpu.vram_gb) continue;
      const ratio = gpu.street_usd / gpu.vram_gb;
      if (!worst || ratio > worst.ratio) {
        worst = { key, name: gpu.name, ratio, price: gpu.street_usd, vram: gpu.vram_gb };
      }
    }
    if (worst) {
      rows.push(row('Worst $/GB VRAM', worst.name,
        `$${Math.round(worst.ratio)}/GB ($${worst.price} for ${worst.vram}GB)`,
        '#/hw/' + worst.key, 'worst'));
    }
  }

  // Render
  const vibeStyle = {
    best:  { bg: 'rgba(16,185,129,.07)', border: '#10b981', icon: '\u2605', color: '#10b981' },
    worst: { bg: 'rgba(196,144,8,.07)',  border: '#c49008', icon: '\u2193', color: '#c49008' },
    fun:   { bg: 'rgba(98,70,234,.07)',  border: '#6246ea', icon: '\u2666', color: '#6246ea' },
  };

  let html = `<div style="margin-bottom:16px">
    <span style="font-size:16px;font-weight:800">Fun Stats</span>
  </div>`;

  for (const r of rows) {
    const v = vibeStyle[r.vibe] || vibeStyle.best;
    html += `<a href="${esc(r.href)}" style="
      display:flex;align-items:center;gap:10px;
      padding:9px 14px;margin-bottom:3px;
      background:${v.bg};
      border-left:3px solid ${v.border};
      border-radius:0 var(--rs) var(--rs) 0;
      text-decoration:none;color:inherit;
      transition:background .1s;
    " onmouseenter="this.style.background='${v.bg.replace('.06', '.12')}'" onmouseleave="this.style.background='${v.bg}'">
      <span style="color:${v.color};font-size:10px;width:12px;text-align:center;flex-shrink:0">${v.icon}</span>
      <span style="font-size:10px;font-weight:700;color:${v.color};width:130px;white-space:nowrap;flex-shrink:0">${esc(r.label)}</span>
      <span style="font-size:10px;color:var(--mt);width:220px;white-space:nowrap;flex-shrink:0;overflow:hidden;text-overflow:ellipsis">${esc(r.detail)}</span>
      <span style="font-size:12px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right">${esc(r.winner)}</span>
    </a>`;
  }

  container.innerHTML = html;
}

function row(label, winner, detail, href, vibe) {
  return { label, winner, detail, href, vibe: vibe || 'best' };
}

function shortId(id) {
  return id.split('/').pop();
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

function fmtNum(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
