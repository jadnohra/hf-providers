#!/usr/bin/env python3
"""Pre-render static HTML pages for SEO.

Reads web/data/{models,hardware,cloud}.json and web/index.html,
generates static pages under web/ with proper <title>, <meta>, and
baked-in content. The SPA boots on top via /app.js.
"""

import json
import os
import html
from itertools import combinations
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
DATA = os.path.join(WEB, 'data')
BASE_URL = 'https://vram.run'

PROVIDERS = {
    'cerebras': 'Cerebras', 'cohere': 'Cohere', 'fal-ai': 'fal',
    'featherless-ai': 'Featherless', 'fireworks-ai': 'Fireworks',
    'groq': 'Groq', 'hyperbolic': 'Hyperbolic', 'nebius': 'Nebius',
    'novita': 'Novita', 'nscale': 'Nscale', 'ovhcloud': 'OVHcloud',
    'publicai': 'Public AI', 'replicate': 'Replicate',
    'sambanova': 'SambaNova', 'scaleway': 'Scaleway',
    'together': 'Together AI', 'wavespeed': 'WaveSpeed',
    'zai-org': 'Z.ai', 'hf-inference': 'HF Inference',
}


def load_json(name):
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        print(f'  WARNING: {name} not found, skipping related pages')
        return None
    with open(path) as f:
        return json.load(f)


def load_shell():
    """Load index.html and extract the shell (top bar + footer)."""
    with open(os.path.join(WEB, 'index.html')) as f:
        return f.read()


def esc(s):
    return html.escape(str(s)) if s else ''


def fmt_params(n):
    if not n:
        return ''
    if n >= 1e9:
        b = n / 1e9
        return f'{b:.0f}B' if b >= 100 else f'{b:.1f}B'
    if n >= 1e6:
        return f'{n / 1e6:.0f}M'
    return f'{n / 1e3:.0f}K'


def fmt_num(n):
    if not n:
        return '0'
    if n >= 1e6:
        return f'{n / 1e6:.1f}M'
    if n >= 1e3:
        return f'{n / 1e3:.1f}k'
    return str(n)


def make_page(path, title, description, content_html, canonical=None):
    """Generate a complete HTML page."""
    if canonical is None:
        canonical = BASE_URL + path
    shell = load_shell()

    # Replace <title>
    page = shell.replace('<title>vram.run</title>', f'<title>{esc(title)}</title>')

    # Replace meta description
    default_desc = 'Where should you run your model? Compare 19 inference providers, 220+ GPUs, 88 cloud offerings in one place.'
    page = page.replace(
        f'<meta name="description" content="{default_desc}">',
        f'<meta name="description" content="{esc(description)}">'
    )

    # Replace OG tags
    page = page.replace(
        '<meta property="og:title" content="vram.run">',
        f'<meta property="og:title" content="{esc(title)}">'
    )
    page = page.replace(
        f'<meta property="og:description" content="{default_desc}">',
        f'<meta property="og:description" content="{esc(description)}">'
    )
    page = page.replace(
        f'<meta property="og:url" content="{BASE_URL}">',
        f'<meta property="og:url" content="{esc(canonical)}">'
    )

    # Replace twitter tags
    page = page.replace(
        '<meta name="twitter:title" content="vram.run">',
        f'<meta name="twitter:title" content="{esc(title)}">'
    )
    page = page.replace(
        f'<meta name="twitter:description" content="{default_desc}">',
        f'<meta name="twitter:description" content="{esc(description)}">'
    )

    # Add canonical link
    page = page.replace(
        '<link rel="stylesheet" href="/style.css">',
        f'<link rel="canonical" href="{esc(canonical)}">\n<link rel="stylesheet" href="/style.css">'
    )

    # Hide hero on non-landing pages
    if path != '/':
        page = page.replace(
            '<div class="hero">',
            '<div class="hero" style="display:none">'
        )
        # Show top search
        page = page.replace(
            'id="top-search" style="display:none;',
            'id="top-search" style="display:block;'
        )

    # Insert pre-rendered content
    page = page.replace(
        '<div class="content" id="content"></div>',
        f'<div class="content" id="content">{content_html}</div>'
    )

    return page


