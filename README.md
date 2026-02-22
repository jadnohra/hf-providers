# hf-providers

Search Hugging Face inference providers, estimate GPU performance, compare costs.

![demo](assets/demo.gif)

Three things this tool does:

- **Search** models and providers, browse interactively, get code snippets
- **Estimate** what models fit on a GPU and how fast they'll run
- **Compare** the cost of API providers vs cloud GPU rental vs local hardware

Data: provider info comes live from the Hugging Face API. GPU specs (220+) and cloud pricing (50+ offerings) are bundled and can be updated with `hf-providers sync`.

## Install

```
brew install jadnohra/tap/hf-providers
```

Or build from source:

```
cargo install --git https://github.com/jadnohra/hf-providers
```

## Search models and providers

Search by name to open an interactive browser. Expand models into providers, pick a language, copy code snippets.

```
hf-providers deepseek-r1
hf-providers flux.1-dev
hf-providers meta-llama/Llama-3.3-70B-Instruct
hf-providers                                      # trending models
```

![trending](assets/trending.png)

![search](assets/search.png)

**Browser keys:** arrow keys or `hjkl` to navigate, right to expand, `c` or Enter to copy snippet, `q` or Esc to quit.

Get a snippet directly without the browser:

```
hf-providers deepseek-r1@novita                   # python via novita
hf-providers deepseek-r1@novita:curl              # curl
hf-providers deepseek-r1@novita:js                # javascript
hf-providers snippet deepseek-r1 --cheapest       # cheapest provider
hf-providers snippet deepseek-r1 --fastest        # fastest provider
```

Browse providers:

```
hf-providers providers                            # list all
hf-providers providers groq                       # models on groq
hf-providers providers nebius --task image         # filter by task
```

Monitor live status:

```
hf-providers status deepseek-r1
hf-providers status deepseek-r1 --watch 5         # auto-refresh every 5s
```

## GPU estimation

`hf-providers machine` shows which models fit on a GPU, categorized as comfortable (>=30 tok/s), tight, or won't run. Supports NVIDIA, AMD, Intel, and Apple Silicon. GPU names are fuzzy-matched.

```
hf-providers machine rtx4090                      # reference models on RTX 4090
hf-providers machine m4-max-128                   # Apple M4 Max 128GB
hf-providers machine h100                         # H100
hf-providers machine rtx4090 deepseek-r1          # specific model on a GPU
```

Apple Silicon shows estimates for both mlx and llama.cpp runtimes.

## Cost comparison

`hf-providers need` compares the cost of running a model across three options: API providers (pay per token), cloud GPU rental (pay per hour), and local hardware (buy + electricity). All costs are shown as $/1M output tokens for direct comparison.

```
hf-providers need llama-3.3-70b
hf-providers need deepseek-r1
hf-providers need gemma-3-4b
```

Cloud and local costs assume full utilization (best case floor). Local GPU section includes a payback estimate: how many tokens until the hardware pays for itself vs the cheapest API.

## Keeping data fresh

GPU specs and cloud pricing are bundled in the binary. To pull the latest data:

```
hf-providers sync
```

This downloads updated files from GitHub and caches them in `~/.cache/hf-providers/`. All commands check the cache first, falling back to bundled data.

## Authentication

Set `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN`, or log in with `huggingface-cli login`. The token is read automatically from `~/.cache/huggingface/token`.

Optional but recommended. Authenticated requests get higher rate limits and access to gated models.

## License

MIT OR Apache-2.0
