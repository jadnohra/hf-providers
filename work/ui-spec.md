# hfp — Terminal UI Spec

Follows terminus style: muted grays, no emoji, unicode symbols only, high density.

## Color Palette

```rust
const HEADER:  Color = Color::Fixed(245);  // Medium gray — model name, path
const DIM:     Color = Color::Fixed(240);  // Dark gray — metadata, secondary
const TREE:    Color = Color::Fixed(238);  // Very dark gray — structure chars
const HINT:    Color = Color::Fixed(236);  // Almost invisible — footer help
const BOLD:    Style = Style::new().bold(); // Selection, emphasis

// Status (used sparingly)
const HOT:     Color = Color::Fixed(70);   // Muted green
const WARM:    Color = Color::Fixed(214);  // Yellow-orange  
const COLD:    Color = Color::Fixed(240);  // Dark gray
const UNAVAIL: Color = Color::Fixed(131);  // Muted red
const PRICE:   Color = Color::Fixed(109);  // Muted cyan — pricing
```

## Status Symbols

```
● hot        (filled circle, muted green)
◐ warm       (half circle, yellow-orange)
○ cold       (empty circle, dark gray)
✗ unavail    (x mark, muted red)
✓ yes        (check, muted green)  
─ no/unknown (dash, dark gray)
```

No emoji anywhere. Ever.

---

## Main Command: `hfp deepseek-r1`

```
deepseek-ai/DeepSeek-R1  text-generation  671B
♥ 48k  ↓ 12M  inference: warm

serverless providers
────────────────────────────────────────────────────────────────
  Provider       Status   In $/1M  Out $/1M   Tput    Tools  JSON
  novita         ● hot     $0.56    $2.00    27 t/s    ✓      ─
  sambanova      ● hot       ─        ─     204 t/s    ─      ✓
  hyperbolic     ● hot     $2.00    $2.00    45 t/s    ─      ─
  together       ◐ warm    $3.00    $7.00    34 t/s    ─      ✓
  fireworks-ai   ○ cold      ─        ─        ─       ─      ─
────────────────────────────────────────────────────────────────
  cheapest: novita ($0.56/$2.00)   fastest: sambanova (204 t/s)

dedicated endpoint
  Deploy at huggingface.co → Deploy → Inference Endpoints
  ~$4.50/hr on A100 80GB

local
  vllm serve deepseek-ai/DeepSeek-R1
  VRAM: ~1340GB FP16 / ~670GB INT8 / ~335GB INT4

variants
────────────────────────────────────────────────────────────────
  deepseek-ai/DeepSeek-R1-0528               5 providers  671B
  deepseek-ai/DeepSeek-R1-Distill-Qwen-32B   2 providers   32B
  deepseek-ai/DeepSeek-R1-Distill-Llama-70B  4 providers   70B
  deepseek-ai/DeepSeek-R1-Distill-Qwen-14B   2 providers   14B
  deepseek-ai/DeepSeek-R1-Distill-Qwen-7B    1 provider     7B
  deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B  1 provider   1.5B
────────────────────────────────────────────────────────────────
  hfp <variant> for details   hfp run <model> for code snippets
```

### Anatomy

- **Line 1**: Model ID (bold) + pipeline tag + param size — all on one line
- **Line 2**: Stats in dim gray. `inference: warm` is the HF API status.
- **Section headers**: Lowercase, no decoration, just the word
- **Separator**: Simple `─` line, not full-width box drawing
- **Table**: Space-aligned columns, no box borders. Header is just text.
- **Footer hints**: Almost invisible gray

---

## Search Results: `hfp llama 3.3`

```
search: llama 3.3
────────────────────────────────────────────────────────────────
  meta-llama/Llama-3.3-70B-Instruct      text-generation  11 providers  70B
  meta-llama/Llama-3.3-70B-Instruct-FP8  text-generation   2 providers  70B
  meta-llama/Llama-3.3-70B               text-generation   0 providers  70B
────────────────────────────────────────────────────────────────
  3 results   hfp <model-id> for details
```

When there's a single strong match, skip straight to the full view.
When multiple, show this compact list.

---

## Run Command: `hfp run deepseek-r1`

```
# deepseek-ai/DeepSeek-R1 via novita (cheapest)

from huggingface_hub import InferenceClient
client = InferenceClient(provider="novita")
r = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-R1",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(r.choices[0].message.content)
```

Just the code. One comment line for context. Ready to copy-paste.

Flags control output:
```
hfp run deepseek-r1                    # python, cheapest provider
hfp run deepseek-r1 --lang curl        # curl
hfp run deepseek-r1 --lang js          # javascript
hfp run deepseek-r1 --provider groq    # specific provider
hfp run deepseek-r1 --fastest          # auto-pick fastest
```

---

## Providers Command: `hfp providers`

