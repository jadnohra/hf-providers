use hf_providers_core::model::Model;
use hf_providers_core::provider::{ProviderInfo, ProviderStatus};
use hf_providers_core::snippet::{generate, Lang};

fn test_model() -> (Model, ProviderInfo) {
    let prov = ProviderInfo {
        name: "together".to_string(),
        status: ProviderStatus::Live,
        task: "conversational".to_string(),
        provider_id: "deepseek-ai/DeepSeek-R1".to_string(),
        input_price_per_m: Some(3.0),
        output_price_per_m: Some(7.0),
        throughput_tps: Some(36.0),
        latency_s: Some(0.5),
        context_window: Some(32000),
        supports_tools: Some(false),
        supports_structured: Some(true),
    };
    let model = Model {
        id: "deepseek-ai/DeepSeek-R1".to_string(),
        pipeline_tag: Some("text-generation".to_string()),
        likes: 5000,
        downloads: 100000,
        inference_status: None,
        providers: vec![prov.clone()],
        variants: Vec::new(),
        tags: Vec::new(),
        library_name: None,
        license: None,
    };
    let prov = model.providers[0].clone();
    (model, prov)
}

#[test]
fn python_snippet_contains_model_and_provider() {
    let (model, prov) = test_model();
    let code = generate(&model, &prov, Lang::Python);
    assert!(code.contains("deepseek-ai/DeepSeek-R1"), "must contain model id");
    assert!(code.contains("together"), "must contain provider name");
    assert!(code.contains("InferenceClient"), "must use HF client");
}

#[test]
fn curl_snippet_contains_model_and_auth() {
    let (model, prov) = test_model();
    let code = generate(&model, &prov, Lang::Curl);
    assert!(code.contains("deepseek-ai/DeepSeek-R1"), "must contain model id");
    assert!(code.contains("together"), "must contain provider name");
    assert!(code.contains("$HF_TOKEN"), "must reference token");
    assert!(code.contains("router.huggingface.co"), "must use HF router");
}

#[test]
fn javascript_snippet_contains_model_and_provider() {
    let (model, prov) = test_model();
    let code = generate(&model, &prov, Lang::Javascript);
    assert!(code.contains("deepseek-ai/DeepSeek-R1"), "must contain model id");
    assert!(code.contains("together"), "must contain provider name");
    assert!(code.contains("@huggingface/inference"), "must import HF package");
}
