#!/usr/bin/env python3
"""Hourly snapshot of HF inference provider data.

Fetches live provider mappings (status, throughput, latency, pricing) for all
models across all providers. Writes a compact JSON snapshot to snapshots/.

Designed to run from GitHub Actions on an hourly cron, but works standalone.
Stdlib only -- no pip install needed.
"""

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

HF_API = "https://huggingface.co/api"
HF_TOKEN = os.environ.get("HF_TOKEN")

PROVIDERS = [
    "cerebras", "cohere", "fal-ai", "featherless-ai", "fireworks-ai",
    "groq", "hyperbolic", "nebius", "novita", "nscale", "ovhcloud",
    "publicai", "replicate", "sambanova", "scaleway", "together",
    "wavespeed", "zai-org", "hf-inference",
]

EXPAND = "&expand[]=inferenceProviderMapping"

STATUS_MAP = {"live": "l", "error": "e", "staging": "s"}


def fetch_json(url):
    headers = {"User-Agent": "hf-providers-snapshot/1.0"}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def extract_entries(models_by_id):
    """Build sorted list of [model, provider, status, tok/s, latency_ms, in_price, out_price]."""
    entries = []
    for mid in sorted(models_by_id):
        ipm = models_by_id[mid]
        if not isinstance(ipm, list):
            continue
        for info in sorted(ipm, key=lambda x: x.get("provider", "")):
            prov = info.get("provider")
            if not prov:
                continue
            status = STATUS_MAP.get(info.get("status"), "?")
            perf = info.get("performance") or {}
            details = info.get("providerDetails") or {}
            pricing = details.get("pricing") or {}

            tok_s = perf.get("tokensPerSecond")
            latency = perf.get("firstTokenLatencyMs")
            in_price = pricing.get("input")
            out_price = pricing.get("output")

            # Round floats for compactness
            if tok_s is not None:
                tok_s = round(tok_s, 1)
            if latency is not None:
                latency = round(latency)
            if in_price is not None:
                in_price = round(in_price, 4)
            if out_price is not None:
                out_price = round(out_price, 4)

            entries.append([mid, prov, status, tok_s, latency, in_price, out_price])
    return entries


def main():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    ts = now.strftime("%Y-%m-%dT%H-%M")

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    snap_dir = os.path.join(root, "snapshots")
    os.makedirs(snap_dir, exist_ok=True)

    out_path = os.path.join(snap_dir, f"{ts}.json")
    if os.path.exists(out_path):
        print(f"Snapshot already exists: {out_path}")
        return

    models_by_id = {}  # model_id -> inferenceProviderMapping array
    failed = []

    for prov in PROVIDERS:
        url = (
            f"{HF_API}/models?inference_provider={prov}"
            f"&limit=200&sort=likes&direction=-1{EXPAND}"
        )
        print(f"  {prov}...", end="", flush=True)
        try:
            results = fetch_json(url)
            count = 0
            for raw in results:
                mid = raw.get("id")
                ipm = raw.get("inferenceProviderMapping")
                if not mid or not ipm:
                    continue
                if mid not in models_by_id:
                    models_by_id[mid] = []
                # Merge provider entries (avoid duplicates)
                existing_provs = {e.get("provider") for e in models_by_id[mid]}
                for entry in (ipm if isinstance(ipm, list) else []):
                    if entry.get("provider") not in existing_provs:
                        models_by_id[mid].append(entry)
                        existing_provs.add(entry.get("provider"))
                        count += 1
            print(f" {len(results)} models, {count} new entries")
        except Exception as e:
            print(f" ERROR: {e}", file=sys.stderr)
            failed.append(prov)
        time.sleep(0.2)

    if failed:
        print(f"Failed providers: {', '.join(failed)}", file=sys.stderr)

    entries = extract_entries(models_by_id)

    snapshot = {
        "ts": now.isoformat(),
        "v": 1,
        "n": len(entries),
        "d": entries,
    }

    with open(out_path, "w") as f:
        json.dump(snapshot, f, separators=(",", ":"))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"Wrote {out_path} ({len(entries)} entries, {size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
