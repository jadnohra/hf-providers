# hf-providers — Design Doc

## The One-Liner

**"I want to run this model — what are my options?"**

A CLI + library that answers this question instantly, addressing four pain points that the HF community consistently struggles with.

---

## Pain Points We Solve

| # | Pain | Current Reality | Our Answer |
|---|------|----------------|------------|
| 1 | **"Can I run this model?"** | Browse web UI checkboxes, no CLI | `hfp run deepseek-r1` → full answer |
| 2 | **"What kind of running?"** | Inference Providers / HF Inference / Endpoints / Local all blur together | Clear categories with color-coded output |
| 3 | **"Is it ready NOW?"** | API only says "warm" or nothing | Live status + cold start estimates |
| 4 | **"What will it cost?"** | Pricing scattered, surprise bills | Side-by-side cost comparison |

---

## CLI Design — `hfp`

Short name. Fast to type. Memorable.

### Core Command: Just Give Me the Answer

```bash
$ hfp deepseek-r1
```

```
╭─ deepseek-ai/DeepSeek-R1 ──────────────────────────────────────────╮
│  Text Generation · 🔥 Trending · ♥ 48k · ↓ 12M                     │
╰─────────────────────────────────────────────────────────────────────╯

⚡ SERVERLESS INFERENCE (API call, pay-per-token, instant)
┌──────────────┬────────┬──────────┬──────────┬────────┬───────┬──────┐
│ Provider     │ Status │ In $/1M  │ Out $/1M │ Tput   │ Tools │ JSON │
├──────────────┼────────┼──────────┼──────────┼────────┼───────┼──────┤
│ novita       │ 🟢 hot │ $0.56    │ $2.00    │ 27 t/s │  ✓    │      │
│ sambanova    │ 🟢 hot │ —        │ —        │ 204t/s │       │  ✓   │
│ hyperbolic   │ 🟢 hot │ $2.00    │ $2.00    │ 45 t/s │       │      │
│ together     │ 🟡 warm│ $3.00    │ $7.00    │ 34 t/s │       │  ✓   │
│ fireworks-ai │ ⚫ cold│ —        │ —        │ —      │       │      │
└──────────────┴────────┴──────────┴──────────┴────────┴───────┴──────┘
  cheapest: novita ($0.56/$2.00)  fastest: sambanova (204 t/s)

🖥  DEDICATED ENDPOINT (your own GPU, pay-per-hour)
   Deploy via: huggingface.co/deepseek-ai/DeepSeek-R1 → Deploy → Inference Endpoints
   Estimated: ~$4.50/hr on A100 80GB

💻 LOCAL (free, your hardware)
   ollama run deepseek-r1          # if available
   vllm serve deepseek-ai/DeepSeek-R1
   transformers: AutoModelForCausalLM.from_pretrained("deepseek-ai/DeepSeek-R1")
   VRAM needed: ~160GB FP16 / ~80GB INT8

╭─ 📦 Variants ──────────────────────────────────────────────────────╮
│ deepseek-ai/DeepSeek-R1-0528          5 providers  671B   latest   │
│ deepseek-ai/DeepSeek-R1-Distill-Qwen-32B  2 providers  32B  ⭐    │
│ deepseek-ai/DeepSeek-R1-Distill-Llama-70B 4 providers  70B        │
│ deepseek-ai/DeepSeek-R1-Distill-Qwen-14B  2 providers  14B        │
│ deepseek-ai/DeepSeek-R1-Distill-Qwen-7B   1 provider   7B         │
│ deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B 1 provider   1.5B       │
│ deepseek-ai/DeepSeek-R1-Distill-Llama-8B  1 provider   8B         │
│                                                                     │
│ Run: hfp deepseek-r1-distill-qwen-32b for details                  │
╰─────────────────────────────────────────────────────────────────────╯

💡 Quick start:
   hfp run deepseek-ai/DeepSeek-R1    # copy-paste code snippet
```

### Quick Start Snippet

```bash
$ hfp run deepseek-r1
```

