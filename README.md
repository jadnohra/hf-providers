# hf-providers

Search Hugging Face inference providers, estimate GPU performance, compare costs.

Three things this tool does:

- **Search** models and providers, browse interactively, get ready-to-use API call code (Python, curl, JS)
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

Search by name to open an interactive browser where you can expand models into providers, pick a language (Python, curl, JS), and copy the API call code.

When you search for a model, related variants (different sizes, quantizations, fine-tunes from the same family) are automatically detected and shown in the same tree, so you can compare providers across all of them.

```
hf-providers deepseek-r1
hf-providers flux.1-dev
hf-providers meta-llama/Llama-3.3-70B-Instruct
hf-providers                                      # trending models
```

![trending](assets/trending.png)

![search](assets/search.png)

**Browser keys:** arrow keys or `hjkl` to navigate, right to expand, `c` or Enter to copy, `q` or Esc to quit.

You can also get the API call code directly without opening the browser:

```
hf-providers deepseek-r1@novita                   # python via novita
hf-providers deepseek-r1@novita:curl              # curl
hf-providers deepseek-r1@novita:js                # javascript
hf-providers snippet deepseek-r1 --cheapest       # cheapest provider
hf-providers snippet deepseek-r1 --fastest        # fastest provider
```

To browse providers or monitor live status across all of them:

```
hf-providers providers                            # list all
hf-providers providers groq                       # models on groq
hf-providers providers nebius --task image         # filter by task
hf-providers status deepseek-r1                   # live status
hf-providers status deepseek-r1 --watch 5         # auto-refresh every 5s
```

## GPU estimation

`hf-providers machine` shows which models fit on a given GPU, grouped into comfortable (>=30 tok/s), tight, or won't run. It supports NVIDIA, AMD, Intel, and Apple Silicon, and GPU names are fuzzy-matched so you don't need the exact key.

```
hf-providers machine rtx4090                      # reference models on RTX 4090
hf-providers machine m4-max-128                   # Apple M4 Max 128GB
hf-providers machine h100                         # H100
hf-providers machine rtx4090 deepseek-r1          # specific model on a GPU
```

Apple Silicon shows estimates for both mlx and llama.cpp runtimes.

## Cost comparison

`hf-providers need` compares the cost of running a model across three options: API providers (pay per token), cloud GPU rental (pay per hour), and local hardware (upfront cost plus electricity). All costs are normalized to $/1M output tokens so you can compare them directly.

```
hf-providers need llama-3.3-70b
hf-providers need deepseek-r1
hf-providers need gemma-3-4b
```

Cloud and local costs assume full utilization, so they represent the best-case floor. The local GPU section also includes a payback estimate showing how many tokens you'd need to generate before the hardware pays for itself relative to the cheapest API option.

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
