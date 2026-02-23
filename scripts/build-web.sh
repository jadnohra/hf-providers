#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Converting TOML data to JSON"
mkdir -p web/data web/pkg
python3 scripts/toml2json.py

echo "==> Fetching model data from HF API"
python3 scripts/fetch-models.py

echo "==> Building Wasm with wasm-pack"
wasm-pack build crates/hf-providers-web \
    --target web \
    --release \
    --out-dir ../../web/pkg \
    --out-name hf_providers

# wasm-pack generates a .gitignore in the output dir; remove it
rm -f web/pkg/.gitignore

echo "==> Build complete"
ls -lh web/pkg/hf_providers_bg.wasm
echo "Files in web/pkg/:"
ls web/pkg/
