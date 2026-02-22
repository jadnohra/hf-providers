# hf-providers

Find inference providers for Hugging Face models, compare them, get code snippets.

![demo](assets/demo.gif)

## Install

```
brew install jadnohra/tap/hf-providers
```

Or build from source:

```
cargo install --git https://github.com/jadnohra/hf-providers
```

## Usage

### Search and browse models

Search by name. Opens an interactive tree browser where you can expand models into providers, pick a language, and copy code snippets.

```
hf-providers deepseek-r1
hf-providers flux.1-dev
hf-providers meta-llama/Llama-3.3-70B-Instruct
```

With no arguments, shows the top 10 trending models.

```
hf-providers
```

![trending](assets/trending.png)

![search](assets/search.png)

**Browser keys:** arrow keys or `hjkl` to navigate, right to expand, `c` or Enter to copy snippet, `q` or Esc to quit.

### Code snippets

Get a code snippet directly without the interactive browser.

```
hf-providers deepseek-r1@novita           # python snippet via novita
hf-providers deepseek-r1@novita:curl      # curl snippet
hf-providers deepseek-r1@novita:js        # javascript snippet
hf-providers snippet deepseek-r1 --cheapest   # cheapest provider
hf-providers snippet deepseek-r1 --fastest    # fastest provider
```

### Providers

List all providers or browse a specific provider's models.

```
hf-providers providers                    # list all providers
hf-providers providers groq               # models available on groq
hf-providers providers nebius --task image # filter by task
```

### Live status

Monitor provider status for a model across all providers.

```
hf-providers status deepseek-r1
hf-providers status deepseek-r1 --watch 5   # auto-refresh every 5s
```

### Machine: what can this GPU run?

Show which models fit on a GPU, categorized by performance. Supports NVIDIA, AMD, Intel, and Apple Silicon. GPU names are fuzzy-matched.

```
hf-providers machine rtx4090              # reference models on RTX 4090
hf-providers machine m4-max-128           # Apple M4 Max 128GB
hf-providers machine h100                 # H100
hf-providers machine rtx4090 deepseek-r1  # specific model on a GPU
```

Apple Silicon shows estimates for both mlx and llama.cpp runtimes.

### Need: API vs cloud vs local cost

Compare the cost of using a model through an API provider, renting a cloud GPU, or running locally. Shows cost per 1M output tokens across all options, plus payback period for local hardware.

```
hf-providers need llama-3.3-70b
hf-providers need deepseek-r1
hf-providers need gemma-3-4b
```

## Authentication

Set `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN`, or log in with `huggingface-cli login`. The token is read automatically from `~/.cache/huggingface/token`.

A token is optional but recommended. Authenticated requests get higher rate limits and access to gated models.

## Providers

Data comes live from the Hugging Face Inference API. Currently tracked providers:

Cerebras, Cohere, fal, Featherless, Fireworks, Groq, Hyperbolic, Nebius, Novita, Nscale, OVHcloud, Public AI, Replicate, SambaNova, Scaleway, Together AI, WaveSpeed, Z.ai, HF Inference

## License

MIT OR Apache-2.0
