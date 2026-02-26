#!/usr/bin/env python3
"""Fetch all models with inference providers from HF API, save as static JSON.

Called at build time by build-web.sh to pre-cache model data so the web UI
doesn't need live API calls for listings/search.

Set HF_TOKEN env var for access to gated model metadata (config.json,
safetensors index). Without it, MoE models behind gates will have incomplete
parameter data.

Set ANTHROPIC_API_KEY env var to enable LLM extraction of total params from
model READMEs as a last-resort fallback for gated MoE models. Results are
cached in web/data/moe-params-cache.json so the LLM is only called once per
model.
"""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import date

HF_API = "https://huggingface.co/api"
HF_TOKEN = os.environ.get("HF_TOKEN")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

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

# -- MoE detection ---------------------------------------------------------

MOE_NxMB = re.compile(r'\d+x\d+\.?\d*b', re.I)      # 8x7B, 8x22B
MOE_NB_NE = re.compile(r'\d+\.?\d*b[-_]\d+e\b', re.I)  # 17B-16E, 17B-128E
MOE_FAMILIES = [
    "mixtral", "dbrx", "grok-1", "jamba",
    "deepseek-v2", "deepseek-v3",
]
# Match "deepseek-r1" only as base model (optionally with date suffix like -0528)
MOE_DEEPSEEK_R1 = re.compile(r'deepseek-r1(?:-\d+)?$', re.I)


def detect_moe(model_id):
    """Check if a model ID suggests a Mixture-of-Experts architecture.

    Excludes distilled models (dense derivatives of MoE architectures) and
    embedding models that share a family name with MoE models.
    """
    name = model_id.lower()
    # Distilled models are dense, not MoE
    if "distill" in name:
        return False
    if MOE_NxMB.search(name):
        return True
    if MOE_NB_NE.search(name):
        return True
    if "moe" in name:
        return True
    for fam in MOE_FAMILIES:
        if fam in name:
            return True
    # "arctic" but not embedding models
    if "arctic" in name and "arctic-embed" not in name:
        return True
    # DeepSeek-R1: only the base 671B model, not derivatives like R1-0528-Qwen3-8B
    # Extract the part after the org prefix for matching
    basename = name.split("/")[-1] if "/" in name else name
    if MOE_DEEPSEEK_R1.search(basename):
        return True
    return False


# -- HTTP helpers -----------------------------------------------------------

def fetch_json(url):
    headers = {"User-Agent": "hf-providers-build/1.0"}
    if HF_TOKEN:
        headers["Authorization"] = f"Bearer {HF_TOKEN}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def try_fetch_json(url):
    """Fetch JSON, return None on any error."""
    try:
        return fetch_json(url)
    except Exception:
        return None


# -- Safetensors index parsing ----------------------------------------------

def params_from_safetensors_index(model_id):
    """Try to compute total params from model.safetensors.index.json."""
    url = f"https://huggingface.co/{model_id}/resolve/main/model.safetensors.index.json"
    idx = try_fetch_json(url)
    if not idx or "weight_map" not in idx:
        return None
    # weight_map: {"layer.weight": "model-00001-of-00005.safetensors", ...}
    # metadata sometimes has total_size (bytes, not params)
    meta = idx.get("metadata", {})
    total_size = meta.get("total_size")
    if total_size is not None:
        # total_size is in bytes; assume bfloat16 (2 bytes per param) as default
        return int(total_size) // 2
    return None


def params_from_config(model_id):
    """Try to estimate total params from config.json architecture fields."""
    url = f"https://huggingface.co/{model_id}/resolve/main/config.json"
    cfg = try_fetch_json(url)
    if not cfg:
        return None
    # For multimodal models, text config is nested
    tc = cfg.get("text_config", cfg)
    experts = (
        tc.get("num_local_experts")
        or tc.get("num_experts")
        or tc.get("n_routed_experts")
    )
    if not experts:
        return None
    hidden = tc.get("hidden_size")
    intermediate = tc.get("intermediate_size")
    layers = tc.get("num_hidden_layers")
    vocab = tc.get("vocab_size")
    if not all([hidden, intermediate, layers, vocab]):
        return None
    # Rough param estimate: embedding + layers * (attention + experts * FFN)
    # Attention per layer: 4 * hidden^2 (Q, K, V, O projections)
    # FFN per expert: 3 * hidden * intermediate (gate, up, down)
    # This is approximate but much better than using active params only
    embed_params = vocab * hidden * 2  # input + output embeddings
    attn_per_layer = 4 * hidden * hidden
    ffn_per_expert = 3 * hidden * intermediate
    total = embed_params + layers * (attn_per_layer + experts * ffn_per_expert)
    return total


# -- MoE params cache -------------------------------------------------------

