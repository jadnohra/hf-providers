use hf_providers_core::api::parse_model;
use serde_json::json;

#[test]
fn parse_minimal_model() {
    let data = json!({"id": "org/my-model"});
    let model = parse_model(&data).expect("should parse minimal model");
    assert_eq!(model.id, "org/my-model");
    assert!(model.providers.is_empty());
    assert_eq!(model.likes, 0);
    assert_eq!(model.downloads, 0);
    assert!(model.pipeline_tag.is_none());
}

#[test]
fn parse_missing_id_returns_none() {
    let data = json!({"likes": 100});
    assert!(parse_model(&data).is_none());
}

#[test]
fn parse_providers_from_array() {
    let data = json!({
        "id": "deepseek-ai/DeepSeek-R1",
        "pipeline_tag": "text-generation",
        "likes": 5000,
        "downloads": 100000,
        "inferenceProviderMapping": [
            {
                "provider": "novita",
                "providerId": "deepseek/deepseek-r1-turbo",
                "status": "live",
                "task": "conversational",
                "features": {"toolCalling": true, "structuredOutput": false},
                "performance": {
                    "tokensPerSecond": 26.3,
                    "firstTokenLatencyMs": 1278.4
                },
                "providerDetails": {
                    "context_length": 64000,
                    "pricing": {"input": 0.7, "output": 2.5}
                }
            },
            {
                "provider": "sambanova",
                "providerId": "DeepSeek-R1",
                "status": "live",
                "task": "conversational",
                "features": {"toolCalling": true, "structuredOutput": true},
                "performance": {
                    "tokensPerSecond": 205.0,
                    "firstTokenLatencyMs": 538.0
                }
            },
            {
                "provider": "broken-entry-no-provider-field",
                "status": "staging",
                "task": "conversational"
            }
        ]
    });

    let model = parse_model(&data).expect("should parse");
    assert_eq!(model.id, "deepseek-ai/DeepSeek-R1");
    assert_eq!(model.pipeline_tag.as_deref(), Some("text-generation"));
    assert_eq!(model.likes, 5000);

    // The third entry has "provider" field set, so it parses too
    assert_eq!(model.providers.len(), 3);

    let novita = &model.providers[0];
    assert_eq!(novita.name, "novita");
    assert_eq!(novita.provider_id, "deepseek/deepseek-r1-turbo");
    assert_eq!(novita.status, hf_providers_core::ProviderStatus::Live);
    assert_eq!(novita.input_price_per_m, Some(0.7));
    assert_eq!(novita.output_price_per_m, Some(2.5));
    assert!((novita.throughput_tps.unwrap() - 26.3).abs() < 0.1);
    assert!((novita.latency_s.unwrap() - 1.2784).abs() < 0.01);
    assert_eq!(novita.context_window, Some(64000));
    assert_eq!(novita.supports_tools, Some(true));
    assert_eq!(novita.supports_structured, Some(false));

    let samba = &model.providers[1];
    assert_eq!(samba.name, "sambanova");
    assert!(samba.input_price_per_m.is_none()); // no pricing block
    assert!((samba.throughput_tps.unwrap() - 205.0).abs() < 0.1);
}

#[test]
fn parse_empty_provider_array() {
    let data = json!({
        "id": "org/model",
        "inferenceProviderMapping": []
    });
    let model = parse_model(&data).expect("should parse");
    assert!(model.providers.is_empty());
}

#[test]
fn parse_providers_from_object() {
    // Detail endpoint returns inferenceProviderMapping as an object keyed by provider name.
    let data = json!({
        "id": "meta-llama/Llama-3.3-70B-Instruct",
        "pipeline_tag": "text-generation",
        "inferenceProviderMapping": {
            "groq": {
                "status": "live",
                "providerId": "llama-3.3-70b-versatile",
                "task": "conversational"
            },
            "sambanova": {
                "status": "live",
                "providerId": "Meta-Llama-3.3-70B-Instruct",
                "task": "conversational"
            },
            "fireworks-ai": {
                "status": "staging",
                "providerId": "accounts/fireworks/models/llama-v3p3-70b-instruct",
                "task": "conversational"
            }
        }
    });

    let model = parse_model(&data).expect("should parse");
    assert_eq!(model.providers.len(), 3);

    let groq = model.providers.iter().find(|p| p.name == "groq").unwrap();
    assert_eq!(groq.status, hf_providers_core::ProviderStatus::Live);
    assert_eq!(groq.provider_id, "llama-3.3-70b-versatile");
    // Object format has no pricing/perf data
    assert!(groq.input_price_per_m.is_none());
    assert!(groq.throughput_tps.is_none());
    assert!(groq.supports_tools.is_none());

    let fireworks = model.providers.iter().find(|p| p.name == "fireworks-ai").unwrap();
    assert_eq!(fireworks.status, hf_providers_core::ProviderStatus::Staging);
}

#[test]
fn parse_provider_entry_missing_provider_field_skipped() {
    let data = json!({
        "id": "org/model",
        "inferenceProviderMapping": [
            {"status": "live", "task": "conversational"}
        ]
    });
    let model = parse_model(&data).expect("should parse");
    assert!(model.providers.is_empty(), "entry without 'provider' field should be skipped");
}
