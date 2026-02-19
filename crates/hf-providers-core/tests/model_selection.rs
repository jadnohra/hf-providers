use hf_providers_core::model::Model;
use hf_providers_core::provider::{ProviderInfo, ProviderStatus};

fn make_provider(name: &str, output_price: Option<f64>, throughput: Option<f64>) -> ProviderInfo {
    ProviderInfo {
        name: name.to_string(),
        status: ProviderStatus::Live,
        task: "conversational".to_string(),
        provider_id: name.to_string(),
        input_price_per_m: output_price.map(|p| p * 0.5), // arbitrary
        output_price_per_m: output_price,
        throughput_tps: throughput,
        latency_s: throughput.map(|_| 0.5),
        context_window: Some(8192),
        supports_tools: Some(false),
        supports_structured: Some(false),
    }
}

fn make_model(providers: Vec<ProviderInfo>) -> Model {
    Model {
        id: "test/model".to_string(),
        pipeline_tag: Some("text-generation".to_string()),
        likes: 100,
        downloads: 1000,
        inference_status: None,
        providers,
        variants: Vec::new(),
        tags: Vec::new(),
        library_name: None,
        license: None,
        safetensors_params: None,
    }
}

#[test]
fn cheapest_picks_lowest_output_price() {
    let model = make_model(vec![
        make_provider("expensive", Some(10.0), Some(50.0)),
        make_provider("cheap", Some(1.0), Some(20.0)),
        make_provider("mid", Some(5.0), Some(100.0)),
    ]);
    let c = model.cheapest().expect("should find cheapest");
    assert_eq!(c.name, "cheap");
}

#[test]
fn cheapest_skips_providers_without_price() {
    let model = make_model(vec![
        make_provider("no-price", None, Some(200.0)),
        make_provider("has-price", Some(3.0), Some(10.0)),
    ]);
    let c = model.cheapest().expect("should find cheapest");
    assert_eq!(c.name, "has-price");
}

#[test]
fn cheapest_returns_none_when_no_prices() {
    let model = make_model(vec![
        make_provider("a", None, Some(50.0)),
        make_provider("b", None, Some(100.0)),
    ]);
    assert!(model.cheapest().is_none());
}

#[test]
fn fastest_picks_highest_throughput() {
    let model = make_model(vec![
        make_provider("slow", Some(1.0), Some(20.0)),
        make_provider("fast", Some(5.0), Some(200.0)),
        make_provider("mid", Some(3.0), Some(80.0)),
    ]);
    let f = model.fastest().expect("should find fastest");
    assert_eq!(f.name, "fast");
}

#[test]
fn fastest_returns_none_when_no_throughput() {
    let model = make_model(vec![
        make_provider("a", Some(1.0), None),
        make_provider("b", Some(2.0), None),
    ]);
    assert!(model.fastest().is_none());
}

#[test]
fn empty_providers() {
    let model = make_model(vec![]);
    assert!(model.cheapest().is_none());
    assert!(model.fastest().is_none());
    assert!(model.hot_providers().is_empty());
    assert!(model.with_tools().is_empty());
}

#[test]
fn param_hint_extracts_size() {
    assert_eq!(Model::param_hint("Meta-Llama-3-70B-Instruct"), Some("70B".to_string()));
    assert_eq!(Model::param_hint("Qwen-1.5B"), Some("1.5B".to_string()));
    assert_eq!(Model::param_hint("DeepSeek-R1"), None);
    assert_eq!(Model::param_hint("mixtral-8x7b"), Some("7B".to_string()));
}

#[test]
fn parse_param_hint_values() {
    assert_eq!(Model::parse_param_hint("70B"), Some(70_000_000_000));
    assert_eq!(Model::parse_param_hint("1.5B"), Some(1_500_000_000));
    assert_eq!(Model::parse_param_hint("8B"), Some(8_000_000_000));
    assert_eq!(Model::parse_param_hint("671B"), Some(671_000_000_000));
    assert_eq!(Model::parse_param_hint("0.3B"), Some(300_000_000));
    assert!(Model::parse_param_hint("").is_none());
    assert!(Model::parse_param_hint("xyz").is_none());
}

#[test]
fn estimated_params_prefers_safetensors() {
    let mut model = make_model(vec![]);
    model.id = "meta-llama/Llama-3.3-70B-Instruct".to_string();
    model.safetensors_params = Some(70_600_000_000);
    // Should use safetensors, not the hint
    assert_eq!(model.estimated_params(), Some(70_600_000_000));
}

#[test]
fn estimated_params_falls_back_to_hint() {
    let mut model = make_model(vec![]);
    model.id = "meta-llama/Llama-3.3-70B-Instruct".to_string();
    model.safetensors_params = None;
    // Should fall back to parsing "70B" from the name
    assert_eq!(model.estimated_params(), Some(70_000_000_000));
}

#[test]
fn estimated_params_none_when_no_hint() {
    let mut model = make_model(vec![]);
    model.id = "deepseek-ai/DeepSeek-R1".to_string();
    model.safetensors_params = None;
    // "DeepSeek-R1" has no param hint
    assert!(model.estimated_params().is_none());
}
