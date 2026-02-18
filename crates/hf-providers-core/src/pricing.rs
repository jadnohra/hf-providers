// Pricing data enrichment.
//
// TODO(v0.2): Fetch and parse pricing from the HF inference models page.
// The page returns structured data including per-model-per-provider:
//   - input_price, output_price ($/1M tokens)
//   - latency_s (time to first token)
//   - throughput_tps (tokens per second)
//   - context_window
//   - supports_tools, supports_structured_output
