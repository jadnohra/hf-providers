#!/usr/bin/env python3
"""Generate data/hardware.toml from dbgpu (TechPowerUp) + manual Apple Silicon entries.

Usage (installed dbgpu):
    uv run --with dbgpu scripts/gen_hardware.py > data/hardware.toml

Usage (fetch latest from PyPI, no extra deps):
    uv run --with dbgpu scripts/gen_hardware.py --fetch > data/hardware.toml
"""

import argparse
import sys
from datetime import date

# ── Calibrated efficiency factors by architecture ──────────────────────
# llamacpp_*: llama.cpp / ollama (all platforms)
# mlx_*: mlx (Apple Silicon only)
# decode_eff: fraction of peak memory bandwidth utilized during autoregressive decode
# prefill_eff: fraction of peak FP16 TFLOPS utilized during prompt prefill
# Sources: r/LocalLLaMA, artificialanalysis.ai, llama.cpp CI, mlx community benchmarks

LLAMACPP_EFFICIENCY = {
    # NVIDIA
    "Ada Lovelace":    (0.65, 0.33),
    "Hopper":          (0.72, 0.45),
    "Ampere":          (0.62, 0.30),
    "Turing":          (0.58, 0.25),
    "Pascal":          (0.50, 0.20),
    "Volta":           (0.55, 0.25),
    "Blackwell":       (0.70, 0.38),
    "Blackwell-2.0":   (0.70, 0.38),
    "Blackwell-Ultra": (0.70, 0.38),
    # AMD
    "RDNA 1.0":        (0.42, 0.20),
    "RDNA 2.0":        (0.45, 0.22),
    "RDNA 3.0":        (0.50, 0.28),
    "RDNA 3.5":        (0.52, 0.30),
    "RDNA 4.0":        (0.54, 0.32),
    "CDNA 1.0":        (0.60, 0.35),
    "CDNA 2.0":        (0.65, 0.38),
    "CDNA 3.0":        (0.68, 0.42),
    "CDNA 4.0":        (0.70, 0.45),
    "GCN 5.1":         (0.40, 0.18),
    # Intel
    "Alchemist":       (0.40, 0.20),
    "Battlemage":      (0.45, 0.22),
    "Xe-HPG":          (0.40, 0.20),
    "Xe2-HPG":         (0.45, 0.22),
}

# Fallback by vendor (llama.cpp)
LLAMACPP_FALLBACK = {
    "NVIDIA": (0.55, 0.25),
    "AMD":    (0.45, 0.22),
    "Intel":  (0.38, 0.18),
}

# ── Filtering ──────────────────────────────────────────────────────────

SKIP_NAME_KEYWORDS = [
    "Max-Q", "Mobile", "Embedded", "Laptop", "DRIVE ", "GRID ",
    "CMP ", "Crypto", "Mining", "Playstation", "Xbox", "Steam Deck",
    "Ryzen Z", "Ryzen AI Z", "Console",
]

# Generation substrings to keep (matched anywhere in the generation string)
KEEP_GEN_SUBSTRINGS = [
    # NVIDIA consumer
    "GeForce 10", "GeForce 16", "GeForce 20", "GeForce 30",
    "GeForce 40", "GeForce 50",
    # NVIDIA workstation
    "Quadro Pascal", "Quadro Turing",
    "Ampere-MW", "Workstation Ampere", "Workstation Ada",
    "Workstation Blackwell",
    # NVIDIA datacenter
    "Tesla Pascal", "Server Volta", "Server Turing",
    "Server Ampere", "Server Hopper", "Server Blackwell",
    # NVIDIA Jetson (useful for edge inference)
    "Jetson",
    # AMD consumer
    "Radeon VII",
    "Navi(RX 5000)", "Navi II(RX 6000)", "Navi III(RX 7000)",
    "Navi IV(RX 9000)",
    # AMD workstation
    "Radeon Pro Navi",
    # AMD datacenter
    "Radeon Instinct",
    # Intel
    "Alchemist(Arc 5)", "Alchemist(Arc 7)", "Battlemage(Arc 5)",
    "Battlemage(Arc 7)", "Battlemage(Pro",
]


