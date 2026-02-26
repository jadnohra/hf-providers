// State of Inference page: analytics at top, fun stats at bottom.
// Layout: GPU tiers, provider analysis, pareto, efficiency, cloud value, weekly report, fun stats.

import { parseModel } from '../lib/parse.js';
import * as wasm from '../lib/wasm.js';
import { state } from '../app.js';

export function render(container) {
  if (!state.models || !state.models.length) {
    container.innerHTML = '<div class="loading">Stats require pre-cached model data</div>';
    return;
  }

  const models = state.models.map(parseModel).filter(Boolean);
  const gpus = state.hardware || [];
  const cloud = state.cloud || [];

  // ── Collect data ──

  const pairs = [];
  const records = [];
  const hwCards = [];
  let heroCard = null;
  const extras = [];

  // ── Model superlatives ──

  // Fastest / slowest inference (pair)
  {
    let fastest = null, slowest = null;
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status === 'live' && p.throughput != null) {
          if (!fastest || p.throughput > fastest.tok)
            fastest = { model: m.id, provider: p.name, tok: p.throughput };
          if (p.throughput > 0 && (!slowest || p.throughput < slowest.tok))
            slowest = { model: m.id, provider: p.name, tok: p.throughput };
        }
      }
    }
    if (fastest && slowest) {
      const mul = slowest.tok > 0 ? Math.round(fastest.tok / slowest.tok) : 0;
      pairs.push({
        category: 'Inference Speed', color: '#10b981',
        best: { label: 'Fastest', value: fmtNum(Math.round(fastest.tok)), unit: 'tok/s', model: shortId(fastest.model), detail: fastest.provider, href: '/model/' + fastest.model },
        worst: { label: 'Slowest', value: fmtNum(Math.round(slowest.tok)), unit: 'tok/s', model: shortId(slowest.model), detail: slowest.provider, href: '/model/' + slowest.model },
        multiplier: mul + '\u00d7',
      });
    }
  }

  // Cheapest / priciest inference (pair)
  {
    let cheapest = null, priciest = null;
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status === 'live' && p.outputPrice != null && p.outputPrice > 0) {
          if (!cheapest || p.outputPrice < cheapest.price)
            cheapest = { model: m.id, provider: p.name, price: p.outputPrice };
          if (!priciest || p.outputPrice > priciest.price)
            priciest = { model: m.id, provider: p.name, price: p.outputPrice };
        }
      }
    }
    if (cheapest && priciest) {
      const mul = cheapest.price > 0 ? Math.round(priciest.price / cheapest.price) : 0;
      pairs.push({
        category: 'Inference Price', color: '#f59e0b',
        best: { label: 'Cheapest', value: '$' + cheapest.price.toFixed(2), unit: '/1M out', model: shortId(cheapest.model), detail: cheapest.provider, href: '/model/' + cheapest.model },
        worst: { label: 'Priciest', value: '$' + priciest.price.toFixed(2), unit: '/1M out', model: shortId(priciest.model), detail: priciest.provider, href: '/model/' + priciest.model },
        multiplier: mul + '\u00d7',
      });
    }
  }

  // Most providers
  {
    let best = null;
    for (const m of models) {
      const live = m.providers.filter(p => p.status === 'live').length;
      if (!best || live > best.count) best = { model: m.id, count: live };
    }
    if (best) records.push(card('\ud83c\udfc6', 'Most providers', best.count + ' live', shortId(best.model), '#f0fdf4', '/model/' + best.model));
  }

  // Largest served model
  {
    let best = null;
    for (const m of models) {
      if (!m.safetensorsParams) continue;
      const live = m.providers.some(p => p.status === 'live');
      if (live && (!best || m.safetensorsParams > best.params))
        best = { model: m.id, params: m.safetensorsParams };
    }
    if (best) records.push(card('\ud83d\udc0b', 'Largest served', fmtP(best.params) + ' params', shortId(best.model), '#eff6ff', '/model/' + best.model));
  }

  // Most liked
  {
    let best = null;
    for (const m of models) {
      if (m.likes > 0 && (!best || m.likes > best.likes))
        best = { model: m.id, likes: m.likes };
    }
    if (best) records.push(card('\u2764\ufe0f', 'Most liked', fmtNum(best.likes) + ' likes', shortId(best.model), '#fef2f2', '/model/' + best.model));
  }

  // Most downloaded
  {
    let best = null;
    for (const m of models) {
      if (m.downloads > 0 && (!best || m.downloads > best.downloads))
        best = { model: m.id, downloads: m.downloads };
    }
    if (best) records.push(card('\ud83d\udce6', 'Most downloaded', fmtNum(best.downloads), shortId(best.model), '#fefce8', '/model/' + best.model));
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
        if (oBase === baseName || baseName.startsWith(oBase + '-') || oBase.startsWith(baseName + '-')) count++;
      }
      if (!best || count > best.count) best = { model: m.id, count };
    }
    if (best && best.count > 0) records.push(card('\ud83c\udf3f', 'Most variants', best.count + ' related', shortId(best.model), '#f0fdf4', '/model/' + best.model));
  }

  // Provider superlatives
  {
    const provStats = new Map();
    for (const m of models) {
      for (const p of m.providers) {
        if (p.status !== 'live') continue;
        if (!provStats.has(p.name)) provStats.set(p.name, { count: 0, maxTok: 0, prices: [] });
        const s = provStats.get(p.name);
        s.count++;
        if (p.throughput != null && p.throughput > s.maxTok) s.maxTok = p.throughput;
        if (p.outputPrice != null && p.outputPrice > 0) s.prices.push(p.outputPrice);
      }
    }

    // Biggest catalog
    let biggestProv = null;
    for (const [name, s] of provStats) {
      if (!biggestProv || s.count > biggestProv.count) biggestProv = { name, count: s.count };
    }
    if (biggestProv) records.push(card('\ud83d\udcda', 'Biggest catalog', biggestProv.count + ' models', biggestProv.name, '#eff6ff', '/provider/' + biggestProv.name));

    // Speed king
    let fastestProv = null;
    for (const [name, s] of provStats) {
      if (s.maxTok > 0 && (!fastestProv || s.maxTok > fastestProv.tok)) fastestProv = { name, tok: s.maxTok };
    }
    if (fastestProv) records.push(card('\u26a1', 'Speed king', fmtNum(Math.round(fastestProv.tok)) + ' tok/s', fastestProv.name, '#fefce8', '/provider/' + fastestProv.name));

    // Budget pick
    let cheapestProv = null;
    for (const [name, s] of provStats) {
      if (s.prices.length > 0) {
        const avg = s.prices.reduce((a, b) => a + b, 0) / s.prices.length;
        if (!cheapestProv || avg < cheapestProv.avg) cheapestProv = { name, avg };
      }
    }
    if (cheapestProv) records.push(card('\ud83d\udcb0', 'Budget pick', '$' + cheapestProv.avg.toFixed(2) + '/1M avg', cheapestProv.name, '#f0fdf4', '/provider/' + cheapestProv.name));
  }

  // Least liked (with providers)
  {
    let worst = null;
    for (const m of models) {
      const live = m.providers.some(p => p.status === 'live');
      if (!live) continue;
      if (!worst || m.likes < worst.likes) worst = { model: m.id, likes: m.likes };
    }
    if (worst) records.push(card('\ud83d\udc94', 'Least liked', fmtNum(worst.likes) + ' likes', shortId(worst.model), '#fef2f2', '/model/' + worst.model));
  }

  // Most versatile
  {
    let best = null;
    for (const m of models) {
      const tasks = new Set();
      for (const p of m.providers) {
        if (p.status === 'live' && p.task) tasks.add(p.task);
      }
      if (tasks.size > 0 && (!best || tasks.size > best.count))
        best = { model: m.id, count: tasks.size, tasks: [...tasks].join(', ') };
    }
    if (best && best.count > 1) records.push(card('\ud83d\udd27', 'Most versatile', best.count + ' tasks', shortId(best.model), '#eff6ff', '/model/' + best.model));
  }

  // Smallest served
  {
    let smallest = null;
    for (const m of models) {
      if (!m.safetensorsParams) continue;
      const live = m.providers.some(p => p.status === 'live');
      if (live && (!smallest || m.safetensorsParams < smallest.params))
        smallest = { model: m.id, params: m.safetensorsParams };
    }
    if (smallest) records.push(card('\ud83d\udc1c', 'Smallest served', fmtP(smallest.params) + ' params', shortId(smallest.model), '#fefce8', '/model/' + smallest.model));
  }

  // ── Best models per VRAM tier ──

  const tiers = [
    { label: '8 GB', keys: ['rtx_3060_8_gb', 'm2_8'] },
    { label: '16 GB', keys: ['rtx_4060_ti_16_gb', 'm3_pro_18'] },
    { label: '24 GB', keys: ['rtx_4090', 'm4_pro_24'] },
  ];
  // Compute which models fit each tier, then deduplicate:
  // 8 GB shows its top 10; 16 GB skips models that fit on 8 GB; 24 GB skips 16 GB fits.
  const tierFits = []; // array of Set<modelId> per tier
  const tierResults = [];
  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti];
    let gpu = null, gpuKey = null, runtime = 'llama.cpp';
    for (const k of tier.keys) {
      const entry = gpus.find(([key]) => key === k);
      if (entry) { gpu = entry[1]; gpuKey = k; break; }
    }
    if (!gpu) { tierFits.push(new Set()); continue; }
    if (gpuKey.startsWith('m')) runtime = 'mlx';
    const fits = [];
    const fitIds = new Set();
    for (const m of models) {
      if (!m.safetensorsParams) continue;
      const est = wasm.estimatePerf(gpu, m.safetensorsParams, 'Q4', runtime);
      if (!est || est.fit !== 'Full') continue;
      fitIds.add(m.id);
      fits.push({
        id: m.id, likes: m.likes || 0,
        params: m.safetensorsParams, vram: est.weight_gb,
      });
    }
    tierFits.push(fitIds);
    const prev = ti > 0 ? tierFits[ti - 1] : new Set();
    const unique = fits.filter(r => !prev.has(r.id));
    unique.sort((a, b) => b.likes - a.likes);
    tierResults.push({ label: tier.label, gpu: gpu.name, rows: unique.slice(0, 10) });
  }

  // ── Provider dominance ──

  const domMap = new Map(); // modelId -> [{name, outputPrice, throughput}]
  for (const m of models) {
    const comparable = [];
    for (const p of m.providers) {
      if (p.status !== 'live') continue;
      if (p.outputPrice == null && p.throughput == null) continue;
      comparable.push({ name: p.name, outputPrice: p.outputPrice, throughput: p.throughput });
    }
    if (comparable.length >= 2) domMap.set(m.id, comparable);
  }

  const domProvStats = new Map(); // provider -> {models, cheapest, fastest, dominated}
  for (const [, provs] of domMap) {
    const minPrice = Math.min(...provs.filter(p => p.outputPrice > 0).map(p => p.outputPrice));
    const maxTok = Math.max(...provs.filter(p => p.throughput > 0).map(p => p.throughput));
    for (const p of provs) {
      if (!domProvStats.has(p.name)) domProvStats.set(p.name, { models: 0, cheapest: 0, fastest: 0, dominated: 0 });
      const s = domProvStats.get(p.name);
      s.models++;
      if (p.outputPrice > 0 && p.outputPrice <= minPrice) s.cheapest++;
      if (p.throughput > 0 && p.throughput >= maxTok) s.fastest++;
      // Dominated: another single provider beats on both price AND speed
      if (provs.some(o => o.name !== p.name
        && o.outputPrice != null && p.outputPrice != null && o.outputPrice > 0 && p.outputPrice > 0 && o.outputPrice < p.outputPrice
        && o.throughput != null && p.throughput != null && o.throughput > 0 && p.throughput > 0 && o.throughput > p.throughput
      )) s.dominated++;
    }
  }

  const domRows = [...domProvStats.entries()]
    .map(([name, s]) => ({
      name, models: s.models,
      cheapestPct: s.models ? Math.round(100 * s.cheapest / s.models) : 0,
      fastestPct: s.models ? Math.round(100 * s.fastest / s.models) : 0,
      dominatedPct: s.models ? Math.round(100 * s.dominated / s.models) : 0,
    }))
    .sort((a, b) => b.models - a.models);

  // Spiciest pairwise finding
  let spiciest = null;
  {
    const provModels = new Map(); // provider -> Set<modelId>
    for (const [mid, provs] of domMap) {
      for (const p of provs) {
        if (!provModels.has(p.name)) provModels.set(p.name, new Map());
        provModels.get(p.name).set(mid, p);
      }
    }
    const provNames = [...provModels.keys()];
    let bestScore = -1;
    for (let i = 0; i < provNames.length; i++) {
      for (let j = i + 1; j < provNames.length; j++) {
        const a = provNames[i], b = provNames[j];
        const aMap = provModels.get(a), bMap = provModels.get(b);
        const shared = [...aMap.keys()].filter(k => bMap.has(k));
        if (shared.length < 10) continue;
        let aFaster = 0, aCheaper = 0, aDom = 0, bFaster = 0, bCheaper = 0, bDom = 0;
        for (const mid of shared) {
          const pa = aMap.get(mid), pb = bMap.get(mid);
          if (pa.throughput > 0 && pb.throughput > 0) {
            if (pa.throughput > pb.throughput) aFaster++; else if (pb.throughput > pa.throughput) bFaster++;
          }
          if (pa.outputPrice > 0 && pb.outputPrice > 0) {
            if (pa.outputPrice < pb.outputPrice) aCheaper++; else if (pb.outputPrice < pa.outputPrice) bCheaper++;
          }
          if (pa.throughput > pb.throughput && pa.outputPrice > 0 && pb.outputPrice > 0 && pa.outputPrice < pb.outputPrice) aDom++;
          if (pb.throughput > pa.throughput && pb.outputPrice > 0 && pa.outputPrice > 0 && pb.outputPrice < pa.outputPrice) bDom++;
        }
        const tension = Math.min(aFaster, bFaster) + Math.min(aCheaper, bCheaper);
        const score = tension + aDom + bDom + shared.length * 0.1;
        if (score > bestScore) {
          bestScore = score;
          spiciest = { a, b, shared: shared.length, aFaster, aCheaper, aDom, bFaster, bCheaper, bDom };
        }
      }
    }
  }

  // ── Provider efficiency (price per tok/s) ──

  const effRows = [];
  {
    const provRatios = new Map(); // provider -> [ratio]
    for (const [, provs] of domMap) {
      for (const p of provs) {
        if (p.outputPrice > 0 && p.throughput > 0) {
          if (!provRatios.has(p.name)) provRatios.set(p.name, []);
          provRatios.get(p.name).push(p.outputPrice / p.throughput);
        }
      }
    }
    for (const [name, ratios] of provRatios) {
      if (ratios.length < 2) continue;
      ratios.sort((a, b) => a - b);
      const mid = Math.floor(ratios.length / 2);
      const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
      effRows.push({ name, models: ratios.length, median, best: ratios[0], worst: ratios[ratios.length - 1] });
    }
    effRows.sort((a, b) => a.median - b.median);
  }

  // ── Cloud GPU value ──

  const cloudValue = [];
  {
    const refParams = 8e9;
    for (const [, o] of cloud) {
      const gpuEntry = gpus.find(([k]) => k === o.gpu);
      if (!gpuEntry) continue;
      const [gpuKey, gpu] = gpuEntry;
      const runtime = gpuKey.startsWith('m') ? 'mlx' : 'llama.cpp';
      const est = wasm.estimatePerf(gpu, refParams, 'Q4', runtime);
      if (!est || est.fit !== 'Full' || est.decode_tok_s <= 0) continue;
      const totalPrice = o.price_hr * (o.gpu_count || 1);
      if (totalPrice <= 0) continue;
      const value = est.decode_tok_s / totalPrice;
      cloudValue.push({ name: o.name, provider: o.provider, gpuName: gpu.name, priceHr: totalPrice, tokS: est.decode_tok_s, value });
    }
    cloudValue.sort((a, b) => b.value - a.value);
  }

  // ── Hardware superlatives ──

  // Most / least VRAM
  {
    let most = null, least = null;
    for (const [key, gpu] of gpus) {
      if (!most || gpu.vram_gb > most.vram) most = { key, name: gpu.name, vram: gpu.vram_gb };
      if (!least || gpu.vram_gb < least.vram) least = { key, name: gpu.name, vram: gpu.vram_gb };
    }
    if (most) hwCards.push(card('\ud83e\udde0', 'Most VRAM', most.vram + ' GB', most.name, '#f5f3ff', '/hw/' + most.key));
    if (least) hwCards.push(card('\ud83d\udc1c', 'Least VRAM', least.vram + ' GB', least.name, '#fff7ed', '/hw/' + least.key));
  }

  // Most bandwidth
  {
    let best = null;
    for (const [key, gpu] of gpus) {
      if (!best || gpu.mem_bw_gb_s > best.bw) best = { key, name: gpu.name, bw: gpu.mem_bw_gb_s };
    }
    if (best) hwCards.push(card('\ud83d\ude80', 'Most bandwidth', fmtNum(Math.round(best.bw)) + ' GB/s', best.name, '#eff6ff', '/hw/' + best.key));
  }

  // Best / worst $/GB VRAM
  {
    let best = null, worst = null;
    for (const [key, gpu] of gpus) {
      if (!gpu.street_usd || !gpu.vram_gb) continue;
      const ratio = gpu.street_usd / gpu.vram_gb;
      if (!best || ratio < best.ratio) best = { key, name: gpu.name, ratio, price: gpu.street_usd, vram: gpu.vram_gb };
      if (!worst || ratio > worst.ratio) worst = { key, name: gpu.name, ratio, price: gpu.street_usd, vram: gpu.vram_gb };
    }
    if (best) hwCards.push(card('\ud83d\udcb5', 'Best $/GB VRAM', '$' + Math.round(best.ratio) + '/GB', best.name, '#f0fdf4', '/hw/' + best.key));
    if (worst) hwCards.push(card('\ud83d\udcb8', 'Worst $/GB VRAM', '$' + Math.round(worst.ratio) + '/GB', worst.name, '#fef2f2', '/hw/' + worst.key));
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
          if (!largest || m.safetensorsParams > largest.params)
            largest = { model: m.id, params: m.safetensorsParams, tok: result[1].decode_tok_s };
        }
      }
      if (largest) hwCards.push(card('\ud83d\udcbb', 'Fits on a laptop?', fmtP(largest.params) + ' @ ' + Math.round(largest.tok) + ' tok/s', 'M4 Pro 24GB', '#fefce8', '/hw/m4_pro_24'));
    }
  }

  // Power draw (pair)
  {
    let most = null, least = null;
    for (const [key, gpu] of gpus) {
      if (!most || gpu.tdp_w > most.tdp) most = { key, name: gpu.name, tdp: gpu.tdp_w };
      if (!least || gpu.tdp_w < least.tdp) least = { key, name: gpu.name, tdp: gpu.tdp_w };
    }
    if (most && least) {
      const mul = least.tdp > 0 ? Math.round(most.tdp / least.tdp) : 0;
      pairs.push({
        category: 'Power Draw', color: '#ef4444',
        best: { label: 'Most efficient', value: least.tdp + 'W', unit: 'TDP', model: least.name, detail: '', href: '/hw/' + least.key },
        worst: { label: 'Power hungry', value: fmtNum(most.tdp) + 'W', unit: 'TDP', model: most.name, detail: '', href: '/hw/' + most.key },
        multiplier: mul + '\u00d7',
      });
    }
  }

  // Cloud GPU pair
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
    if (cheapest && priciest) {
      const mul = cheapest.price > 0 ? Math.round(priciest.price / cheapest.price) : 0;
      pairs.push({
        category: 'Cloud GPU', color: '#8b5cf6',
        best: { label: 'Cheapest', value: '$' + cheapest.price.toFixed(2), unit: '/hr', model: cheapest.gpu, detail: cheapest.provider, href: '/cloud' },
        worst: { label: 'Priciest', value: '$' + priciest.price.toFixed(2), unit: '/hr', model: priciest.gpu, detail: priciest.provider, href: '/cloud' },
        multiplier: mul + '\u00d7',
      });
    }
  }

  // Best local value (hero card)
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
            best = { key, name: gpu.name, cost: costPerM, tok: result[1].decode_tok_s, vram: gpu.vram_gb, bw: gpu.mem_bw_gb_s };
          }
        }
      }
    }

    // Also find cheapest API for comparison
    let cheapestApi = null;
    for (const m of models) {
      if (!m.safetensorsParams || m.safetensorsParams < 7e9 || m.safetensorsParams > 10e9) continue;
      for (const p of m.providers) {
        if (p.status === 'live' && p.outputPrice != null && p.outputPrice > 0) {
          if (!cheapestApi || p.outputPrice < cheapestApi) cheapestApi = p.outputPrice;
        }
      }
    }

    if (best) {
      heroCard = {
        cost: best.cost, name: best.name, key: best.key,
        bw: Math.round(best.bw), vram: best.vram,
        cheapestApi,
      };
    }
  }

  // RTX 4090 break-even
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
          extras.push({
            label: 'RTX 4090 break-even',
            value: fmtNum(Math.round(breakeven)) + ' tokens',
            detail: 'vs $' + cheapestApi.toFixed(2) + '/1M cheapest API (8B model)',
            href: '/hw/rtx_4090',
          });
        }
      }
    }
  }

  // ── Render ──

  let html = `<div style="margin-bottom:6px">
    <span style="font-size:28px;font-weight:800;color:var(--tx)">State of Inference</span>
  </div>
  <div style="color:var(--dm);font-size:14px;margin-bottom:12px">Live analytics from ${models.length} models, 19 providers, ${gpus.length} hardware configs</div>
  <style>.soi-toc a{color:var(--ac);text-decoration:none;font-weight:500}.soi-toc a:hover{text-decoration:underline}</style>
  <div class="soi-toc" style="font-size:13px;margin-bottom:40px;line-height:1.6"><a href="#best-for-gpu">Best for Your GPU</a> \u00b7 <a href="#provider-dominance">Provider Dominance</a> \u00b7 <a href="#pareto">Pareto Frontier</a> \u00b7 <a href="#efficiency">Efficiency</a> \u00b7 <a href="#cloud-value">Cloud Value</a> \u00b7 <a href="#weekly">Weekly Report</a> \u00b7 <a href="#fun-stats">Fun Stats</a></div>`;

  // ── Section 1: Best Models for Your GPU ──

  if (tierResults.length) {
    html += '<div id="best-for-gpu" class="sec"><div class="sec-head">Best Models for Your GPU</div>';
    html += '<div style="color:var(--dm);font-size:12px;margin-bottom:10px">Top models that fit at Q4, ranked by community likes</div>';
    html += '<div class="filter-bar" id="vram-tier-toggle">';
    for (let t = 0; t < tierResults.length; t++) {
      html += `<span class="fp${t === 0 ? ' on' : ''}" data-tier="${t}">${esc(tierResults[t].label)}</span>`;
    }
    html += '</div>';
    for (let t = 0; t < tierResults.length; t++) {
      const tier = tierResults[t];
      html += `<div class="vram-tier-panel" data-tier="${t}" style="${t > 0 ? 'display:none' : ''}">
        <table class="mt"><thead><tr>
          <th>#</th><th>Model</th><th>Params</th><th>Quant</th><th>VRAM</th><th>Likes</th>
        </tr></thead><tbody>`;
      for (let i = 0; i < tier.rows.length; i++) {
        const r = tier.rows[i];
        html += `<tr>
          <td>${i + 1}</td>
          <td class="name"><a href="/model/${esc(r.id)}" class="link">${esc(shortId(r.id))}</a></td>
          <td>${fmtP(r.params)}</td>
          <td>Q4</td>
          <td>${r.vram ? r.vram.toFixed(0) + ' GB' : '\u2014'}</td>
          <td>${fmtNum(r.likes)}</td>
        </tr>`;
      }
      if (!tier.rows.length) html += '<tr><td colspan="6" style="color:var(--dm)">No models fit</td></tr>';
      html += '</tbody></table>';
      const top3 = tier.rows.slice(0, 3);
      if (top3.length) {
        const parts = top3.map(r => `${shortId(r.id)} (${fmtNum(r.likes)} likes)`).join(', ');
        const extra = t > 0 ? ' that need more than ' + tierResults[t - 1].label : '';
        html += `<div style="font-size:12px;color:var(--mt);margin-top:8px;line-height:1.5">For the ${esc(tier.label)} VRAM tier (${esc(tier.gpu)}), the top-rated models${extra} that fit at Q4 are ${parts}.</div>`;
      }
      html += '</div>';
    }
    html += '</div>';
  }

  // ── Section 2: Provider Dominance ──

  if (domRows.length) {
    html += '<div id="provider-dominance" class="sec"><div class="sec-head">Provider Dominance</div>';
    html += '<table class="mt"><thead><tr><th>Provider</th><th>Models</th><th>Cheapest %</th><th>Fastest %</th><th>Dominated %</th></tr></thead><tbody>';
    for (const r of domRows) {
      html += `<tr>
        <td class="name"><a href="/provider/${esc(r.name)}" class="link">${esc(r.name)}</a></td>
        <td>${r.models}</td>
        <td>${r.cheapestPct}%</td>
        <td>${r.fastestPct}%</td>
        <td>${r.dominatedPct}%</td>
      </tr>`;
    }
    html += '</tbody></table>';
    if (spiciest) {
      const s = spiciest;
      let callout = `On the ${s.shared} models where both ${s.a} and ${s.b} are available, `;
      const parts = [];
      if (s.aFaster > 0) parts.push(`${s.a} is faster on ${Math.round(100 * s.aFaster / s.shared)}%`);
      if (s.bFaster > 0) parts.push(`${s.b} is faster on ${Math.round(100 * s.bFaster / s.shared)}%`);
      if (s.aCheaper > 0) parts.push(`${s.a} is cheaper on ${Math.round(100 * s.aCheaper / s.shared)}%`);
      if (s.bCheaper > 0) parts.push(`${s.b} is cheaper on ${Math.round(100 * s.bCheaper / s.shared)}%`);
      callout += parts.join('. ') + '.';
      if (s.aDom > 0) callout += ` On ${s.aDom} model${s.aDom > 1 ? 's' : ''}, ${s.a} is both faster AND cheaper.`;
      if (s.bDom > 0) callout += ` On ${s.bDom} model${s.bDom > 1 ? 's' : ''}, ${s.b} is both faster AND cheaper.`;
      html += `<div style="
        padding:12px 16px;margin-top:12px;
        background:rgba(98,70,234,.06);border-left:3px solid #6246ea;
        border-radius:0 var(--rs) var(--rs) 0;
        font-size:12px;line-height:1.6;color:var(--tx);
      ">${esc(callout)}</div>`;
    }
    const topProv = domRows[0];
    const mostDom = domRows.reduce((a, b) => b.dominatedPct > a.dominatedPct ? b : a, domRows[0]);
    html += `<div style="font-size:12px;color:var(--mt);margin-top:8px;line-height:1.5">${esc(topProv.name)} appears on the most models (${topProv.models}) and is cheapest on ${topProv.cheapestPct}% of them. ${esc(mostDom.name)} is dominated (beaten on both price and speed) on ${mostDom.dominatedPct}% of its models.</div>`;
    html += '</div>';
  }

  // ── Section 3: Pareto Frontier ──

  const paretoModels = [];
  for (const [id, provs] of domMap) {
    const valid = provs.filter(p => p.outputPrice > 0 && p.throughput > 0);
    if (valid.length >= 3) {
      paretoModels.push({ id, shortName: shortId(id), providerCount: valid.length });
    }
  }
  paretoModels.sort((a, b) => b.providerCount - a.providerCount);

  if (paretoModels.length) {
    html += '<div id="pareto" class="sec"><div class="sec-head">Pareto Frontier</div>';
    html += '<div style="color:var(--dm);font-size:12px;margin-bottom:8px">Providers not dominated on both price and speed for a given model.</div>';
    html += `<select id="pareto-model" style="font-size:12px;padding:4px 8px;border:1px solid var(--bd);border-radius:var(--rs);background:var(--bg);color:var(--tx);margin-bottom:12px">`;
    for (const pm of paretoModels) {
      html += `<option value="${esc(pm.id)}">${esc(pm.shortName)} (${pm.providerCount} providers)</option>`;
    }
    html += '</select>';
    html += '<div id="pareto-chart"></div>';
    html += '<div id="pareto-summary" style="font-size:12px;color:var(--mt);margin-top:8px;line-height:1.5"></div>';
    html += '</div>';
  }

  // ── Section 4: Provider Efficiency ──

  if (effRows.length >= 2) {
    const fmtR = r => '$' + r.toFixed(4);
    const gap = effRows[effRows.length - 1].median / effRows[0].median;
    html += '<div id="efficiency" class="sec"><div class="sec-head">Provider Efficiency</div>';
    html += '<div style="color:var(--dm);font-size:12px;margin-bottom:8px">Cost per unit of speed ($/1M tokens \u00f7 tok/s). Lower is better.</div>';
    html += '<table class="mt"><thead><tr><th>#</th><th>Provider</th><th>Models</th><th>Median</th><th>Best</th><th>Worst</th></tr></thead><tbody>';
    for (let i = 0; i < effRows.length; i++) {
      const r = effRows[i];
      html += `<tr>
        <td>${i + 1}</td>
        <td class="name"><a href="/provider/${esc(r.name)}" class="link">${esc(r.name)}</a></td>
        <td>${r.models}</td>
        <td>${fmtR(r.median)}</td>
        <td>${fmtR(r.best)}</td>
        <td>${fmtR(r.worst)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    html += `<div style="
      padding:12px 16px;margin-top:12px;
      background:rgba(98,70,234,.06);border-left:3px solid #6246ea;
      border-radius:0 var(--rs) var(--rs) 0;
      font-size:12px;line-height:1.6;color:var(--tx);
    ">${esc(effRows[0].name)} is ${Math.round(gap)}\u00d7 more cost-efficient than ${esc(effRows[effRows.length - 1].name)} across comparable models.</div>`;
    const top3 = effRows.slice(0, 3).map(r => r.name).join(', ');
    html += `<div style="font-size:12px;color:var(--mt);margin-top:8px;line-height:1.5">Most cost-efficient providers: ${esc(top3)}. Efficiency is measured as the median ratio of output price to throughput across all models a provider serves.</div>`;
    html += '</div>';
  }

  // ── Section 5: Cloud GPU Value ──

  if (cloudValue.length >= 2) {
    const top = cloudValue.slice(0, 15);
    const best = cloudValue[0], worst = cloudValue[cloudValue.length - 1];
    const gap = Math.round(best.value / worst.value);
    html += '<div id="cloud-value" class="sec"><div class="sec-head">Cloud GPU Value</div>';
    html += '<div style="color:var(--dm);font-size:12px;margin-bottom:8px">Estimated tok/s per $/hr for an 8B model at Q4. Higher is better.</div>';
    html += '<table class="mt"><thead><tr><th>#</th><th>Offering</th><th>Provider</th><th>GPU</th><th>$/hr</th><th>tok/s</th><th>Value</th></tr></thead><tbody>';
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      html += `<tr>
        <td>${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.provider)}</td>
        <td>${esc(r.gpuName)}</td>
        <td>$${r.priceHr.toFixed(2)}</td>
        <td>${Math.round(r.tokS)}</td>
        <td>${Math.round(r.value)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    html += `<div style="
      padding:12px 16px;margin-top:12px;
      background:rgba(98,70,234,.06);border-left:3px solid #6246ea;
      border-radius:0 var(--rs) var(--rs) 0;
      font-size:12px;line-height:1.6;color:var(--tx);
    ">Best value: ${esc(best.name)} at ${Math.round(best.value)} tok/s/$\u2009\u2014\u2009${gap}\u00d7 better than ${esc(worst.name)}.</div>`;
    const top3 = cloudValue.slice(0, 3).map(r => `${r.name} (${Math.round(r.value)} tok/s/$)`).join(', ');
    html += `<div style="font-size:12px;color:var(--mt);margin-top:8px;line-height:1.5">Top cloud GPU offerings by value: ${esc(top3)}.</div>`;
    html += '</div>';
  }

  // ── Section 6: Weekly Report (placeholder) ──

  html += `<div id="weekly" class="sec"><div class="sec-head">Weekly Report</div>
    <div style="color:var(--dm);font-size:12px;margin-bottom:12px">Automated weekly diffs of provider prices, speeds, and model availability.</div>
    <div style="
      padding:16px 20px;
      background:rgba(98,70,234,.04);border:1px dashed var(--bd);
      border-radius:var(--rs);
      font-size:12px;line-height:1.8;color:var(--dm);
    ">Weekly reports will appear here once hourly data snapshots begin collecting. Each report compares the current week to the previous: new models added, price changes, speed changes, and provider status updates.<br><br>
    Setup: add the snapshot GitHub Action to start collecting data. Reports auto-generate after one week of snapshots.</div>
  </div>`;

  // ── Section 7: Fun Stats ──

  html += '<div id="fun-stats" class="sec"><div class="sec-head">Fun Stats</div>';
  html += `<div style="color:var(--dm);font-size:12px;margin-bottom:16px">Superlatives and records across ${models.length} models, 19 providers, ${gpus.length} GPUs, ${cloud.length} cloud offerings</div>`;

  // Pairs (2x2 grid)
  html += '<div class="st-pairs">';
  for (const p of pairs) {
    html += `<div class="st-pair">
      <div class="st-pair-head" style="background:${p.color}0a">
        <span class="st-pair-cat">${esc(p.category)}</span>
        <span class="st-pair-mul" style="background:${p.color}">${esc(p.multiplier)} gap</span>
      </div>
      <div class="st-pair-body">
        <a class="st-pair-side" href="${esc(p.best.href)}" style="text-decoration:none;color:inherit">
          <div class="st-pair-lbl" style="color:${p.color}">${esc(p.best.label)}</div>
          <div class="st-pair-val">${esc(p.best.value)}</div>
          <div class="st-pair-unit">${esc(p.best.unit)}</div>
          <div class="st-pair-model">${esc(p.best.model)}</div>
          ${p.best.detail ? `<div class="st-pair-detail">via ${esc(p.best.detail)}</div>` : ''}
        </a>
        <div class="st-pair-vs">vs</div>
        <a class="st-pair-side worst" href="${esc(p.worst.href)}" style="text-decoration:none;color:inherit">
          <div class="st-pair-lbl" style="color:var(--dm)">${esc(p.worst.label)}</div>
          <div class="st-pair-val">${esc(p.worst.value)}</div>
          <div class="st-pair-unit">${esc(p.worst.unit)}</div>
          <div class="st-pair-model">${esc(p.worst.model)}</div>
          ${p.worst.detail ? `<div class="st-pair-detail">via ${esc(p.worst.detail)}</div>` : ''}
        </a>
      </div>
    </div>`;
  }
  html += '</div>';

  // Records
  html += '<div class="st-sec-title">Records</div>';
  html += '<div class="st-grid4">';
  for (const r of records) {
    html += `<a class="st-card" href="${esc(r.href)}" style="background:${r.bg}">
      <div class="st-card-icon">${r.icon}</div>
      <div class="st-card-label">${esc(r.label)}</div>
      <div class="st-card-val">${esc(r.value)}</div>
      <div class="st-card-model">${esc(r.model)}</div>
    </a>`;
  }
  html += '</div>';

  // Hardware
  html += '<div class="st-sec-title">Hardware</div>';
  html += '<div class="st-grid3">';
  for (const h of hwCards) {
    html += `<a class="st-card" href="${esc(h.href)}" style="background:${h.bg}">
      <div class="st-card-icon">${h.icon}</div>
      <div class="st-card-label">${esc(h.label)}</div>
      <div class="st-card-val">${esc(h.value)}</div>
      <div class="st-card-model">${esc(h.model)}</div>
    </a>`;
  }
  html += '</div>';

  // Hero card (best local value)
  if (heroCard) {
    html += `<a class="st-hero" href="/hw/${esc(heroCard.key)}">
      <div class="st-hero-gem">\ud83d\udc8e</div>
      <div class="st-hero-lbl">Best local value</div>
      <div class="st-hero-val">$${heroCard.cost.toFixed(4)} <span>/1M output tokens</span></div>
      <div class="st-hero-desc">${esc(heroCard.name)} running an 8B model. Electricity only.</div>
      <div class="st-hero-specs">
        <span>${fmtNum(heroCard.bw)} GB/s bandwidth</span>
        <span>${heroCard.vram} GB VRAM</span>
        ${heroCard.cheapestApi ? `<span>vs $${heroCard.cheapestApi.toFixed(2)}/1M cheapest API</span>` : ''}
      </div>
    </a>`;
  }

  // Extras (break-even etc.)
  for (const e of extras) {
    html += `<a href="${esc(e.href)}" style="
      display:flex;align-items:center;gap:12px;
      padding:12px 16px;margin-top:8px;
      background:rgba(98,70,234,.06);border-left:3px solid #6246ea;
      border-radius:0 var(--rs) var(--rs) 0;
      text-decoration:none;color:inherit;
    ">
      <span style="color:#6246ea;font-size:12px">\u2666</span>
      <span style="font-size:12px;font-weight:700;color:#6246ea">${esc(e.label)}</span>
      <span style="font-size:13px;font-weight:800;flex:1">${esc(e.value)}</span>
      <span style="font-size:11px;color:var(--dm)">${esc(e.detail)}</span>
    </a>`;
  }

  html += '</div>'; // close Fun Stats sec

  container.innerHTML = html;

  // Wire VRAM tier tabs
  const tierToggle = container.querySelector('#vram-tier-toggle');
  if (tierToggle) {
    tierToggle.addEventListener('click', e => {
      const fp = e.target.closest('.fp');
      if (!fp) return;
      tierToggle.querySelectorAll('.fp').forEach(p => p.classList.remove('on'));
      fp.classList.add('on');
      const t = fp.dataset.tier;
      container.querySelectorAll('.vram-tier-panel').forEach(p => {
        p.style.display = p.dataset.tier === t ? '' : 'none';
      });
    });
  }

  // Wire Pareto frontier
  const paretoSelect = container.querySelector('#pareto-model');
  if (paretoSelect) {
    const renderPareto = () => {
      const modelId = paretoSelect.value;
      const provs = (domMap.get(modelId) || []).filter(p => p.outputPrice > 0 && p.throughput > 0);
      if (provs.length < 2) return;

      // Compute frontier: sort by price asc, sweep for max throughput
      const sorted = [...provs].sort((a, b) => a.outputPrice - b.outputPrice);
      const frontierSet = new Set();
      let maxTok = -Infinity;
      for (const p of sorted) {
        if (p.throughput >= maxTok) {
          frontierSet.add(p.name);
          maxTok = p.throughput;
        }
      }

      // SVG dimensions
      const W = 600, H = 380, padL = 56, padR = 24, padT = 16, padB = 48;
      const plotW = W - padL - padR, plotH = H - padT - padB;

      const prices = provs.map(p => p.outputPrice);
      const toks = provs.map(p => p.throughput);
      let minP = Math.min(...prices), maxP = Math.max(...prices);
      let minT = Math.min(...toks), maxT = Math.max(...toks);
      // Add 10% padding
      const pPad = (maxP - minP) * 0.1 || maxP * 0.1 || 1;
      const tPad = (maxT - minT) * 0.1 || maxT * 0.1 || 1;
      minP = Math.max(0, minP - pPad); maxP += pPad;
      minT = Math.max(0, minT - tPad); maxT += tPad;

      const xScale = p => padL + ((p - minP) / (maxP - minP)) * plotW;
      const yScale = t => padT + plotH - ((t - minT) / (maxT - minT)) * plotH;

      // Nice tick intervals
      const niceStep = (range, targetTicks) => {
        const rough = range / targetTicks;
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        const norm = rough / mag;
        let step;
        if (norm < 1.5) step = 1;
        else if (norm < 3) step = 2;
        else if (norm < 7) step = 5;
        else step = 10;
        return step * mag;
      };

      const xStep = niceStep(maxP - minP, 5);
      const yStep = niceStep(maxT - minT, 5);

      let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto;font-family:inherit">`;

      // Plot background
      svg += `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="var(--bg)" stroke="var(--bd)" stroke-width="1" rx="2"/>`;

      // Grid lines + tick labels
      for (let v = Math.ceil(minP / xStep) * xStep; v <= maxP; v += xStep) {
        const x = xScale(v);
        svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="var(--bd)" stroke-width="0.5" opacity="0.5"/>`;
        svg += `<text x="${x}" y="${padT + plotH + 14}" text-anchor="middle" font-size="10" fill="var(--dm)">$${v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v)}</text>`;
      }
      for (let v = Math.ceil(minT / yStep) * yStep; v <= maxT; v += yStep) {
        const y = yScale(v);
        svg += `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="var(--bd)" stroke-width="0.5" opacity="0.5"/>`;
        svg += `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--dm)">${Math.round(v)}</text>`;
      }

      // Axis titles (well below tick labels for X, rotated for Y)
      svg += `<text x="${padL + plotW / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--mt)">Price ($/1M output tokens)</text>`;
      svg += `<text x="14" y="${padT + plotH / 2}" text-anchor="middle" font-size="11" fill="var(--mt)" transform="rotate(-90,14,${padT + plotH / 2})">Throughput (tok/s)</text>`;

      // Frontier shaded region: fill area under the frontier staircase
      const frontierPts = sorted.filter(p => frontierSet.has(p.name));
      if (frontierPts.length >= 2) {
        // Build staircase path: for each frontier point, go horizontal then vertical
        let stairD = `M${xScale(frontierPts[0].outputPrice).toFixed(1)},${yScale(frontierPts[0].throughput).toFixed(1)}`;
        for (let i = 1; i < frontierPts.length; i++) {
          const prev = frontierPts[i - 1], cur = frontierPts[i];
          // Horizontal to new x at previous y, then vertical to new y
          stairD += ` L${xScale(cur.outputPrice).toFixed(1)},${yScale(prev.throughput).toFixed(1)}`;
          stairD += ` L${xScale(cur.outputPrice).toFixed(1)},${yScale(cur.throughput).toFixed(1)}`;
        }
        // Close to bottom-right and bottom-left to fill the "efficient" region
        const lastPt = frontierPts[frontierPts.length - 1];
        const firstPt = frontierPts[0];
        stairD += ` L${xScale(lastPt.outputPrice).toFixed(1)},${(padT + plotH).toFixed(1)}`;
        stairD += ` L${padL.toFixed(1)},${(padT + plotH).toFixed(1)}`;
        stairD += ` L${padL.toFixed(1)},${yScale(firstPt.throughput).toFixed(1)}`;
        stairD += ' Z';
        svg += `<path d="${stairD}" fill="rgba(98,70,234,.06)" stroke="none"/>`;

        // Frontier line connecting points
        const lineD = frontierPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.outputPrice).toFixed(1)},${yScale(p.throughput).toFixed(1)}`).join(' ');
        svg += `<path d="${lineD}" fill="none" stroke="#6246ea" stroke-width="1.5" opacity="0.5" stroke-linejoin="round"/>`;
      }

      // Dots + labels (dominated first so frontier renders on top)
      const dominated = provs.filter(p => !frontierSet.has(p.name));
      const frontier = provs.filter(p => frontierSet.has(p.name));
      for (const p of dominated) {
        const cx = xScale(p.outputPrice), cy = yScale(p.throughput);
        svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5" fill="rgba(98,70,234,.1)" stroke="#6246ea" stroke-width="1" stroke-dasharray="3,2" opacity="0.6"/>`;
        svg += `<text x="${(cx + 7).toFixed(1)}" y="${(cy - 5).toFixed(1)}" font-size="9" fill="var(--dm)" opacity="0.7">${esc(p.name)}</text>`;
      }
      for (const p of frontier) {
        const cx = xScale(p.outputPrice), cy = yScale(p.throughput);
        svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.5" fill="#6246ea"/>`;
        svg += `<text x="${(cx + 8).toFixed(1)}" y="${(cy - 6).toFixed(1)}" font-size="10" font-weight="600" fill="var(--tx)">${esc(p.name)}</text>`;
      }

      svg += '</svg>';
      container.querySelector('#pareto-chart').innerHTML = svg;

      // Summary text
      const frontierNames = frontierPts.map(p => p.name);
      const bestValue = frontierPts.reduce((a, b) =>
        (a.outputPrice / a.throughput) < (b.outputPrice / b.throughput) ? a : b
      );
      let summary = `For ${esc(shortId(modelId))}, ${frontierNames.length} of ${provs.length} providers are on the Pareto frontier.`;
      summary += ` ${esc(bestValue.name)} offers the best value at $${bestValue.outputPrice.toFixed(2)}/1M and ${Math.round(bestValue.throughput)} tok/s.`;

      // Find a dominated provider and who dominates it
      if (dominated.length > 0) {
        const d = dominated[0];
        const dominator = provs.find(p =>
          p.name !== d.name && p.outputPrice < d.outputPrice && p.throughput > d.throughput
        );
        if (dominator) {
          summary += ` ${esc(d.name)} is dominated \u2014 both more expensive and slower than ${esc(dominator.name)}.`;
        }
      }

      container.querySelector('#pareto-summary').innerHTML = summary;
    };

    paretoSelect.addEventListener('change', renderPareto);
    renderPareto();
  }
}

function card(icon, label, value, model, bg, href) {
  return { icon, label, value, model, bg, href };
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
