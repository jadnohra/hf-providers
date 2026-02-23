<p align="center">
  <img src="assets/logo.svg" width="280" alt="vram.run">
</p>

<p align="center">
  <b>Many inference providers serve Hugging Face models. Which one should you use?</b><br>
  <a href="https://vram.run"><b>Try it in the browser</b></a> &nbsp;|&nbsp; <code>brew install jadnohra/tap/hf-providers</code>
</p>

---

`hf-providers` answers five questions:

1. **Where can I run this model?** — every provider that serves it, with live status, pricing, and throughput
2. **Which is fastest / cheapest?** — get a ready-to-use API call routed through the best provider
3. **What does a provider offer?** — browse any provider's full model catalog
4. **What can my GPU run?** — test any GPU against reference models, see what fits and how fast
5. **What's the cheapest way to run it?** — API vs cloud rental vs local hardware, normalized to $/1M tokens

Data: provider info comes live from the Hugging Face API. GPU specs (220+) and cloud pricing (88 offerings from 16 providers) are bundled and can be updated with `hf-providers sync`.

<p align="center"><img src="assets/demo.gif" width="50%"></p>

## Install

```
brew install jadnohra/tap/hf-providers
```

Or build from source:

```
cargo install --git https://github.com/jadnohra/hf-providers
```

## Where can I run this model?

Search any model to see who serves it, what it costs, how fast it is, and how it would run on local hardware:

```
hf-providers deepseek-r1
hf-providers flux.1-dev
hf-providers meta-llama/Llama-3.3-70B-Instruct
hf-providers                                      # trending models
```

The detail view shows:

- **Provider table** with live status (hot/warm/cold), input and output pricing per 1M tokens, throughput in tok/s, and whether each provider supports tool use and structured JSON output
- **Cheapest and fastest** provider summary
- **Model metadata**: parameter count, weight sizes at Q4/Q8/FP16, library, license, likes, downloads
- **Local GPU estimates** on 5 reference GPUs (RTX 4090, RTX 5090, M4 Pro, M4 Max, A100) showing quant, weight size, fit, decode tok/s, and prefill tok/s
- **Variant detection**: related models from the same family (different sizes, quantizations, fine-tunes) are found automatically and shown in the same view

Filter with `--cheapest`, `--fastest`, `--hot` (only live providers), `--tools` (only tool-use providers), or `--json` for machine-readable output.

![trending](assets/trending.png)

![search](assets/search.png)

In the terminal, search results open an interactive tree browser. Expand models into providers, expand providers into language options (Python, curl, JS), preview the API call code inline, and copy it to the clipboard.

**Keys:** arrow keys or `hjkl` to navigate, right to expand, `c` or Enter to copy, `q` or Esc to quit.

## Which is fastest / cheapest?

Get API call code routed through the cheapest or fastest available provider:

```
hf-providers snippet deepseek-r1 --cheapest       # cheapest provider
hf-providers snippet deepseek-r1 --fastest        # fastest provider
hf-providers deepseek-r1@novita                   # python via novita
hf-providers deepseek-r1@novita:curl              # curl
hf-providers deepseek-r1@novita:js                # javascript
```

Monitor live availability with auto-refresh:

```
hf-providers status deepseek-r1                   # live readiness + TTFT latency
hf-providers status deepseek-r1 --watch 5         # auto-refresh every 5s
```

`status` shows live readiness (hot/warm/cold/unavailable) and time-to-first-token latency for each provider serving a model.

## What does a provider offer?

Browse any provider's full catalog, or list all providers:

```
hf-providers providers                            # list all providers with type
hf-providers providers groq                       # models available on groq
hf-providers providers nebius --task image         # filter by task
```

Each provider shows whether it runs on serverless GPUs or HF CPU, and its models can be filtered by task type.

## What can my GPU run?

`hf-providers machine` tests 10 reference models (4B to 671B) against a GPU and groups them into three categories:

- **comfortable**: fits in VRAM and decodes at 30+ tok/s
- **tight**: fits but decodes below 30 tok/s
- **won't run**: doesn't fit even at Q4