def should_keep(d: dict) -> bool:
    name = d.get("name", "")
    gen = d.get("generation", "")
    mem = d.get("memory_size_gb")
    bw = d.get("memory_bandwidth_gb_s")
    fp16 = d.get("half_float_performance_gflop_s")
    tdp = d.get("thermal_design_power_w")

    if mem is None or bw is None or tdp is None:
        return False
    if mem < 8:
        return False
    if fp16 is None or fp16 <= 0:
        return False

    # Skip mobile/embedded/console
    for kw in SKIP_NAME_KEYWORDS:
        if kw in name:
            return False
    # Also skip by generation containing Console or Mobile
    if "Console" in gen or "Mobile" in gen:
        return False

    # Check generation
    for substr in KEEP_GEN_SUBSTRINGS:
        if substr in gen:
            return True

    return False


def make_key(d: dict) -> str:
    """Generate a TOML-safe key from GPU name."""
    name = d["name"]
    key = name.lower()
    key = key.replace("geforce ", "")
    key = key.replace("radeon ", "")
    key = key.replace("instinct ", "")
    key = key.replace("quadro ", "quadro_")
    key = key.replace("tesla ", "tesla_")
    key = key.replace("arc ", "arc_")
    key = key.replace(" ", "_")
    key = key.replace("-", "_")
    key = key.replace(".", "")
    # Clean up double underscores
    while "__" in key:
        key = key.replace("__", "_")
    key = key.strip("_")
    return key


def get_llamacpp_efficiency(d: dict) -> tuple:
    arch = d.get("architecture", "")
    mfr = d.get("manufacturer", "")
    # Try exact match first
    if arch in LLAMACPP_EFFICIENCY:
        return LLAMACPP_EFFICIENCY[arch]
    # Try case-insensitive match
    arch_lower = arch.lower()
    for key, val in LLAMACPP_EFFICIENCY.items():
        if key.lower() == arch_lower:
            return val
    return LLAMACPP_FALLBACK.get(mfr, (0.50, 0.22))


def emit_gpu(key: str, d: dict, llamacpp_de: float, llamacpp_pe: float,
             street_usd: int | None = None):
    name = d["name"]
    vendor = d.get("manufacturer", "unknown").lower()
    arch = d.get("architecture", "unknown").lower().replace(" ", "-")
    vram = d["memory_size_gb"]
    bw = d["memory_bandwidth_gb_s"]
    fp16 = d["half_float_performance_gflop_s"] / 1000.0  # gflops -> tflops
    tdp = d["thermal_design_power_w"]
    source = d.get("tpu_url", "")

    lines = [f'[gpu.{key}]']
    lines.append(f'name = "{name}"')
    lines.append(f'vendor = "{vendor}"')
    lines.append(f'arch = "{arch}"')
    lines.append(f'vram_gb = {vram:.0f}' if vram == int(vram) else f'vram_gb = {vram}')
    lines.append(f'mem_bw_gb_s = {bw:.0f}' if bw == int(bw) else f'mem_bw_gb_s = {bw}')
    lines.append(f'fp16_tflops = {fp16:.1f}')
    lines.append(f'tdp_w = {tdp}')
    if street_usd is not None:
        lines.append(f'street_usd = {street_usd}')
    lines.append(f'llamacpp_decode_eff = {llamacpp_de:.2f}')
    lines.append(f'llamacpp_prefill_eff = {llamacpp_pe:.2f}')
    if source:
        lines.append(f'source = "{source}"')
    return "\n".join(lines)


# ── Apple Silicon (manual, not in TechPowerUp) ────────────────────────

