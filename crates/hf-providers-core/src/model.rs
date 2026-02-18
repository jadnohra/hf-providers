use serde::{Deserialize, Serialize};

use crate::provider::{ProviderInfo, Readiness};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub pipeline_tag: Option<String>,
    pub likes: u64,
    pub downloads: u64,
    pub inference_status: Option<String>,
    pub providers: Vec<ProviderInfo>,
    pub variants: Vec<ModelVariant>,
    pub tags: Vec<String>,
    pub library_name: Option<String>,
    pub license: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelVariant {
    pub id: String,
    pub pipeline_tag: Option<String>,
    pub likes: u64,
    pub provider_count: usize,
    pub param_hint: Option<String>,
}

impl Model {
    pub fn cheapest(&self) -> Option<&ProviderInfo> {
        self.providers
            .iter()
            .filter(|p| p.output_price_per_m.is_some())
            .min_by(|a, b| {
                a.output_price_per_m
                    .unwrap()
                    .partial_cmp(&b.output_price_per_m.unwrap())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    pub fn fastest(&self) -> Option<&ProviderInfo> {
        self.providers
            .iter()
            .filter(|p| p.throughput_tps.is_some())
            .max_by(|a, b| {
                a.throughput_tps
                    .unwrap()
                    .partial_cmp(&b.throughput_tps.unwrap())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    pub fn hot_providers(&self) -> Vec<&ProviderInfo> {
        self.providers
            .iter()
            .filter(|p| p.readiness() == Readiness::Hot)
            .collect()
    }

    pub fn with_tools(&self) -> Vec<&ProviderInfo> {
        self.providers
            .iter()
            .filter(|p| p.supports_tools == Some(true))
            .collect()
    }

    /// Extract a likely param size from model name, e.g. "70B", "1.5B".
    pub fn param_hint(name: &str) -> Option<String> {
        const SIZES: &[&str] = &[
            "671B", "405B", "236B", "135B", "120B", "109B", "80B", "72B",
            "70B", "32B", "30B", "27B", "22B", "20B", "14B", "13B", "12B",
            "9B", "8B", "7B", "4B", "3B", "2B", "1.5B", "1.3B", "1B", "0.3B",
        ];
        let upper = name.to_uppercase();
        SIZES
            .iter()
            .find(|s| upper.contains(&s.to_uppercase()))
            .map(|s| (*s).to_string())
    }
}
