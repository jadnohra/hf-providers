# Updating Apple Silicon hardware data

The Apple Silicon entries in `data/hardware.toml` are generated from
`scripts/gen_hardware.py`. Discrete GPU data comes from dbgpu/TechPowerUp
automatically; Apple Silicon entries are maintained manually because no
equivalent database exists.

## When to update

- Apple announces new chips (typically 1-2 times per year at WWDC/fall events)
- Street prices shift significantly

## How to update

1. Edit `APPLE_SILICON` in `scripts/gen_hardware.py`:
   - Add new generation to `APPLE_GENERATIONS` with efficiency factors
   - Add variants with `(fp16_tflops, mem_bw_gb_s, tdp_w, [(mem, price), ...])`

2. Regenerate:
   ```
   uv run --with dbgpu scripts/gen_hardware.py --fetch > data/hardware.toml
   ```

3. Verify:
   ```
   cargo test
   cargo clippy
   cargo run -- machine  # should auto-detect your Mac
   ```

## Where to find specs

| Field | Source | Notes |
|-------|--------|-------|
| FP16 TFLOPS | [waredb.com](https://www.waredb.com/) | Search "apple m_ gpu NN cores", use "FP16" row |
| GPU cores | Wikipedia Apple M_ pages | Variants table, Cores column |
| Memory bandwidth | Wikipedia Apple M_ pages | Bandwidth column |
| TDP | notebookcheck.net | Estimates, Apple doesn't publish officially |
| Street price | Apple Store, Amazon, eBay | Rough, updated occasionally |
| Efficiency factors | r/LocalLLaMA, llama.cpp CI, mlx benchmarks | See calibration section below |

## FP16 TFLOPS derivation (Feb 2026)

All FP16 TFLOPS values sourced from [waredb.com](https://www.waredb.com/),
which computes theoretical peak as: `gpu_cores * 128 ALUs * 2 ops/cycle * clock_hz * 2 (FP16)`.

| Chip | GPU cores | Clock (MHz) | FP16 TFLOPS | WareDB page |
|------|-----------|-------------|-------------|-------------|
| M1 | 8 | 1278 | 5.24 | apple-m1-gpu-8-cores |
| M1 Pro | 16 | 1296 | 10.62 | apple-m1-pro-gpu-16-cores |
| M1 Max | 32 | 1296 | 21.23 | apple-m1-max-gpu-32-cores |
| M1 Ultra | 64 | 1296 | 42.47 | apple-m1-ultra-gpu-64-cores |
| M2 | 10 | 1398 | 7.16 | apple-m2-gpu-10-cores |
| M2 Pro | 19 | 1398 | 13.60 | apple-m2-pro-gpu-19-cores |
| M2 Max | 38 | 1398 | 27.20 | apple-m2-max-gpu-38-cores |
| M2 Ultra | 76 | 1398 | 54.40 | apple-m2-ultra-gpu-76-cores |
| M3 | 10 | 1600 | 8.19 | apple-m3-gpu-10-cores |
| M3 Pro | 18 | 1600 | 14.75 | apple-m3-pro-gpu-18-cores |
| M3 Max | 40 | 1600 | 32.77 | apple-m3-max-gpu-40-cores |
| M3 Ultra | 80 | 1600 | 65.54 | apple-m3-ultra-gpu-80-cores |
| M4 | 10 | 1800 | 9.22 | apple-m4-gpu-10-cores |
| M4 Pro | 20 | 1800 | 18.43 | apple-m4-pro-gpu-20-cores |
| M4 Max | 40 | 1800 | 36.86 | apple-m4-max-gpu-40-cores |

Values in `gen_hardware.py` are rounded to 1 decimal place (e.g., 36.86 -> 36.9).

## Half-bandwidth Max configs

Some Max chips ship with fewer memory controllers in lower-memory configs:
- M1 Max 32GB: 200 GB/s (vs 400 for 64GB)
- M2 Max 32GB: 200 GB/s (vs 400 for 64/96GB)
- M3 Max 36GB: 200 GB/s (vs 400 for 48/64/128GB)
- M4 Max 36GB: 273 GB/s (vs 546 for 48/64/128GB)

These are handled via bandwidth override tuples (3-element) in `APPLE_SILICON`.

## Efficiency factor calibration

The `prefill_eff` factors multiply with `fp16_tflops` to estimate prefill speed.
The `decode_eff` factors multiply with `mem_bw_gb_s` to estimate decode speed.

Calibration target: M4 Max 128GB, 7B Q4 model, mlx
- Observed: ~600-700 tok/s prefill, ~80-100 tok/s decode (r/LocalLLaMA, Feb 2025)
- Model: `fp16_tflops(36.9) * prefill_eff(0.25) / (2 * 7e9) * 1e12 = 659 tok/s`
- Model: `mem_bw(546) * decode_eff(0.58) / weight_gb(3.5) = 90 tok/s`

Per-generation factors are lower for older chips due to less optimized Metal
shader support and lower IPC in the GPU microarchitecture.

## Key naming convention

The key format matches what `system_profiler SPHardwareDataType` produces:
- Chip "M2 Pro" + Memory "32 GB" -> key `m2_pro_32`
- Chip "M4" + Memory "16 GB" -> key `m4_16`
- Base chips (no variant): `{gen}_{mem}` (e.g., `m2_24`)
- Variant chips: `{gen}_{variant}_{mem}` (e.g., `m4_pro_48`)