```
hf-providers machine rtx4090                      # reference models on RTX 4090
hf-providers machine m4-max-128                   # Apple M4 Max 128GB
hf-providers machine h100                         # H100
hf-providers machine rtx4090 deepseek-r1          # specific model on a GPU
```

The header shows GPU specs (VRAM, memory bandwidth, FP16 TFLOPS, TDP), street price, and estimated monthly electricity cost. Each model row shows the best quantization that fits, estimated decode tok/s, and prefill tok/s.

Apple Silicon GPUs show estimates for both mlx and llama.cpp runtimes. With a specific model argument, it shows a detailed per-runtime breakdown with quant, weight size, fit status, decode, and prefill.

GPU names are fuzzy-matched: `4090`, `rtx4090`, `rtx-4090`, and `rtx_4090` all find the same GPU. 220+ GPUs in the database covering NVIDIA, AMD, Intel, and Apple Silicon.

## What's the cheapest way to run it?

`hf-providers need` compares three ways to run a model, all normalized to $/1M output tokens:

```
hf-providers need llama-3.3-70b
hf-providers need deepseek-r1
hf-providers need gemma-3-4b
```

Three sections:

- **API providers**: live status, input/output pricing per 1M tokens, sorted by output cost
- **Cloud GPU rental**: 88 offerings from 16 providers, showing $/hr, best quant, estimated tok/s, and effective $/1M output tokens at full utilization
- **Local GPU**: street price, best quant, estimated tok/s, electricity-only $/1M output tokens ($0.12/kWh, 80% TDP), and a payback estimate showing how many tokens until the hardware pays for itself vs the cheapest API option

Cloud and local costs assume continuous generation at full speed, so they represent the floor. Real costs will be higher if the GPU sits idle.

## Keeping data fresh

GPU specs and cloud pricing are bundled in the binary. To pull the latest versions from GitHub:

```
hf-providers sync
```

Updated files are cached in `~/.cache/hf-providers/`. All commands check the cache first and fall back to the bundled data if no cache exists.

## Authentication

Set `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN`, or log in with `huggingface-cli login`. The token is read automatically from `~/.cache/huggingface/token`.

A token is optional but recommended. Authenticated requests get higher rate limits and access to gated models.

## Providers

Data comes live from the Hugging Face Inference API. Currently tracked:

Cerebras, Cohere, fal, Featherless, Fireworks, Groq, Hyperbolic, Nebius, Novita, Nscale, OVHcloud, Public AI, Replicate, SambaNova, Scaleway, Together AI, WaveSpeed, Z.ai, HF Inference

## Web UI

<p align="center"><img src="assets/screenshot-web.png" width="70%"></p>

[vram.run](https://vram.run) runs the same estimation engine as the CLI, compiled to a 125KB WebAssembly module via `wasm-bindgen`. Model data (828 models from 19 providers) is pre-cached at build time, so pages render instantly with no API calls for listings. Only individual model detail pages fetch live data for fresh provider enrichment.

The core Rust crate (`hf-providers-core`) is feature-gated: the `network` feature gates `reqwest`/`tokio`/`dirs` for the CLI, while the Wasm build compiles with no default features and links only `serde`, `serde_json`, and `wasm-bindgen`. The web crate (`hf-providers-web`) exposes estimation, snippet generation, hardware lookup, and cost calculation as JS-callable functions.

Pages:
- **Model detail** -- providers table, cost comparison (API vs cloud rental vs buy & run), hardware estimation cards, code snippets, variant detection
- **Hardware detail** -- spec header, check any model (quant x runtime matrix), compare two GPUs side by side with speed ratios, reference model table, cloud rental listings, electricity cost per model
- **Provider detail** -- model catalog, compare two providers with shared/exclusive breakdown and speed ratios
- **Browse** -- sortable and filterable tables for all models, hardware, providers, and cloud GPU offerings
- **Stats** -- superlatives across models, providers, hardware, and cloud

Static site in `web/`, built with `scripts/build-web.sh` (runs `wasm-pack`, converts TOML data to JSON, fetches model cache from HF API). Deployed to Cloudflare Pages.

## License

MIT OR Apache-2.0
