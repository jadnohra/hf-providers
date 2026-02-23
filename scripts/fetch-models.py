#!/usr/bin/env python3
"""Fetch all models with inference providers from HF API, save as static JSON.

Called at build time by build-web.sh to pre-cache model data so the web UI
doesn't need live API calls for listings/search.
"""

import json
import os
import sys
import time
import urllib.request

HF_API = "https://huggingface.co/api"

PROVIDERS = [
    "cerebras", "cohere", "fal-ai", "featherless-ai", "fireworks-ai",
    "groq", "hyperbolic", "nebius", "novita", "nscale", "ovhcloud",
    "publicai", "replicate", "sambanova", "scaleway", "together",
    "wavespeed", "zai-org", "hf-inference",
]

EXPAND = (
    "&expand[]=inferenceProviderMapping"
    "&expand[]=safetensors"
    "&expand[]=likes"
    "&expand[]=downloads"
    "&expand[]=pipeline_tag"
    "&expand[]=library_name"
)


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "hf-providers-build/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def strip_model(raw):
    """Keep only the fields the web UI needs."""
    mid = raw.get("id")
    if not mid:
        return None
    m = {"id": mid}
    for k in ("pipeline_tag", "likes", "downloads", "library_name"):
        if raw.get(k) is not None:
            m[k] = raw[k]
    st = raw.get("safetensors")
    if isinstance(st, dict) and st.get("total") is not None:
        m["safetensors"] = {"total": st["total"]}
    ipm = raw.get("inferenceProviderMapping")
    if ipm:
        m["inferenceProviderMapping"] = ipm
    return m


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_path = os.path.join(root, "web", "data", "models.json")
    if len(sys.argv) > 1:
        out_path = sys.argv[1]

    models = {}

    for prov in PROVIDERS:
        url = (
            f"{HF_API}/models?inference_provider={prov}"
            f"&limit=200&sort=likes&direction=-1{EXPAND}"
        )
        print(f"  {prov}...", end="", flush=True)
        try:
            results = fetch_json(url)
            new = 0
            for raw in results:
                mid = raw.get("id")
                if not mid or mid in models:
                    continue
                stripped = strip_model(raw)
                if stripped:
                    models[mid] = stripped
                    new += 1
            print(f" {len(results)} fetched, {new} new (total: {len(models)})")
        except Exception as e:
            print(f" ERROR: {e}")
        time.sleep(0.2)

    sorted_models = sorted(
        models.values(), key=lambda m: m.get("likes", 0), reverse=True
    )

    with open(out_path, "w") as f:
        json.dump(sorted_models, f, separators=(",", ":"))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n  {len(sorted_models)} models -> {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
