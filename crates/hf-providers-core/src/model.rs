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

    /// Detect if a model is likely a Mixture-of-Experts architecture.
    /// Checks name patterns (8x7B, 17B-16E, "MoE") and known MoE families.
    /// Excludes distilled models (dense derivatives of MoE architectures).
    pub fn detect_moe(name: &str) -> bool {
        let lower = name.to_lowercase();
        // Distilled models are dense, not MoE
        if lower.contains("distill") {
            return false;
        }
        // Pattern: NxMB (Mixtral style, e.g. "8x7B", "8x22B")
        if lower.bytes().any(|b| b == b'x') {
            let mut i = 0;
            let bytes = lower.as_bytes();
            while i < bytes.len() {
                if bytes[i] == b'x' && i > 0 && bytes[i - 1].is_ascii_digit() {
                    // Check if followed by digits+B
                    let rest = &lower[i + 1..];
                    if rest.starts_with(|c: char| c.is_ascii_digit())
                        && rest.contains('b')
                    {
                        return true;
                    }
                }
                i += 1;
            }
        }
        // Pattern: NB-NE or NB_NE (Llama-4 style, e.g. "17B-16E", "17B-128E")
        if lower.contains('e') {
            let bytes = lower.as_bytes();
            for i in 0..bytes.len() {
                if (bytes[i] == b'-' || bytes[i] == b'_') && i > 0 && bytes[i - 1] == b'b' {
                    let rest = &lower[i + 1..];
                    let digit_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
                    if digit_end > 0 && rest[digit_end..].starts_with('e') {
                        let after_e = digit_end + 1;
                        if after_e >= rest.len()
                            || !rest.as_bytes()[after_e].is_ascii_alphanumeric()
                        {
                            return true;
                        }
                    }
                }
            }
        }
        // Literal "moe" in name
        if lower.contains("moe") {
            return true;
        }
        // Known MoE model families
        const MOE_FAMILIES: &[&str] = &[
            "mixtral", "dbrx", "grok-1", "jamba",
            "deepseek-v2", "deepseek-v3",
        ];
        for fam in MOE_FAMILIES {
            if lower.contains(fam) {
                return true;
            }
        }
        // DeepSeek-R1 special handling: the base R1 (671B) is MoE, but
        // derivatives like R1-0528-Qwen3-8B are dense. Match only when
        // "deepseek-r1" is followed by end-of-string, a slash, or an
        // optional date suffix (e.g. "-0528") and nothing else model-name-like.
        if lower.contains("deepseek-r1") {
            // Strip everything up to and including "deepseek-r1"
            let after = lower.split("deepseek-r1").last().unwrap_or("");
            // Strip optional date suffix like "-0528"
            let after = after.trim_start_matches(|c: char| c == '-' || c.is_ascii_digit());
            // If nothing meaningful remains, it's the base MoE model
            if after.is_empty() || after.starts_with('/') {
                return true;
            }
        }
        // "arctic" but not embedding models
        if lower.contains("arctic") && !lower.contains("arctic-embed") {
            return true;
        }
        false
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

    #[test]
    fn detect_moe_name_patterns() {
        // NxMB pattern (Mixtral style)
        assert!(Model::detect_moe("Mixtral-8x7B-Instruct-v0.1"));
        assert!(Model::detect_moe("Mixtral-8x22B-Instruct-v0.1"));
        // NB-NE pattern (Llama-4 style)
        assert!(Model::detect_moe("Llama-4-Scout-17B-16E-Instruct"));
        assert!(Model::detect_moe("Llama-4-Maverick-17B-128E-Instruct"));
        // Literal "MoE"
        assert!(Model::detect_moe("Qwen2-MoE-57B"));
        // Known families
        assert!(Model::detect_moe("deepseek-ai/DeepSeek-V3"));
        assert!(Model::detect_moe("deepseek-ai/DeepSeek-R1"));
        assert!(Model::detect_moe("databricks/dbrx-instruct"));
        assert!(Model::detect_moe("Snowflake/snowflake-arctic-instruct"));
        assert!(Model::detect_moe("ai21labs/Jamba-v0.1"));
    }

    #[test]
    fn detect_moe_false_for_dense() {
        assert!(!Model::detect_moe("Llama-3.1-70B-Instruct"));
        assert!(!Model::detect_moe("Qwen2.5-72B"));
        assert!(!Model::detect_moe("gemma-3-27b-it"));
        assert!(!Model::detect_moe("gpt2"));
        assert!(!Model::detect_moe("Phi-4-mini-instruct"));
    }

    #[test]
    fn detect_moe_false_for_distilled() {
        // Distilled models are dense, not MoE
        assert!(!Model::detect_moe("deepseek-ai/DeepSeek-R1-Distill-Qwen-32B"));
        assert!(!Model::detect_moe("deepseek-ai/DeepSeek-R1-Distill-Llama-8B"));
        assert!(!Model::detect_moe("deepseek-ai/DeepSeek-R1-Distill-Llama-70B"));
        assert!(!Model::detect_moe("cyberagent/DeepSeek-R1-Distill-Qwen-32B-Japanese"));
        assert!(!Model::detect_moe("unsloth/DeepSeek-R1-Distill-Llama-8B"));
    }

    #[test]
    fn detect_moe_false_for_r1_derivatives() {
        // R1 derivatives with a base model name are dense
        assert!(!Model::detect_moe("deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"));
    }

    #[test]
    fn detect_moe_true_for_r1_base() {
        // The base R1 models are MoE
        assert!(Model::detect_moe("deepseek-ai/DeepSeek-R1"));
        assert!(Model::detect_moe("deepseek-ai/DeepSeek-R1-0528"));
    }

    #[test]
    fn detect_moe_false_for_arctic_embed() {
        // Arctic embedding models are not MoE
        assert!(!Model::detect_moe("Snowflake/snowflake-arctic-embed-l-v2.0"));
        assert!(!Model::detect_moe("Snowflake/snowflake-arctic-embed-m"));
        assert!(!Model::detect_moe("Snowflake/snowflake-arctic-embed-l"));
        // But arctic instruct is MoE
        assert!(Model::detect_moe("Snowflake/snowflake-arctic-instruct"));
    }
}