```
# Cheapest provider (novita, ~$0.56/1M input tokens)
from huggingface_hub import InferenceClient
client = InferenceClient(provider="novita")
r = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-R1",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Or OpenAI-compatible (auto-routes to fastest)
from openai import OpenAI
client = OpenAI(base_url="https://router.huggingface.co/v1", api_key="hf_...")
client.chat.completions.create(model="deepseek-ai/DeepSeek-R1:fastest", ...)

# curl
curl -X POST https://router.huggingface.co/v1/chat/completions \
  -H "Authorization: Bearer $HF_TOKEN" \
  -d '{"model":"deepseek-ai/DeepSeek-R1:cheapest","messages":[...]}'
```

### Sorting & Filtering

```bash
hfp deepseek-r1 --cheapest          # sort by price
hfp deepseek-r1 --fastest           # sort by throughput
hfp deepseek-r1 --tools             # only providers with tool calling
hfp deepseek-r1 --json              # machine-readable output
hfp deepseek-r1 --hot               # only providers with hot/ready status
```

### Provider-Centric Queries

```bash
hfp providers                       # list all 15+ providers
hfp providers groq                  # what does Groq serve?
hfp providers groq --task chat      # Groq's chat models
hfp providers --compare llama-70b   # side-by-side all providers for one model
```

### Status / Health

```bash
hfp status deepseek-r1              # live status across all providers
hfp status deepseek-r1 --watch      # auto-refresh every 5s
```

```
deepseek-ai/DeepSeek-R1 — status at 14:32:01
┌──────────────┬────────┬──────────────────┐
│ Provider     │ Status │ Response Time    │
├──────────────┼────────┼──────────────────┤
│ novita       │ 🟢 hot │ ~890ms TTFT      │
│ sambanova    │ 🟢 hot │ ~450ms TTFT      │
│ together     │ 🟡 warm│ ~780ms TTFT      │
│ fireworks-ai │ ⚫ cold│ unavailable      │
└──────────────┴────────┴──────────────────┘
  ↻ refreshing in 5s...
```

### Fuzzy Search

```bash
hfp llama 3.3                       # finds meta-llama/Llama-3.3-70B-Instruct
hfp flux                            # finds FLUX.1-dev, FLUX.1-schnell, etc.
hfp qwen coder                      # finds Qwen3-Coder variants
hfp "whisper large"                  # finds openai/whisper-large-v3
```

---

## Library Design

### Python (via PyO3 bindings)

```python
from hf_providers import Model, providers

# The core question
model = Model("deepseek-r1")
model.name              # "deepseek-ai/DeepSeek-R1"
model.task              # "text-generation"
model.providers         # [Provider(name="novita", status="live", ...), ...]
model.variants          # [Model("DeepSeek-R1-0528"), Model("DeepSeek-R1-Distill-Qwen-32B"), ...]
model.cheapest          # Provider(name="novita", input_price=0.56, output_price=2.00)
model.fastest           # Provider(name="sambanova", throughput=204)

# Filter
model.providers_with(tools=True)
model.providers_with(status="hot")
model.providers_with(structured_output=True)

# Quick start code
print(model.snippet("python"))      # ready-to-paste code
print(model.snippet("curl"))
print(model.snippet("javascript"))

# Provider-centric
groq = providers.get("groq")
groq.models                         # all models on Groq
groq.models(task="text-generation") # filtered
groq.status("deepseek-r1")         # status for specific model
```

### Rust (native)

```rust
use hf_providers::{Model, Providers};

#[tokio::main]
async fn main() {
    let model = Model::search("deepseek-r1").await?;
    
    println!("{}", model.name);           // deepseek-ai/DeepSeek-R1
    
    for p in model.providers() {
        println!("{}: {} - {} t/s", 
            p.name, p.status, p.throughput.unwrap_or(0));
    }
    
    let cheapest = model.cheapest()?;
    let fastest = model.fastest()?;
}
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              hf-providers CLI               │
│           (Rust binary — `hfp`)             │
├─────────────────────────────────────────────┤
│           hf-providers-core (Rust)          │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Model    │ │ Provider │ │ Status      │ │
│  │ Search   │ │ Registry │ │ Checker     │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Pricing  │ │ Variant  │ │ Snippet     │ │
│  │ Fetcher  │ │ Grouper  │ │ Generator   │ │
│  └──────────┘ └──────────┘ └─────────────┘ │
├─────────────────────────────────────────────┤
│        HF Hub API (REST)                    │
│  GET /api/models?inference_provider=...     │
│  GET /api/models/{id}?expand[]=inf...       │
│  GET /inference/models (pricing page)       │
├─────────────────────────────────────────────┤
│      Python bindings (PyO3/maturin)         │
│           `pip install hf-providers`        │
└─────────────────────────────────────────────┘
```

