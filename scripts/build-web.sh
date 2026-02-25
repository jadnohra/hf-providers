#!/usr/bin/env bash
# Build the vram.run static site (web/ directory).
#
# Steps:
#   1. Convert hardware.toml + cloud.toml -> JSON (web/data/*.json)
#   2. Fetch model data from HF API -> web/data/models.json (~828 models, 19 providers)
#   3. Compile estimation engine to Wasm via wasm-pack -> web/pkg/
#   4. Stamp version from Cargo.toml into index.html footer
#   5. Pre-render ~1,100 static HTML pages for SEO (model, hw, provider, browse pages,
#      sitemap.xml, robots.txt, 404.html). These are gitignored build artifacts.
#
# The site uses pushState routing. Pre-rendered pages provide SEO content;
# the SPA (app.js) boots on top for interactivity.
#
# Local dev: after building, run `python3 -m http.server 8080` from web/
# and use Cmd+Shift+R to bypass browser cache after changes.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. Convert TOML data files to JSON for the browser
echo "==> Converting TOML data to JSON"
mkdir -p web/data web/pkg
python3 scripts/toml2json.py

# 2. Fetch and cache model data from HF API (19 providers x 200 limit)
echo "==> Fetching model data from HF API"
python3 scripts/fetch-models.py

# 3. Build the Wasm estimation engine
echo "==> Building Wasm with wasm-pack"
wasm-pack build crates/hf-providers-web \
    --target web \
    --release \
    --out-dir ../../web/pkg \
    --out-name hf_providers

# wasm-pack generates a .gitignore in the output dir; remove it
rm -f web/pkg/.gitignore

# 4. Stamp version from Cargo.toml into the HTML footer
echo "==> Stamping version"
VER=$(grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/')
sed -i.bak "s|<span id=\"ver\">v[^<]*</span>|<span id=\"ver\">v${VER}</span>|" web/index.html
rm -f web/index.html.bak
echo "    version: v${VER}"

# 5. Pre-render static HTML pages for SEO (reads web/data/*.json, writes to web/)
echo "==> Pre-rendering SEO pages"
python3 scripts/build-seo-pages.py

echo "==> Build complete"
ls -lh web/pkg/hf_providers_bg.wasm
echo "Files in web/pkg/:"
ls web/pkg/