APPLE_ENTRIES = [
    {
        "key": "m4_max_128",
        "name": "M4 Max 128GB",
        "vendor": "apple",
        "arch": "m4",
        "vram_gb": 128,
        "mem_bw_gb_s": 546,
        "fp16_tflops": 53.5,
        "tdp_w": 75,
        "street_usd": 4999,
        "mlx_decode_eff": 0.60, "mlx_prefill_eff": 0.28,
        "llamacpp_decode_eff": 0.45, "llamacpp_prefill_eff": 0.20,
    },
    {
        "key": "m4_max_64",
        "name": "M4 Max 64GB",
        "vendor": "apple",
        "arch": "m4",
        "vram_gb": 64,
        "mem_bw_gb_s": 546,
        "fp16_tflops": 53.5,
        "tdp_w": 75,
        "street_usd": 2999,
        "mlx_decode_eff": 0.60, "mlx_prefill_eff": 0.28,
        "llamacpp_decode_eff": 0.45, "llamacpp_prefill_eff": 0.20,
    },
    {
        "key": "m4_pro_48",
        "name": "M4 Pro 48GB",
        "vendor": "apple",
        "arch": "m4",
        "vram_gb": 48,
        "mem_bw_gb_s": 273,
        "fp16_tflops": 22.1,
        "tdp_w": 45,
        "street_usd": 1999,
        "mlx_decode_eff": 0.58, "mlx_prefill_eff": 0.25,
        "llamacpp_decode_eff": 0.44, "llamacpp_prefill_eff": 0.18,
    },
    {
        "key": "m4_pro_24",
        "name": "M4 Pro 24GB",
        "vendor": "apple",
        "arch": "m4",
        "vram_gb": 24,
        "mem_bw_gb_s": 273,
        "fp16_tflops": 22.1,
        "tdp_w": 45,
        "street_usd": 1599,
        "mlx_decode_eff": 0.58, "mlx_prefill_eff": 0.25,
        "llamacpp_decode_eff": 0.44, "llamacpp_prefill_eff": 0.18,
    },
    {
        "key": "m3_max_128",
        "name": "M3 Max 128GB",
        "vendor": "apple",
        "arch": "m3",
        "vram_gb": 128,
        "mem_bw_gb_s": 400,
        "fp16_tflops": 45.2,
        "tdp_w": 75,
        "street_usd": 4499,
        "mlx_decode_eff": 0.57, "mlx_prefill_eff": 0.26,
        "llamacpp_decode_eff": 0.43, "llamacpp_prefill_eff": 0.18,
    },
    {
        "key": "m2_ultra_192",
        "name": "M2 Ultra 192GB",
        "vendor": "apple",
        "arch": "m2",
        "vram_gb": 192,
        "mem_bw_gb_s": 800,
        "fp16_tflops": 27.2,
        "tdp_w": 120,
        "street_usd": 6999,
        "mlx_decode_eff": 0.55, "mlx_prefill_eff": 0.24,
        "llamacpp_decode_eff": 0.42, "llamacpp_prefill_eff": 0.17,
    },
    {
        "key": "m2_ultra_128",
        "name": "M2 Ultra 128GB",
        "vendor": "apple",
        "arch": "m2",
        "vram_gb": 128,
        "mem_bw_gb_s": 800,
        "fp16_tflops": 27.2,
        "tdp_w": 120,
        "street_usd": 5499,
        "mlx_decode_eff": 0.55, "mlx_prefill_eff": 0.24,
        "llamacpp_decode_eff": 0.42, "llamacpp_prefill_eff": 0.17,
    },
    {
        "key": "m1_ultra_128",
        "name": "M1 Ultra 128GB",
        "vendor": "apple",
        "arch": "m1",
        "vram_gb": 128,
        "mem_bw_gb_s": 800,
        "fp16_tflops": 21.2,
        "tdp_w": 120,
        "street_usd": 3999,
        "mlx_decode_eff": 0.52, "mlx_prefill_eff": 0.22,
        "llamacpp_decode_eff": 0.40, "llamacpp_prefill_eff": 0.16,
    },
]


def emit_apple(entry: dict) -> str:
    lines = [f'[gpu.{entry["key"]}]']
    lines.append(f'name = "{entry["name"]}"')
    lines.append(f'vendor = "{entry["vendor"]}"')
    lines.append(f'arch = "{entry["arch"]}"')
    lines.append(f'vram_gb = {entry["vram_gb"]}')
    lines.append(f'mem_bw_gb_s = {entry["mem_bw_gb_s"]}')
    lines.append(f'fp16_tflops = {entry["fp16_tflops"]}')
    lines.append(f'tdp_w = {entry["tdp_w"]}')
    if "street_usd" in entry:
        lines.append(f'street_usd = {entry["street_usd"]}')
    lines.append(f'llamacpp_decode_eff = {entry["llamacpp_decode_eff"]:.2f}')
    lines.append(f'llamacpp_prefill_eff = {entry["llamacpp_prefill_eff"]:.2f}')
    lines.append(f'mlx_decode_eff = {entry["mlx_decode_eff"]:.2f}')
    lines.append(f'mlx_prefill_eff = {entry["mlx_prefill_eff"]:.2f}')
    return "\n".join(lines)