### Data Sources

| Data | Source | Method |
|------|--------|--------|
| Provider mapping | `GET /api/models/{id}?expand[]=inferenceProviderMapping` | REST API |
| Model search | `GET /api/models?search=...` | REST API |
| Provider list | `GET /api/models?inference_provider=...` | REST API |
| Warm/cold status | `GET /api/models/{id}?expand[]=inference` | REST API |
| Pricing & metrics | `GET /inference/models` page | Parse structured data |
| Local run info | Model card metadata (params, arch) | REST API |

### Caching

- Cache model info for 5 minutes (providers don't change that fast)
- Cache pricing data for 1 hour
- Status checks are always live (that's the point)
- Cache in `~/.cache/hf-providers/`

---

## Project Structure

```
hf-providers/
├── Cargo.toml
├── README.md
├── crates/
│   ├── hf-providers-core/    # Library: API client, data types, logic
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── model.rs      # Model search, info, variants
│   │   │   ├── provider.rs   # Provider registry, status
│   │   │   ├── pricing.rs    # Cost data fetching
│   │   │   ├── snippet.rs    # Code snippet generation
│   │   │   ├── cache.rs      # Local caching layer
│   │   │   └── api.rs        # HF Hub API client
│   │   └── Cargo.toml
│   └── hf-providers-cli/     # Binary: CLI interface
│       ├── src/
│       │   ├── main.rs
│       │   ├── display.rs    # Terminal rendering (tables, colors)
│       │   └── commands/
│       │       ├── search.rs # `hfp <query>`
│       │       ├── run.rs    # `hfp run <model>`
│       │       ├── status.rs # `hfp status <model>`
│       │       └── providers.rs # `hfp providers [name]`
│       └── Cargo.toml
├── python/                   # Python bindings
│   ├── src/lib.rs            # PyO3 bindings
│   ├── pyproject.toml
│   └── hf_providers/
│       ├── __init__.py
│       └── py.typed
└── tests/
```

### Key Rust Dependencies

```toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
comfy-table = "7"           # Beautiful terminal tables
console = "0.15"            # Colors, styling
indicatif = "0.17"          # Progress bars
fuzzy-matcher = "0.3"       # Fuzzy model name matching
directories = "5"           # Cache paths
```

---

## Status Detection Strategy

The HF API is limited — it only gives "warm" or nothing. We augment this:

1. **API status** — `model_info(expand="inference")` → warm/undefined
2. **Provider mapping status** — `inferenceProviderMapping[provider].status` → "live"/"staging"
3. **Pricing page data** — latency numbers present = likely hot; `-` = likely cold/unavailable
4. **Optional: live probe** — `hfp status --probe` sends a tiny request to each provider and measures TTFT

Display as:
- 🟢 **hot** — provider has latency data, status=live, inference=warm
- 🟡 **warm** — status=live but no latency data (might have cold start)
- ⚫ **cold** — status=live but all metrics show `-` (probably needs spin-up)
- ❌ **unavailable** — not in provider mapping at all

---

## MVP Scope (v0.1)

1. `hfp <query>` — fuzzy search, show providers + status + pricing
2. `hfp run <model>` — code snippets for Python, curl, JS
3. `hfp providers` — list all providers
4. `hfp --json` — machine-readable output
5. Cache layer
6. Reads `$HF_TOKEN` / `~/.cache/huggingface/token`

## v0.2

7. `hfp status --watch` — live monitoring
8. `hfp status --probe` — actual latency measurement
9. Python bindings via PyO3
10. `brew install` / `cargo install` distribution

## v0.3

11. Local run detection (check if ollama has the model, estimate VRAM)
12. Cost calculator (`hfp cost deepseek-r1 --tokens 1M`)
13. Shell completions (bash, zsh, fish)
