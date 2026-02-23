// Port of parse_model() from Rust api.rs to JS.
// Parses raw HF API JSON into our model shape.

export function parseModel(data) {
  if (!data || !data.id) return null;

  const providers = [];
  const ipm = data.inferenceProviderMapping;

  if (Array.isArray(ipm)) {
    // Search endpoint: array of objects with "provider" field + full data
    for (const info of ipm) {
      const name = info.provider;
      if (!name) continue;
      const perf = info.performance || {};
      const details = info.providerDetails || {};
      const features = info.features || {};
      const pricing = details.pricing || {};

      providers.push({
        name,
        status: info.status || 'unknown',
        task: info.task || '',
        providerId: info.providerId || '',
        inputPrice: pricing.input ?? null,
        outputPrice: pricing.output ?? null,
        throughput: perf.tokensPerSecond ?? null,
        latency: perf.firstTokenLatencyMs ? perf.firstTokenLatencyMs / 1000 : null,
        contextWindow: details.context_length ?? null,
        supportsTools: features.toolCalling ?? null,
        supportsStructured: features.structuredOutput ?? null,
      });
    }
  } else if (ipm && typeof ipm === 'object') {
    // Detail endpoint: object keyed by provider name (minimal data)
    for (const [name, info] of Object.entries(ipm)) {
      providers.push({
        name,
        status: info.status || 'unknown',
        task: info.task || '',
        providerId: info.providerId || '',
        inputPrice: null,
        outputPrice: null,
        throughput: null,
        latency: null,
        contextWindow: null,
        supportsTools: null,
        supportsStructured: null,
      });
    }
  }

  const tags = Array.isArray(data.tags) ? data.tags : [];
  let license = null;
  if (data.cardData && data.cardData.license) {
    license = data.cardData.license;
  } else {
    const licTag = tags.find(t => t.startsWith('license:'));
    if (licTag) license = licTag.slice('license:'.length);
  }

  const safetensorsParams = data.safetensors?.total ?? null;

  return {
    id: data.id,
    pipelineTag: data.pipeline_tag || null,
    likes: data.likes || 0,
    downloads: data.downloads || 0,
    inferenceStatus: data.inference || null,
    providers,
    tags,
    libraryName: data.library_name || null,
    license,
    safetensorsParams,
  };
}

export function readiness(provider) {
  if (provider.status !== 'live') return 'unavailable';
  if (provider.latency != null && provider.throughput != null) return 'hot';
  if (provider.latency != null || provider.throughput != null) return 'warm';
  return 'cold';
}