def write_page(rel_path, page_html):
    """Write a page to web/rel_path/index.html (or web/rel_path if it ends with .html/.xml/.txt)."""
    if rel_path.endswith(('.html', '.xml', '.txt')):
        out = os.path.join(WEB, rel_path)
    else:
        out = os.path.join(WEB, rel_path.lstrip('/'), 'index.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        f.write(page_html)


# ── Model pages ──

def build_model_pages(models):
    if not models:
        return []
    urls = []
    for m in models:
        model_id = m['id']
        parts = model_id.split('/')
        org = parts[0] if len(parts) > 1 else ''
        name = '/'.join(parts[1:]) if len(parts) > 1 else model_id
        short_name = parts[-1] if len(parts) > 1 else model_id

        params = m.get('safetensors', {}).get('total')
        pipeline = m.get('pipeline_tag', '')
        likes = m.get('likes', 0)
        downloads = m.get('downloads', 0)

        live_providers = []
        for ipm in m.get('inferenceProviderMapping', []):
            if ipm.get('status') == 'live':
                prov_name = PROVIDERS.get(ipm['provider'], ipm['provider'])
                perf = ipm.get('performance', {})
                price = ipm.get('price', {})
                live_providers.append({
                    'id': ipm['provider'],
                    'name': prov_name,
                    'input_price': price.get('inputPerToken'),
                    'output_price': price.get('outputPerToken'),
                    'throughput': perf.get('tokensPerSecond'),
                })

        prov_count = len(live_providers)

        # Build title
        title_parts = [short_name]
        if params:
            title_parts.append(fmt_params(params))
        if prov_count:
            title_parts.append(f'{prov_count} providers')
        title = ' - '.join(title_parts) + ' | vram.run'

        # Build description
        desc_parts = []
        if params:
            desc_parts.append(f'{fmt_params(params)} params')
        if prov_count:
            cheapest = None
            for p in live_providers:
                op = p.get('output_price')
                if op and op > 0:
                    cost_per_m = op * 1e6
                    if cheapest is None or cost_per_m < cheapest[1]:
                        cheapest = (p['name'], cost_per_m)
            if cheapest:
                desc_parts.append(f'{prov_count} providers, from ${cheapest[1]:.2f}/1M tokens')
            else:
                desc_parts.append(f'{prov_count} providers')
        description = f'Run {short_name}'
        if desc_parts:
            description += f' ({", ".join(desc_parts)})'
        description += '. Compare pricing, throughput, hardware requirements.'

        # Build content
        content = f'<h1>{esc(name)}</h1>'
        if org:
            content += f'<p>by {esc(org)}</p>'

        # Spec grid
        specs = []
        if params:
            specs.append(f'<strong>{esc(fmt_params(params))}</strong> params')
        if pipeline:
            specs.append(esc(pipeline))
        if likes:
            specs.append(f'{esc(fmt_num(likes))} likes')
        if downloads:
            specs.append(f'{esc(fmt_num(downloads))} downloads')
        if specs:
            content += '<p>' + ' &middot; '.join(specs) + '</p>'

        # Provider table
        if live_providers:
            content += '<h2>Providers</h2>'
            content += '<table><thead><tr><th>Provider</th><th>$/1M in</th><th>$/1M out</th><th>Throughput</th></tr></thead><tbody>'
            for p in live_providers:
                ip = p.get('input_price')
                op = p.get('output_price')
                tp = p.get('throughput')
                ip_str = f'${ip * 1e6:.2f}' if ip and ip > 0 else ''
                op_str = f'${op * 1e6:.2f}' if op and op > 0 else ''
                tp_str = f'{int(tp)} tok/s' if tp else ''
                content += f'<tr><td><a href="/provider/{esc(p["id"])}">{esc(p["name"])}</a></td>'
                content += f'<td>{ip_str}</td><td>{op_str}</td><td>{tp_str}</td></tr>'
            content += '</tbody></table>'

        path = f'/model/{model_id}'
        page = make_page(path, title, description, content)
        write_page(path, page)
        urls.append(path)

    return urls


# ── Hardware pages ──

def build_hw_pages(hardware):
    if not hardware:
        return []
    urls = []
    for entry in hardware:
        key, gpu = entry[0], entry[1]
        name = gpu['name']
        vendor = gpu.get('vendor', '')
        vram = gpu.get('vram_gb', 0)
        bw = gpu.get('mem_bw_gb_s', 0)
        tflops = gpu.get('fp16_tflops', 0)
        tdp = gpu.get('tdp_w', 0)
        street = gpu.get('street_usd')

        vendor_label = {
            'nvidia': 'NVIDIA', 'amd': 'AMD', 'apple': 'Apple Silicon',
            'intel': 'Intel',
        }.get(vendor, vendor)

        title = f'{name} - {vram}GB VRAM, {int(bw)} GB/s | vram.run'

        desc_parts = [f'{vram}GB VRAM', f'{int(bw)} GB/s bandwidth', f'{tflops:.1f} FP16 TFLOPS']
        if street:
            desc_parts.append(f'~${street:,} street price')
        description = f'{name} ({vendor_label}): ' + ', '.join(desc_parts) + '. See what models fit.'

        content = f'<h1>{esc(name)}</h1>'
        content += f'<p>{esc(vendor_label)}</p>'
        specs = [
            f'<strong>{vram}GB</strong> VRAM',
            f'<strong>{int(bw)}</strong> GB/s bandwidth',
            f'<strong>{tflops:.1f}</strong> FP16 TFLOPS',
            f'<strong>{tdp}W</strong> TDP',
        ]
        if street:
            specs.append(f'<strong>${street:,}</strong> street price')
        content += '<p>' + ' &middot; '.join(specs) + '</p>'

        path = f'/hw/{key}'
        page = make_page(path, title, description, content)
        write_page(path, page)
        urls.append(path)

    return urls


# ── Provider pages ──

def build_provider_pages(models):
    if not models:
        return []
    urls = []

    # Count models per provider
    prov_models = {}
    for m in models:
        for ipm in m.get('inferenceProviderMapping', []):
            if ipm.get('status') == 'live':
                pid = ipm['provider']
                if pid not in prov_models:
                    prov_models[pid] = []
                prov_models[pid].append(m)

    for pid, pname in PROVIDERS.items():
        pm = prov_models.get(pid, [])
        count = len(pm)

        title = f'{pname} - {count} models | vram.run'
        description = f'{pname} inference provider: {count} live models on Hugging Face. Compare pricing and throughput.'

        content = f'<h1>{esc(pname)}</h1>'
        content += f'<p>{count} live models</p>'

        if pm:
            content += '<h2>Models</h2>'
            content += '<table><thead><tr><th>Model</th><th>Task</th><th>Params</th></tr></thead><tbody>'
            for m in pm[:50]:
                mid = m['id']
                short = mid.split('/')[-1]
                params = m.get('safetensors', {}).get('total')
                task = m.get('pipeline_tag', '')
                content += f'<tr><td><a href="/model/{esc(mid)}">{esc(short)}</a></td>'
                content += f'<td>{esc(task)}</td><td>{esc(fmt_params(params))}</td></tr>'
            content += '</tbody></table>'

        path = f'/provider/{pid}'
        page = make_page(path, title, description, content)
        write_page(path, page)
        urls.append(path)

    return urls


# ── Browse pages ──

def build_browse_models(models):
    if not models:
        return []
    count = len(models)
    title = f'All Models - {count} models with inference providers | vram.run'
    description = f'Browse {count} models available via inference providers. Filter by task, params, providers.'

    content = f'<h1>All models with providers</h1>'
    content += f'<p>{count} models</p>'
    content += '<table><thead><tr><th>Model</th><th>Task</th><th>Params</th><th>Likes</th><th>Providers</th></tr></thead><tbody>'
    for m in models:
        mid = m['id']
        parts = mid.split('/')
        org = parts[0] if len(parts) > 1 else ''
        name = '/'.join(parts[1:]) if len(parts) > 1 else mid
        params = m.get('safetensors', {}).get('total')
        task = m.get('pipeline_tag', '')
        likes = m.get('likes', 0)
        prov_count = sum(1 for ipm in m.get('inferenceProviderMapping', []) if ipm.get('status') == 'live')
        display = f'<span style="color:var(--mt)">{esc(org)}/</span>{esc(name)}' if org else esc(name)
        content += f'<tr><td><a href="/model/{esc(mid)}">{display}</a></td>'
        content += f'<td>{esc(task)}</td><td>{esc(fmt_params(params))}</td>'
        content += f'<td>{esc(fmt_num(likes))}</td><td>{prov_count}</td></tr>'
    content += '</tbody></table>'

    path = '/models'
    page = make_page(path, title, description, content)
    write_page(path, page)
    return [path]


def build_browse_hw(hardware):
    if not hardware:
        return []
    count = len(hardware)
    title = f'All Hardware - {count} GPUs and accelerators | vram.run'
    description = f'Browse {count} GPUs: NVIDIA, AMD, Apple Silicon. Compare VRAM, bandwidth, TFLOPS, pricing.'

    content = f'<h1>All hardware</h1>'
    content += f'<p>{count} entries</p>'
    content += '<table><thead><tr><th>Name</th><th>Vendor</th><th>VRAM</th><th>BW (GB/s)</th><th>FP16 TFLOPS</th><th>TDP</th><th>Street $</th></tr></thead><tbody>'
    for entry in hardware:
        key, gpu = entry[0], entry[1]
        street = gpu.get('street_usd')
        content += f'<tr><td><a href="/hw/{esc(key)}">{esc(gpu["name"])}</a></td>'
        content += f'<td>{esc(gpu.get("vendor", ""))}</td><td>{gpu.get("vram_gb", "")} GB</td>'
        content += f'<td>{int(gpu.get("mem_bw_gb_s", 0))}</td><td>{gpu.get("fp16_tflops", 0):.1f}</td>'
        content += f'<td>{gpu.get("tdp_w", "")}W</td>'
        content += f'<td>{"$" + str(street) if street else ""}</td></tr>'
    content += '</tbody></table>'

    path = '/hardware'
    page = make_page(path, title, description, content)
    write_page(path, page)
    return [path]


def build_browse_providers(models):
    if not models:
        return []
    title = f'All Providers - {len(PROVIDERS)} inference providers | vram.run'
    description = f'Compare {len(PROVIDERS)} inference providers: pricing, throughput, model catalogs.'

    # Count models per provider
    prov_counts = {}
    if models:
        for m in models:
            for ipm in m.get('inferenceProviderMapping', []):
                if ipm.get('status') == 'live':
                    pid = ipm['provider']
                    prov_counts[pid] = prov_counts.get(pid, 0) + 1

    content = f'<h1>All providers</h1>'
    content += f'<p>{len(PROVIDERS)} inference providers</p>'
    content += '<table><thead><tr><th>Provider</th><th>Live models</th></tr></thead><tbody>'
    for pid, pname in PROVIDERS.items():
        count = prov_counts.get(pid, 0)
        content += f'<tr><td><a href="/provider/{esc(pid)}">{esc(pname)}</a></td><td>{count}</td></tr>'
    content += '</tbody></table>'

    path = '/providers'
    page = make_page(path, title, description, content)
    write_page(path, page)
    return [path]


def build_browse_cloud(cloud, hardware):
    if not cloud:
        return []
    hw_map = {}
    if hardware:
        for entry in hardware:
            hw_map[entry[0]] = entry[1]

    count = len(cloud)
    title = f'Cloud GPU Rentals - {count} offerings | vram.run'
    description = f'Compare {count} cloud GPU rental offerings. Pricing, GPU specs, spot instances.'

    content = f'<h1>All cloud offerings</h1>'
    content += f'<p>{count} offerings</p>'
    content += '<table><thead><tr><th>Offering</th><th>Provider</th><th>GPU</th><th>GPUs</th><th>$/hr</th></tr></thead><tbody>'
    for entry in cloud:
        _, o = entry[0], entry[1]
        gpu_entry = hw_map.get(o.get('gpu', ''))
        gpu_name = gpu_entry['name'] if gpu_entry else o.get('gpu', '')
        gpu_count = o.get('gpu_count', 1)
        total_price = o.get('price_hr', 0) * gpu_count
        content += f'<tr><td>{esc(o.get("name", ""))}</td>'
        content += f'<td>{esc(o.get("provider", ""))}</td>'
        content += f'<td><a href="/hw/{esc(o.get("gpu", ""))}">{esc(gpu_name)}</a></td>'
        content += f'<td>{gpu_count}x</td>'
        content += f'<td>${total_price:.2f}</td></tr>'
    content += '</tbody></table>'

    path = '/cloud'
    page = make_page(path, title, description, content)
    write_page(path, page)
    return [path]


def build_stats_page(models, hardware, cloud):
    model_count = len(models) if models else 0
    hw_count = len(hardware) if hardware else 0
    cloud_count = len(cloud) if cloud else 0

    title = 'State of Inference | vram.run'
    description = f'Live analytics across {model_count} models, {len(PROVIDERS)} providers, {hw_count} GPUs, {cloud_count} cloud offerings.'

    content = '<h1>State of Inference</h1>'
    content += f'<p>Live analytics from {model_count} models, {len(PROVIDERS)} providers, {hw_count} hardware configs</p>'

    path = '/state-of-inference'
    page = make_page(path, title, description, content)
    write_page(path, page)
    return [path]


# ── Slug helpers ──

def gpu_key_to_slug(key):
    return key.replace('_', '-')


def canonical_pair(a, b):
    """Return (a, b) in alphabetical order."""
    return (a, b) if a <= b else (b, a)


POPULAR_GPU_KEYS = [
    'rtx_4090', 'rtx_5090', 'm4_max_128', 'm4_pro_48', 'm4_pro_24',
    'a100_pcie_80_gb', 'h100_sxm5_80_gb', 'rtx_3090', 'rx_7900_xtx',
    'rtx_4080', 'rtx_3080_ti', 'm3_max_96', 'm4_max_64', 'h200_sxm_141_gb',
    'rtx_3060', 'rtx_4070_ti', 'a6000', 'rtx_5080', 'm2_ultra_192',
    'rtx_4060_ti',
]


# ── Provider vs Provider pages ──

def build_compare_provider_pages(models):
    """Generate provider-vs-provider comparison pages for pairs sharing 3+ models."""
    if not models:
        return []

    # Build provider -> set of model IDs
    prov_model_ids = {}
    prov_model_map = {}  # provider -> {model_id: model_data}
    for m in models:
        for ipm in m.get('inferenceProviderMapping', []):
            if ipm.get('status') == 'live':
                pid = ipm['provider']
                if pid not in prov_model_ids:
                    prov_model_ids[pid] = set()
                    prov_model_map[pid] = {}
                prov_model_ids[pid].add(m['id'])
                prov_model_map[pid][m['id']] = (m, ipm)

    urls = []
    for (pid_a, pid_b) in combinations(sorted(PROVIDERS.keys()), 2):
        ids_a = prov_model_ids.get(pid_a, set())
        ids_b = prov_model_ids.get(pid_b, set())
        shared = ids_a & ids_b
        if len(shared) < 3:
            continue

        a, b = canonical_pair(pid_a, pid_b)
        name_a = PROVIDERS[a]
        name_b = PROVIDERS[b]

        title = f'{name_a} vs {name_b} - Provider Comparison | vram.run'
        description = f'Compare {name_a} and {name_b}: {len(shared)} shared models, pricing and throughput side by side.'

        content = f'<h1>{esc(name_a)} vs {esc(name_b)}</h1>'
        content += f'<p>{len(ids_a)} vs {len(ids_b)} models, {len(shared)} shared</p>'

        # Shared models table
        if shared:
            content += '<h2>Shared models</h2>'
            content += '<table><thead><tr><th>Model</th>'
            content += f'<th>{esc(name_a)} $/1M out</th><th>{esc(name_a)} tok/s</th>'
            content += f'<th>{esc(name_b)} $/1M out</th><th>{esc(name_b)} tok/s</th>'
            content += '</tr></thead><tbody>'

            for mid in sorted(shared):
                short = mid.split('/')[-1]
                m_a, ipm_a = prov_model_map.get(a, {}).get(mid, (None, None))
                m_b, ipm_b = prov_model_map.get(b, {}).get(mid, (None, None))

                def prov_cells(ipm):
                    if not ipm:
                        return '<td></td><td></td>'
                    price = ipm.get('price', {})
                    perf = ipm.get('performance', {})
                    op = price.get('outputPerToken')
                    tp = perf.get('tokensPerSecond')
                    op_str = f'${op * 1e6:.2f}' if op and op > 0 else ''
                    tp_str = f'{int(tp)} tok/s' if tp else ''
                    return f'<td>{op_str}</td><td>{tp_str}</td>'

                content += f'<tr><td><a href="/model/{esc(mid)}">{esc(short)}</a></td>'
                content += prov_cells(ipm_a) + prov_cells(ipm_b)
                content += '</tr>'

            content += '</tbody></table>'

        slug = f'{a}-vs-{b}'
        path = f'/compare/{slug}'
        page = make_page(path, title, description, content)
        write_page(path, page)
        urls.append(path)

    return urls


# ── Hardware vs Hardware pages ──

def build_compare_hw_pages(hardware):
    """Generate HW-vs-HW comparison pages for popular GPU pairs."""
    if not hardware:
        return []

    hw_map = {}
    for entry in hardware:
        hw_map[entry[0]] = entry[1]

    # Filter to popular GPUs that exist
    pop_keys = [k for k in POPULAR_GPU_KEYS if k in hw_map]

    urls = []
    for (key_a, key_b) in combinations(pop_keys, 2):
        a, b = canonical_pair(key_a, key_b)
        gpu_a = hw_map[a]
        gpu_b = hw_map[b]
        slug_a = gpu_key_to_slug(a)
        slug_b = gpu_key_to_slug(b)

        title = f'{gpu_a["name"]} vs {gpu_b["name"]} - GPU Comparison | vram.run'
        description = (f'{gpu_a["name"]} ({gpu_a.get("vram_gb", 0)}GB) vs {gpu_b["name"]} ({gpu_b.get("vram_gb", 0)}GB): '
                       f'compare VRAM, bandwidth, TFLOPS, and what models fit.')

        content = f'<h1>{esc(gpu_a["name"])} vs {esc(gpu_b["name"])}</h1>'

        # Specs table
        content += '<table><thead><tr><th>Metric</th>'
        content += f'<th>{esc(gpu_a["name"])}</th><th>{esc(gpu_b["name"])}</th>'
        content += '</tr></thead><tbody>'

        specs = [
            ('VRAM', 'vram_gb', 'GB'),
            ('Bandwidth', 'mem_bw_gb_s', 'GB/s'),
            ('FP16 TFLOPS', 'fp16_tflops', ''),
            ('TDP', 'tdp_w', 'W'),
        ]
        for label, field, unit in specs:
            va = gpu_a.get(field, 0)
            vb = gpu_b.get(field, 0)
            fmt_a = f'{int(va)} {unit}' if isinstance(va, (int, float)) and field != 'fp16_tflops' else f'{va:.1f} {unit}'
            fmt_b = f'{int(vb)} {unit}' if isinstance(vb, (int, float)) and field != 'fp16_tflops' else f'{vb:.1f} {unit}'
            content += f'<tr><td>{esc(label)}</td><td>{fmt_a}</td><td>{fmt_b}</td></tr>'

        for g, k in [(gpu_a, a), (gpu_b, b)]:
            if g.get('street_usd'):
                pass  # handled in row below
        sa = gpu_a.get('street_usd')
        sb = gpu_b.get('street_usd')
        if sa or sb:
            content += f'<tr><td>Street price</td><td>{"$" + str(sa) if sa else ""}</td><td>{"$" + str(sb) if sb else ""}</td></tr>'

        content += '</tbody></table>'

        # Note about reference models (computed by SPA)
        content += '<p>Reference model performance computed in browser.</p>'

        slug = f'{slug_a}-vs-{slug_b}'
        path = f'/compare/{slug}'
        page = make_page(path, title, description, content)
        write_page(path, page)
        urls.append(path)

    return urls


# ── "Can I run X on Y" check pages ──

def build_check_pages(models, hardware):
    """Generate check pages for top models x popular GPUs."""
    if not models or not hardware:
        return []

    hw_map = {}
    for entry in hardware:
        hw_map[entry[0]] = entry[1]

    # Pick popular GPUs that exist
    pop_keys = [k for k in POPULAR_GPU_KEYS if k in hw_map]

    # Pick top ~100 models by likes (that have params)
    eligible = [m for m in models if m.get('safetensors', {}).get('total')]
    eligible.sort(key=lambda m: m.get('likes', 0), reverse=True)
    top_models = eligible[:100]

    urls = []
    for m in top_models:
        model_id = m['id']
        short_name = model_id.split('/')[-1]
        params = m['safetensors']['total']
        params_str = fmt_params(params)

        for gpu_key in pop_keys:
            gpu = hw_map[gpu_key]
            gpu_slug = gpu_key_to_slug(gpu_key)

            title = f'Can I run {short_name} on {gpu["name"]}? | vram.run'
            description = f'{short_name} ({params_str}) on {gpu["name"]} ({gpu.get("vram_gb", 0)}GB VRAM): fit check, quant options, estimated performance.'

            content = f'<h1>{esc(short_name)} on {esc(gpu["name"])}</h1>'
            content += f'<p>{esc(params_str)} params &middot; {gpu.get("vram_gb", 0)}GB VRAM &middot; {int(gpu.get("mem_bw_gb_s", 0))} GB/s</p>'
            # SPA fills in the actual estimates
            content += '<p>Quantization estimates computed in browser.</p>'

            path = f'/check/{model_id}/{gpu_slug}'
            page = make_page(path, title, description, content)
            write_page(path, page)
            urls.append(path)

    return urls


# ── Sitemap + robots.txt + 404 ──

def build_sitemap(urls):
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'

    # Landing page
    xml += f'  <url><loc>{BASE_URL}/</loc><lastmod>{now}</lastmod><priority>1.0</priority></url>\n'

    # Browse pages (high priority)
    browse = ['/models', '/hardware', '/providers', '/cloud', '/state-of-inference']
    for p in browse:
        xml += f'  <url><loc>{BASE_URL}{p}</loc><lastmod>{now}</lastmod><priority>0.8</priority></url>\n'

    # Comparison pages (slightly higher priority than detail)
    compare_urls = sorted(u for u in urls if u.startswith('/compare/') or u.startswith('/check/'))
    for u in compare_urls:
        xml += f'  <url><loc>{BASE_URL}{u}</loc><lastmod>{now}</lastmod><priority>0.7</priority></url>\n'

    # Detail pages
    for u in sorted(urls):
        if u in browse or u == '/' or u.startswith('/compare/') or u.startswith('/check/'):
            continue
        xml += f'  <url><loc>{BASE_URL}{u}</loc><lastmod>{now}</lastmod><priority>0.6</priority></url>\n'

    xml += '</urlset>\n'

    out = os.path.join(WEB, 'sitemap.xml')
    with open(out, 'w') as f:
        f.write(xml)
    print(f'  sitemap.xml: {len(urls) + 1} URLs')


def build_robots():
    content = 'User-agent: *\nAllow: /\nSitemap: https://vram.run/sitemap.xml\n'
    out = os.path.join(WEB, 'robots.txt')
    with open(out, 'w') as f:
        f.write(content)


def build_404():
    content = '<div style="text-align:center;padding:80px 20px">'
    content += '<h1 style="font-size:48px;font-weight:800;color:var(--dm)">404</h1>'
    content += '<p style="color:var(--dm)">Page not found</p>'
    content += '<p><a href="/" style="color:var(--ac)">Back to vram.run</a></p>'
    content += '</div>'

    page = make_page('/404', '404 - Page not found | vram.run', 'Page not found.', content)
    out = os.path.join(WEB, '404.html')
    with open(out, 'w') as f:
        f.write(page)


# ── Main ──

def main():
    print('==> Pre-rendering SEO pages')

    models = load_json('models.json')
    hardware = load_json('hardware.json')
    cloud = load_json('cloud.json')

    all_urls = []

    # Model pages
    urls = build_model_pages(models)
    print(f'  model pages: {len(urls)}')
    all_urls.extend(urls)

    # Hardware pages
    urls = build_hw_pages(hardware)
    print(f'  hardware pages: {len(urls)}')
    all_urls.extend(urls)

    # Provider pages
    urls = build_provider_pages(models)
    print(f'  provider pages: {len(urls)}')
    all_urls.extend(urls)

    # Comparison pages
    urls = build_compare_provider_pages(models)
    print(f'  compare provider pages: {len(urls)}')
    all_urls.extend(urls)

    urls = build_compare_hw_pages(hardware)
    print(f'  compare hw pages: {len(urls)}')
    all_urls.extend(urls)

    urls = build_check_pages(models, hardware)
    print(f'  check pages: {len(urls)}')
    all_urls.extend(urls)

    # Browse pages
    for builder, label in [
        (lambda: build_browse_models(models), 'models browse'),
        (lambda: build_browse_hw(hardware), 'hardware browse'),
        (lambda: build_browse_providers(models), 'providers browse'),
        (lambda: build_browse_cloud(cloud, hardware), 'cloud browse'),
        (lambda: build_stats_page(models, hardware, cloud), 'state-of-inference'),
    ]:
        urls = builder()
        print(f'  {label}: {len(urls)}')
        all_urls.extend(urls)

    # Sitemap, robots, 404
    build_sitemap(all_urls)
    build_robots()
    build_404()

    print(f'  Total: {len(all_urls)} pages + sitemap.xml + robots.txt + 404.html')


if __name__ == '__main__':
    main()
