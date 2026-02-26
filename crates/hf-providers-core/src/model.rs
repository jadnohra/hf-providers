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
    pub safetensors_params: Option<u64>,
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

    /// Format a raw parameter count as "70.6B", "8.0B", "671M", etc.
    pub fn fmt_params(n: u64) -> String {
        let f = n as f64;
        if f >= 1e9 {
            let b = f / 1e9;
            if b >= 100.0 {
                format!("{:.0}B", b)
            } else {
                format!("{:.1}B", b)
            }
        } else if f >= 1e6 {
            format!("{:.0}M", f / 1e6)
        } else {
            format!("{:.0}K", f / 1e3)
        }
    }

    /// Weight size in GB for a given bytes-per-param ratio.
    /// Common ratios: FP16 = 2.0, Q8 = 1.0, Q4 = 0.5
    pub fn weight_gb(params: u64, bytes_per_param: f64) -> f64 {
        params as f64 * bytes_per_param / 1e9
    }

    /// Parse a param hint string like "70B" or "1.5B" into a raw param count.
    pub fn parse_param_hint(hint: &str) -> Option<u64> {
        let hint = hint.trim().to_uppercase();
        if let Some(b) = hint.strip_suffix('B') {
            let val: f64 = b.parse().ok()?;
            Some((val * 1e9) as u64)
        } else if let Some(m) = hint.strip_suffix('M') {
            let val: f64 = m.parse().ok()?;
            Some((val * 1e6) as u64)
        } else {
            None
        }
    }

    /// Get estimated param count: prefer safetensors, fall back to name hint.
    pub fn estimated_params(&self) -> Option<u64> {
        self.safetensors_params.or_else(|| {
            Self::param_hint(&self.id).and_then(|h| Self::parse_param_hint(&h))
        })
    }

    /// Extract a likely param size from model name, e.g. "70B", "1.5B".
    /// Uses boundary matching to avoid "7B" matching inside "17B".
    pub fn param_hint(name: &str) -> Option<String> {
        const SIZES: &[&str] = &[
            "671B", "405B", "236B", "135B", "120B", "109B", "80B", "72B",
            "70B", "32B", "30B", "27B", "22B", "20B", "17B", "14B", "13B",
            "12B", "9B", "8B", "7B", "4B", "3B", "2B", "1.5B", "1.3B",
            "1B", "0.3B",
        ];
        let upper = name.to_uppercase();
        SIZES.iter().find(|s| {
            let s_upper = s.to_uppercase();
            if let Some(pos) = upper.find(&s_upper) {
                // Check that the char before the match is not a digit (word boundary)
                let before_ok = pos == 0
                    || !upper.as_bytes()[pos - 1].is_ascii_digit();
                // Check that the char after is not alphanumeric (already ends with B)
                let end = pos + s_upper.len();
                let after_ok = end >= upper.len()
                    || !upper.as_bytes()[end].is_ascii_alphanumeric();
                before_ok && after_ok
            } else {
                false
            }
        }).map(|s| (*s).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn param_hint_basic() {
        assert_eq!(Model::param_hint("Llama-3.1-70B-Instruct"), Some("70B".into()));
        assert_eq!(Model::param_hint("Qwen2.5-1.5B"), Some("1.5B".into()));
        assert_eq!(Model::param_hint("some-model-8B"), Some("8B".into()));
    }

    #[test]
    fn param_hint_no_false_substring() {
        // "17B" should not match "7B"
        assert_eq!(Model::param_hint("Llama-4-Scout-17B-16E-Instruct"), Some("17B".into()));
        // "13B" should not match "1.3B" or "3B"
        assert_eq!(Model::param_hint("model-13B-chat"), Some("13B".into()));
        // "120B" should not match "12B" or "20B"
        assert_eq!(Model::param_hint("big-model-120B"), Some("120B".into()));
    }

    #[test]
    fn param_hint_none_for_no_match() {
        assert_eq!(Model::param_hint("gpt2"), None);
        assert_eq!(Model::param_hint("clip-vit"), None);
    }
}
