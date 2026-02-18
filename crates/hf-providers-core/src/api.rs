use reqwest::Client;
use serde_json::Value;

use crate::error::{HfpError, Result};
use crate::model::Model;
use crate::provider::{ProviderInfo, ProviderStatus};

const HF_API: &str = "https://huggingface.co/api";

pub struct HfClient {
    http: Client,
    token: Option<String>,
}

impl HfClient {
    pub fn new(token: Option<String>) -> Self {
        Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("failed to build HTTP client"),
            token,
        }
    }

    /// Try to find token from env or `~/.cache/huggingface/token`.
    pub fn with_auto_token() -> Self {
        let token = std::env::var("HF_TOKEN")
            .or_else(|_| std::env::var("HUGGING_FACE_HUB_TOKEN"))
            .ok()
            .or_else(|| {
                let path = dirs::home_dir()?.join(".cache/huggingface/token");
                std::fs::read_to_string(path)
                    .ok()
                    .map(|s| s.trim().to_string())
            });
        Self::new(token)
    }

    fn auth_header(&self) -> Option<String> {
        self.token.as_ref().map(|t| format!("Bearer {t}"))
    }

    /// Get full model info with provider mapping.
    pub async fn model_info(&self, model_id: &str) -> Result<Value> {
        let url = format!(
            "{HF_API}/models/{model_id}?\
             expand[]=inferenceProviderMapping&expand[]=inference\
             &expand[]=tags&expand[]=cardData&expand[]=library_name\
             &expand[]=likes&expand[]=downloads&expand[]=pipeline_tag"
        );
        let mut req = self.http.get(&url);
        if let Some(auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }
        let resp = req.send().await?;
        let status = resp.status().as_u16();
        if status == 404 {
            return Err(HfpError::ModelNotFound(model_id.to_string()));
        }
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(HfpError::Api { status, body });
        }
        Ok(resp.json().await?)
    }

    /// Search models by query string.
    pub async fn search_models(&self, query: &str, limit: u32) -> Result<Vec<Value>> {
        let url = format!(
            "{HF_API}/models?search={}&limit={limit}\
             &expand[]=inferenceProviderMapping&sort=likes&direction=-1",
            urlencoding::encode(query),
        );
        let mut req = self.http.get(&url);
        if let Some(auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(HfpError::Api { status, body });
        }
        Ok(resp.json().await?)
    }

    /// Fetch top models by trending score (with provider data).
    pub async fn trending_models(&self, limit: u32) -> Result<Vec<Value>> {
        let url = format!(
            "{HF_API}/models?sort=trendingScore&direction=-1&limit={limit}\
             &expand[]=inferenceProviderMapping&expand[]=inference\
             &expand[]=likes&expand[]=downloads&expand[]=pipeline_tag\
             &expand[]=library_name&expand[]=tags"
        );
        let mut req = self.http.get(&url);
        if let Some(auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(HfpError::Api { status, body });
        }
        Ok(resp.json().await?)
    }

    /// List models served by a specific provider.
    pub async fn models_by_provider(
        &self,
        provider: &str,
        task: Option<&str>,
        limit: u32,
    ) -> Result<Vec<Value>> {
        let mut url = format!(
            "{HF_API}/models?inference_provider={provider}\
             &limit={limit}&sort=likes&direction=-1"
        );
        if let Some(t) = task {
            url.push_str(&format!("&pipeline_tag={t}"));
        }
        let mut req = self.http.get(&url);
        if let Some(auth) = self.auth_header() {
            req = req.header("Authorization", auth);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(HfpError::Api { status, body });
        }
        Ok(resp.json().await?)
    }
}

/// Parse raw HF API JSON into our [`Model`] type.
pub fn parse_model(data: &Value) -> Option<Model> {
    let id = data.get("id")?.as_str()?.to_string();
    let pipeline_tag = data
        .get("pipeline_tag")
        .and_then(|v| v.as_str())
        .map(String::from);
    let likes = data.get("likes").and_then(|v| v.as_u64()).unwrap_or(0);
    let downloads = data
        .get("downloads")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let inference_status = data
        .get("inference")
        .and_then(|v| v.as_str())
        .map(String::from);

    let mut providers = Vec::new();
    if let Some(ipm) = data.get("inferenceProviderMapping") {
        if let Some(arr) = ipm.as_array() {
            // Search endpoint: array of objects with "provider" field + full data
            for info in arr {
                let name = match info.get("provider").and_then(|v| v.as_str()) {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                let perf = info.get("performance");
                let details = info.get("providerDetails");
                let features = info.get("features");
                let pricing = details.and_then(|d| d.get("pricing"));

                providers.push(ProviderInfo {
                    name,
                    status: match info.get("status").and_then(|v| v.as_str()) {
                        Some("live") => ProviderStatus::Live,
                        Some("staging") => ProviderStatus::Staging,
                        _ => ProviderStatus::Unknown,
                    },
                    task: info
                        .get("task")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    provider_id: info
                        .get("providerId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    input_price_per_m: pricing
                        .and_then(|p| p.get("input"))
                        .and_then(|v| v.as_f64()),
                    output_price_per_m: pricing
                        .and_then(|p| p.get("output"))
                        .and_then(|v| v.as_f64()),
                    throughput_tps: perf
                        .and_then(|p| p.get("tokensPerSecond"))
                        .and_then(|v| v.as_f64()),
                    latency_s: perf
                        .and_then(|p| p.get("firstTokenLatencyMs"))
                        .and_then(|v| v.as_f64())
                        .map(|ms| ms / 1000.0),
                    context_window: details
                        .and_then(|d| d.get("context_length"))
                        .and_then(|v| v.as_u64()),
                    supports_tools: features
                        .and_then(|f| f.get("toolCalling"))
                        .and_then(|v| v.as_bool()),
                    supports_structured: features
                        .and_then(|f| f.get("structuredOutput"))
                        .and_then(|v| v.as_bool()),
                });
            }
        } else if let Some(obj) = ipm.as_object() {
            // Detail endpoint: object keyed by provider name (minimal data)
            for (name, info) in obj {
                providers.push(ProviderInfo {
                    name: name.clone(),
                    status: match info.get("status").and_then(|v| v.as_str()) {
                        Some("live") => ProviderStatus::Live,
                        Some("staging") => ProviderStatus::Staging,
                        _ => ProviderStatus::Unknown,
                    },
                    task: info
                        .get("task")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    provider_id: info
                        .get("providerId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    input_price_per_m: None,
                    output_price_per_m: None,
                    throughput_tps: None,
                    latency_s: None,
                    context_window: None,
                    supports_tools: None,
                    supports_structured: None,
                });
            }
        }
    }

    let tags: Vec<String> = data
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let library_name = data
        .get("library_name")
        .and_then(|v| v.as_str())
        .map(String::from);

    let license = data
        .get("cardData")
        .and_then(|v| v.get("license"))
        .and_then(|v| v.as_str())
        .map(String::from)
        .or_else(|| {
            tags.iter()
                .find(|t| t.starts_with("license:"))
                .map(|t| t.strip_prefix("license:").unwrap().to_string())
        });

    Some(Model {
        id,
        pipeline_tag,
        likes,
        downloads,
        inference_status,
        providers,
        variants: Vec::new(),
        tags,
        library_name,
        license,
    })
}
