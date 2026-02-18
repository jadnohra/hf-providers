use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderStatus {
    Live,
    Staging,
    #[serde(other)]
    Unknown,
}

/// What we know about a single provider serving a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub name: String,
    pub status: ProviderStatus,
    pub task: String,
    pub provider_id: String,
    pub input_price_per_m: Option<f64>,
    pub output_price_per_m: Option<f64>,
    pub throughput_tps: Option<f64>,
    pub latency_s: Option<f64>,
    pub context_window: Option<u64>,
    pub supports_tools: Option<bool>,
    pub supports_structured: Option<bool>,
}

impl ProviderInfo {
    /// Inferred readiness from available data.
    pub fn readiness(&self) -> Readiness {
        match self.status {
            ProviderStatus::Staging | ProviderStatus::Unknown => Readiness::Unavailable,
            ProviderStatus::Live => {
                if self.latency_s.is_some() && self.throughput_tps.is_some() {
                    Readiness::Hot
                } else if self.latency_s.is_some() || self.throughput_tps.is_some() {
                    Readiness::Warm
                } else {
                    Readiness::Cold
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Readiness {
    Hot,
    Warm,
    Cold,
    Unavailable,
}

impl std::fmt::Display for Readiness {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Hot => write!(f, "● hot"),
            Self::Warm => write!(f, "◐ warm"),
            Self::Cold => write!(f, "○ cold"),
            Self::Unavailable => write!(f, "✗ unavail"),
        }
    }
}

/// Static provider registry entry.
#[derive(Debug, Clone)]
pub struct Provider {
    pub id: &'static str,
    pub display_name: &'static str,
    pub kind: ProviderKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderKind {
    /// Third-party GPU backend routed through HF.
    InferenceProvider,
    /// HF's own CPU-based inference.
    HfInference,
}

pub const PROVIDERS: &[Provider] = &[
    Provider { id: "cerebras",       display_name: "Cerebras",     kind: ProviderKind::InferenceProvider },
    Provider { id: "cohere",         display_name: "Cohere",       kind: ProviderKind::InferenceProvider },
    Provider { id: "fal-ai",         display_name: "fal",          kind: ProviderKind::InferenceProvider },
    Provider { id: "featherless-ai", display_name: "Featherless",  kind: ProviderKind::InferenceProvider },
    Provider { id: "fireworks-ai",   display_name: "Fireworks",    kind: ProviderKind::InferenceProvider },
    Provider { id: "groq",           display_name: "Groq",         kind: ProviderKind::InferenceProvider },
    Provider { id: "hyperbolic",     display_name: "Hyperbolic",   kind: ProviderKind::InferenceProvider },
    Provider { id: "nebius",         display_name: "Nebius",       kind: ProviderKind::InferenceProvider },
    Provider { id: "novita",         display_name: "Novita",       kind: ProviderKind::InferenceProvider },
    Provider { id: "nscale",         display_name: "Nscale",       kind: ProviderKind::InferenceProvider },
    Provider { id: "ovhcloud",       display_name: "OVHcloud",     kind: ProviderKind::InferenceProvider },
    Provider { id: "publicai",       display_name: "Public AI",    kind: ProviderKind::InferenceProvider },
    Provider { id: "replicate",      display_name: "Replicate",    kind: ProviderKind::InferenceProvider },
    Provider { id: "sambanova",      display_name: "SambaNova",    kind: ProviderKind::InferenceProvider },
    Provider { id: "scaleway",       display_name: "Scaleway",     kind: ProviderKind::InferenceProvider },
    Provider { id: "together",       display_name: "Together AI",  kind: ProviderKind::InferenceProvider },
    Provider { id: "wavespeed",      display_name: "WaveSpeed",    kind: ProviderKind::InferenceProvider },
    Provider { id: "zai-org",        display_name: "Z.ai",         kind: ProviderKind::InferenceProvider },
    Provider { id: "hf-inference",   display_name: "HF Inference", kind: ProviderKind::HfInference },
];
