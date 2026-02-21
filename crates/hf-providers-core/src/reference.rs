/// Curated reference models for the `machine` subcommand.
/// These span a range of sizes to show what a GPU can and can't run.
pub struct RefModel {
    pub id: &'static str,
    pub short: &'static str,
    pub params: u64,
}

pub const REFERENCE_MODELS: &[RefModel] = &[
    // Small (<10B)
    RefModel {
        id: "google/gemma-3-4b-it",
        short: "Gemma 3 4B",
        params: 4_000_000_000,
    },
    RefModel {
        id: "Qwen/Qwen2.5-7B-Instruct",
        short: "Qwen 2.5 7B",
        params: 7_600_000_000,
    },
    RefModel {
        id: "meta-llama/Llama-3.1-8B-Instruct",
        short: "Llama 3.1 8B",
        params: 8_030_000_000,
    },
    // Medium (10-35B)
    RefModel {
        id: "mistralai/Mistral-Small-24B-Instruct-2501",
        short: "Mistral Small 24B",
        params: 24_000_000_000,
    },
    RefModel {
        id: "google/gemma-3-27b-it",
        short: "Gemma 3 27B",
        params: 27_400_000_000,
    },
    RefModel {
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        short: "Qwen 2.5 Coder 32B",
        params: 32_500_000_000,
    },
    // Large (35-80B)
    RefModel {
        id: "meta-llama/Llama-3.3-70B-Instruct",
        short: "Llama 3.3 70B",
        params: 70_600_000_000,
    },
    RefModel {
        id: "Qwen/Qwen2.5-72B-Instruct",
        short: "Qwen 2.5 72B",
        params: 72_700_000_000,
    },
    // Huge (80B+)
    RefModel {
        id: "meta-llama/Llama-3.1-405B-Instruct",
        short: "Llama 3.1 405B",
        params: 405_000_000_000,
    },
    RefModel {
        id: "deepseek-ai/DeepSeek-R1",
        short: "DeepSeek R1 671B",
        params: 671_000_000_000,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_models_sorted_by_size() {
        for w in REFERENCE_MODELS.windows(2) {
            assert!(
                w[0].params <= w[1].params,
                "{} ({}) should come before {} ({})",
                w[0].short,
                w[0].params,
                w[1].short,
                w[1].params,
            );
        }
    }

    #[test]
    fn reference_models_have_valid_fields() {
        for m in REFERENCE_MODELS {
            assert!(!m.id.is_empty(), "id must not be empty");
            assert!(!m.short.is_empty(), "short must not be empty");
            assert!(m.id.contains('/'), "id should be org/name: {}", m.id);
            assert!(m.params >= 1_000_000_000, "{}: params too small", m.short);
        }
    }
}
