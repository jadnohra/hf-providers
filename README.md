# hf-providers

Search Hugging Face inference providers, estimate GPU performance, compare costs.

Three things this tool does:

- **Search** models and providers (with automatic variant detection), browse interactively, get ready-to-use API call code (Python, curl, JS)
- **Estimate** what models fit on a GPU and how fast they'll run
- **Compare** the cost of API providers vs cloud GPU rental vs local hardware

Data: provider info comes live from the Hugging Face API. GPU specs (220+) and cloud pricing (50+ offerings) are bundled and can be updated with `hf-providers sync`.

<p align="center"><img src="assets/demo.gif" width="50%"></p>

## Install

```
brew install jadnohra/tap/hf-providers
```

Or build from source:

```
cargo install --git https://github.com/jadnohra/hf-providers
```

## Search models and providers

Search by name to see the full picture for any model: who serves it, what it costs, how fast it is, and how it would run on local hardware.

```
hf-providers deepseek-r1
hf-providers flux.1-dev
hf-providers meta-llama/Llama-3.3-70B-Instruct
hf-providers                                      # trending models
```

The detail view for a model shows:

- **Provider table** with live status (hot/warm/cold), input and output pricing per 1M tokens, throughput in tok/s, and whether each provider supports tool use and structured JSON output
- **Cheapest and fastest** provider summary
- **Model metadata**: parameter count, weight sizes at Q4/Q8/FP16, library, license, likes, downloads
- **Local GPU estimates** on 5 reference GPUs (RTX 4090, RTX 5090, M4 Pro, M4 Max, A100) showing quant, weight size, fit, decode tok/s, and prefill tok/s
- **Variant detection**: related models from the same family (different sizes, quantizations, fine-tunes) are found automatically and shown in the same view

Filter with `--cheapest`, `--fastest`, `--hot` (only live providers), `--tools` (only tool-use providers), or `--json` for machine-readable output.

![trending](assets/trending.png)

![search](assets/search.png)

### Interactive browser

The detail view opens an interactive tree browser where you can expand models into providers, expand providers into language options (Python, curl, JS), preview the API call code inline, and copy it to the clipboard.

**Keys:** arrow keys or `hjkl` to navigate, right to expand, `c` or Enter to copy, `q` or Esc to quit.

### Direct snippets

Get API call code directly without opening the browser:

```
hf-providers deepseek-r1@novita                   # python via novita
hf-providers deepseek-r1@novita:curl              # curl
hf-providers deepseek-r1@novita:js                # javascript
hf-providers snippet deepseek-r1 --cheapest       # cheapest provider
hf-providers snippet deepseek-r1 --fastest        # fastest provider
```

### Browse providers and live status

```
hf-providers providers                            # list all providers with type
hf-providers providers groq                       # models available on groq
hf-providers providers nebius --task image         # filter by task
hf-providers status deepseek-r1                   # live readiness + TTFT latency
hf-providers status deepseek-r1 --watch 5         # auto-refresh every 5s
```

`providers` lists all inference providers and whether they run on serverless GPUs or HF CPU. Drill into a provider to see its models, filterable by task.

`status` shows live readiness (hot/warm/cold/unavailable) and time-to-first-token latency for each provider serving a model. With `--watch`, it refreshes on a loop.

## GPU estimation

`hf-providers machine` answers "what can this GPU run?" It tests 10 reference models (4B to 671B) against the GPU and groups them into three categories:

- **comfortable**: fits in VRAM and decodes at 30+ tok/s
- **tight**: fits but decodes below 30 tok/s
- **won't run**: doesn't fit even at Q4

```
hf-providers machine rtx4090                      # reference models on RTX 4090
hf-providers machine m4-max-128                   # Apple M4 Max 128GB
hf-providers machine h100                         # H100
hf-providers machine rtx4090 deepseek-r1          # specific model on a GPU
```

The header shows GPU specs (VRAM, memory bandwidth, FP16 TFLOPS, TDP), street price, and estimated monthly electricity cost.

Each model row shows the best quantization that fits, estimated decode tok/s, and prefill tok/s. Apple Silicon GPUs show estimates for both mlx and llama.cpp runtimes.

With a specific model argument, it shows a detailed per-runtime breakdown with quant, weight size, fit status, decode, and prefill.

GPU names are fuzzy-matched: `4090`, `rtx4090`, `rtx-4090`, and `rtx_4090` all find the same GPU. 220+ GPUs in the database covering NVIDIA, AMD, Intel, and Apple Silicon.

## Cost comparison

`hf-providers need` compares three ways to run a model, all normalized to $/1M output tokens:

```
hf-providers need llama-3.3-70b
hf-providers need deepseek-r1
hf-providers need gemma-3-4b
```

It shows three sections:

- **API providers**: live status, input/output pricing per 1M tokens, sorted by output cost
- **Cloud GPU rental**: 50+ offerings across 5 providers, showing $/hr, best quant, estimated tok/s, and effective $/1M output tokens at full utilization
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

## License

MIT OR Apache-2.0