def load_moe_cache(root):
    """Load cached LLM-extracted params from web/data/moe-params-cache.json."""
    path = os.path.join(root, "web", "data", "moe-params-cache.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def save_moe_cache(root, cache):
    """Save the MoE params cache."""
    path = os.path.join(root, "web", "data", "moe-params-cache.json")
    with open(path, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
        f.write("\n")


# -- LLM extraction from README --------------------------------------------

def fetch_readme(model_id):
    """Fetch a model's README.md from HF. Works even for gated models."""
    url = f"https://huggingface.co/{model_id}/resolve/main/README.md"
    try:
        headers = {"User-Agent": "hf-providers-build/1.0"}
        if HF_TOKEN:
            headers["Authorization"] = f"Bearer {HF_TOKEN}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def _extract_readme_context(readme, model_id):
    """Extract the most relevant section of a README for param extraction.

    Looks for sections containing param-related keywords, falls back to
    the area around architecture/model info headings.
    """
    lower = readme.lower()
    # Try to find a window around "total" near "param" or "B"
    best_pos = None
    for keyword in ["(total)", "total)", "total param", "total_param"]:
        pos = lower.find(keyword)
        if pos >= 0:
            best_pos = pos
            break
    if best_pos is None:
        # Look for table-like content with param counts
        for keyword in ["num_experts", "num_local_experts", "model architecture",
                        "model information", "| param"]:
            pos = lower.find(keyword)
            if pos >= 0:
                best_pos = pos
                break
    if best_pos is not None:
        start = max(0, best_pos - 1000)
        end = min(len(readme), best_pos + 2000)
        return readme[start:end]
    # Fallback: first 4000 chars
    return readme[:4000]


def params_from_readme_llm(model_id):
    """Use Claude to extract total param count from a model's README."""
    if not ANTHROPIC_API_KEY:
        return None
    readme = fetch_readme(model_id)
    if not readme:
        return None
    excerpt = _extract_readme_context(readme, model_id)
    prompt = (
        f"From the following model card excerpt for {model_id}, extract the "
        f"TOTAL parameter count (not active/per-expert, but the total across "
        f"all experts for MoE models). "
        f"Reply with ONLY a single number in billions, like '109' or '400'. "
        f"If the total parameter count is not mentioned, reply with 'unknown'.\n\n"
        f"{excerpt}"
    )
    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 32,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()
    headers = {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
    }
    try:
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body, headers=headers, method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result["content"][0]["text"].strip()
        # Parse the number
        m = re.match(r'^(\d+\.?\d*)', text)
        if m:
            billions = float(m.group(1))
            return int(billions * 1e9)
    except Exception as e:
        print(f" LLM error: {e}", end="", flush=True)
    return None


# -- Model stripping --------------------------------------------------------

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


# -- Main -------------------------------------------------------------------

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_path = os.path.join(root, "web", "data", "models.json")
    if len(sys.argv) > 1:
        out_path = sys.argv[1]

    if not HF_TOKEN:
        print("  WARNING: HF_TOKEN not set -- gated model data may be incomplete",
              file=sys.stderr)

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

    # -- MoE enrichment pass ------------------------------------------------
    moe_cache = load_moe_cache(root)
    moe_cache_dirty = False
    moe_detected = 0
    moe_enriched = 0
    for mid, m in models.items():
        if not detect_moe(mid):
            continue
        m["is_moe"] = True
        moe_detected += 1
        # Already have real params? Skip enrichment.
        if m.get("safetensors", {}).get("total"):
            continue
        # Check cache first
        if mid in moe_cache:
            total = moe_cache[mid]["total_params"]
            m["safetensors"] = {"total": total}
            moe_enriched += 1
            fmt = f"{total / 1e9:.1f}B" if total >= 1e9 else f"{total / 1e6:.0f}M"
            print(f"  MoE enrich: {mid}... {fmt} (from cache, {moe_cache[mid]['extracted']})")
            continue
        # Try structured sources (needs HF_TOKEN for gated models)
        print(f"  MoE enrich: {mid}...", end="", flush=True)
        total = params_from_safetensors_index(mid)
        source = "safetensors index"
        if total is None:
            total = params_from_config(mid)
            source = "config.json"
        # Last resort: LLM extraction from README
        if total is None:
            total = params_from_readme_llm(mid)
            source = "readme-llm"
        if total:
            m["safetensors"] = {"total": total}
            moe_enriched += 1
            fmt = f"{total / 1e9:.1f}B" if total >= 1e9 else f"{total / 1e6:.0f}M"
            print(f" {fmt} (from {source})")
            # Cache LLM results so we don't re-extract next time
            if source == "readme-llm":
                moe_cache[mid] = {
                    "total_params": total,
                    "extracted": date.today().isoformat(),
                    "source": source,
                }
                moe_cache_dirty = True
        else:
            print(" no data found")
        time.sleep(0.3)

    if moe_cache_dirty:
        save_moe_cache(root, moe_cache)
        print(f"  MoE cache updated: {len(moe_cache)} entries")

    if moe_detected:
        print(f"\n  MoE: {moe_detected} detected, {moe_enriched} enriched with real params")

    sorted_models = sorted(
        models.values(), key=lambda m: m.get("likes", 0), reverse=True
    )

    with open(out_path, "w") as f:
        json.dump(sorted_models, f, separators=(",", ":"))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n  {len(sorted_models)} models -> {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