def load_specs_bundled():
    """Load GPU specs from the installed dbgpu package. Returns list of dicts."""
    from dbgpu import GPUDatabase
    db = GPUDatabase.default()
    return [g.to_dict() for g in db.specs]


def load_specs_fetch():
    """Download the latest dbgpu data.pkl from PyPI. Returns list of dicts."""
    import io
    import json
    import pickle
    import tarfile
    import urllib.request

    print("# Fetching latest dbgpu from PyPI...", file=sys.stderr)
    r = urllib.request.urlopen("https://pypi.org/pypi/dbgpu/json")
    pypi = json.loads(r.read())
    version = pypi["info"]["version"]

    # Find the sdist tarball
    files = pypi["releases"][version]
    sdist = next((f for f in files if f["filename"].endswith(".tar.gz")), None)
    if not sdist:
        print(f"# ERROR: no sdist found for dbgpu {version}", file=sys.stderr)
        sys.exit(1)

    print(f"# Downloading dbgpu {version}...", file=sys.stderr)
    resp = urllib.request.urlopen(sdist["url"])
    raw = resp.read()

    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
        for m in tf.getmembers():
            if m.name.endswith("data.pkl"):
                f = tf.extractfile(m)
                specs = pickle.loads(f.read())
                print(f"# Loaded {len(specs)} GPUs from dbgpu {version}.",
                      file=sys.stderr)
                return specs

    print("# ERROR: data.pkl not found in dbgpu package", file=sys.stderr)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Generate data/hardware.toml from GPU specs.")
    parser.add_argument("--fetch", action="store_true",
                        help="Download latest dbgpu data from PyPI instead of using installed version")
    args = parser.parse_args()

    if args.fetch:
        all_dicts = load_specs_fetch()
        source_label = "dbgpu/PyPI latest (TechPowerUp)"
    else:
        all_dicts = load_specs_bundled()
        source_label = "dbgpu (TechPowerUp)"

    # Filter
    gpus = []
    seen_keys = set()
    for d in all_dicts:
        if not should_keep(d):
            continue
        key = make_key(d)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        gpus.append((key, d))

    # Sort by vendor then VRAM descending
    def sort_key(item):
        _, d = item
        mfr = d.get("manufacturer", "")
        vendor_order = {"NVIDIA": 0, "AMD": 1, "Intel": 2}
        return (vendor_order.get(mfr, 9), -d.get("memory_size_gb", 0))

    gpus.sort(key=sort_key)

    # Emit
    print(f"# GPU specs for local inference estimation.")
    print(f"# Auto-generated from {source_label} + manual Apple Silicon entries.")
    print(f"# Generated: {date.today().isoformat()}")
    print(f"# Total: {len(gpus)} discrete GPUs + {len(APPLE_ENTRIES)} Apple Silicon")
    print(f"#")
    print(f"# llamacpp_*_eff: llama.cpp / ollama efficiency factors")
    print(f"# mlx_*_eff: mlx efficiency factors (Apple Silicon only)")
    print(f"# Sources: r/LocalLLaMA, artificialanalysis.ai, llama.cpp CI, mlx community benchmarks.")
    print()

    # NVIDIA
    nvidia = [(k, d) for k, d in gpus if d.get("manufacturer") == "NVIDIA"]
    print(f"# ── NVIDIA ({len(nvidia)} GPUs) ──")
    print()
    for key, d in nvidia:
        de, pe = get_llamacpp_efficiency(d)
        print(emit_gpu(key, d, de, pe))
        print()

    # AMD
    amd = [(k, d) for k, d in gpus if d.get("manufacturer") == "AMD"]
    if amd:
        print(f"# ── AMD ({len(amd)} GPUs) ──")
        print()
        for key, d in amd:
            de, pe = get_llamacpp_efficiency(d)
            print(emit_gpu(key, d, de, pe))
            print()

    # Intel
    intel = [(k, d) for k, d in gpus if d.get("manufacturer") == "Intel"]
    if intel:
        print(f"# ── Intel ({len(intel)} GPUs) ──")
        print()
        for key, d in intel:
            de, pe = get_llamacpp_efficiency(d)
            print(emit_gpu(key, d, de, pe))
            print()

    # Apple Silicon
    print(f"# ── Apple Silicon ({len(APPLE_ENTRIES)} entries, manual) ──")
    print()
    for entry in APPLE_ENTRIES:
        print(emit_apple(entry))
        print()


if __name__ == "__main__":
    main()
