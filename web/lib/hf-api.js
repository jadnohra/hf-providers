// HF API client (browser fetch-based, no auth needed for public data).

const HF_API = 'https://huggingface.co/api';

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HF API ${resp.status}: ${resp.statusText}`);
  return resp.json();
}

export async function modelInfo(id) {
  // Don't encodeURIComponent the whole ID -- the slash is part of the path.
  const url = `${HF_API}/models/${id}?` +
    'expand[]=inferenceProviderMapping&expand[]=inference' +
    '&expand[]=tags&expand[]=cardData&expand[]=library_name' +
    '&expand[]=likes&expand[]=downloads&expand[]=pipeline_tag' +
    '&expand[]=safetensors';
  return fetchJson(url);
}

export async function searchModels(query, limit = 10) {
  const url = `${HF_API}/models?search=${encodeURIComponent(query)}&limit=${limit}` +
    '&expand[]=inferenceProviderMapping&expand[]=safetensors' +
    '&expand[]=likes&expand[]=downloads&expand[]=pipeline_tag' +
    '&sort=likes&direction=-1';
  return fetchJson(url);
}

export async function trendingModels(limit = 50) {
  const url = `${HF_API}/models?sort=trendingScore&direction=-1&limit=${limit}` +
    '&expand[]=inferenceProviderMapping&expand[]=inference' +
    '&expand[]=likes&expand[]=downloads&expand[]=pipeline_tag' +
    '&expand[]=library_name&expand[]=tags&expand[]=safetensors';
  return fetchJson(url);
}

export async function modelsByProvider(provider, limit = 200) {
  const url = `${HF_API}/models?inference_provider=${encodeURIComponent(provider)}` +
    `&limit=${limit}&sort=likes&direction=-1` +
    '&expand[]=inferenceProviderMapping&expand[]=safetensors' +
    '&expand[]=likes&expand[]=downloads&expand[]=pipeline_tag';
  return fetchJson(url);
}