```
inference providers
────────────────────────────────────────────────────────────────
  cerebras         Cerebras        serverless GPU
  cohere           Cohere          serverless GPU
  fal-ai           fal             serverless GPU
  featherless-ai   Featherless     serverless GPU
  fireworks-ai     Fireworks       serverless GPU
  groq             Groq            serverless GPU
  hf-inference     HF Inference    HF CPU
  hyperbolic       Hyperbolic      serverless GPU
  nebius           Nebius          serverless GPU
  novita           Novita          serverless GPU
  nscale           Nscale          serverless GPU
  ovhcloud         OVHcloud        serverless GPU
  publicai         Public AI       serverless GPU
  replicate        Replicate       serverless GPU
  sambanova        SambaNova       serverless GPU
  scaleway         Scaleway        serverless GPU
  together         Together AI     serverless GPU
  wavespeed        WaveSpeed       serverless GPU
  zai-org          Z.ai            serverless GPU
────────────────────────────────────────────────────────────────
  19 providers   hfp providers <name> for models
```

### Provider Detail: `hfp providers groq`

```
groq — Groq  serverless GPU
────────────────────────────────────────────────────────────────
  openai/gpt-oss-20b                     text-generation  ♥ 2.1k
  openai/gpt-oss-120b                    text-generation  ♥ 5.4k
  meta-llama/Llama-3.3-70B-Instruct      text-generation  ♥ 12k
  meta-llama/Llama-4-Scout-17B-16E       text-generation  ♥ 3.2k
  meta-llama/Llama-4-Maverick-17B-128E   text-generation  ♥ 1.8k
  Qwen/Qwen3-32B                         text-generation  ♥ 890
  zai-org/GLM-4.6                        text-generation  ♥ 430
────────────────────────────────────────────────────────────────
  7 models   hfp <model> for details
```

---

## Status Command: `hfp status deepseek-r1`

```
deepseek-ai/DeepSeek-R1  14:32:01
────────────────────────────────────────────────────────────────
  novita         ● hot     ~890ms TTFT
  sambanova      ● hot     ~450ms TTFT
  together       ◐ warm    ~780ms TTFT
  fireworks-ai   ○ cold    unavailable
────────────────────────────────────────────────────────────────
```

### With `--watch`:

```
deepseek-ai/DeepSeek-R1  14:32:01  ✱ refreshing...
────────────────────────────────────────────────────────────────
  novita         ● hot     ~890ms TTFT
  sambanova      ● hot     ~450ms TTFT
  together       ◐ warm    ~780ms TTFT
  fireworks-ai   ○ cold    unavailable
────────────────────────────────────────────────────────────────
  ↻ 5s
```

Uses the terminus pulse animation (✱ → ✦ → · → ✦) for refresh.

---

## JSON Output: `hfp deepseek-r1 --json`

Clean JSON, no decoration:

```json
{
  "id": "deepseek-ai/DeepSeek-R1",
  "pipeline_tag": "text-generation",
  "param_hint": "671B",
  "likes": 48200,
  "downloads": 12400000,
  "inference_status": "warm",
  "providers": [
    {
      "name": "novita",
      "readiness": "hot",
      "task": "conversational",
      "input_price_per_m": 0.56,
      "output_price_per_m": 2.00,
      "throughput_tps": 27,
      "latency_s": 0.98,
      "supports_tools": true,
      "supports_structured": false
    }
  ],
  "variants": [
    {
      "id": "deepseek-ai/DeepSeek-R1-0528",
      "provider_count": 5,
      "param_hint": "671B"
    }
  ]
}
```

---

## Error Display

```
error: model not found: deepseek-r99

  Try the full model ID, e.g. deepseek-ai/DeepSeek-R1
  Or search: hfp deepseek
```

```
error: API rate limit exceeded

  Set $HF_TOKEN for higher limits
  Create token: huggingface.co/settings/tokens
```

Errors in muted red (131). Suggestions in dim gray.

---

## Design Principles

1. **No emoji** — Unicode symbols only (●, ○, ◐, ✓, ✗, ─, ✱)
2. **Muted palette** — Grays with occasional green/yellow/red accents
3. **No box drawing** — Simple `─` separators, space-aligned columns
4. **Lowercase headers** — `serverless providers` not `⚡ SERVERLESS INFERENCE`
5. **Density** — Every character earns its place
6. **Copy-paste friendly** — `hfp run` output is pure code, no decoration
7. **Progressive detail** — Search shows list, exact match shows full view
8. **Consistent spacing** — 2-space indent for all content under headers
9. **Quiet by default** — Hints are almost invisible, errors are muted
10. **Machine-readable** — `--json` always available, clean structure

## Visual Hierarchy

1. Model ID — bold (most prominent)
2. Provider table content — default color
3. Section headers — medium gray
4. Stats and metadata — dark gray  
5. Status indicators — muted color accents
6. Separators — very dark gray
7. Hints and suggestions — almost invisible
