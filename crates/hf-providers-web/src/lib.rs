use wasm_bindgen::prelude::*;

use hf_providers_core::estimate;
use hf_providers_core::hardware::{self, GpuSpec, Runtime};
use hf_providers_core::model::Model;
use hf_providers_core::reference::REFERENCE_MODELS;
use hf_providers_core::snippet;

// ---------------------------------------------------------------------------
// GPU lookup
// ---------------------------------------------------------------------------

/// Find a GPU from the hardware array by fuzzy input string.
/// Returns [key, GpuSpec] or null.
#[wasm_bindgen]
pub fn find_gpu(gpus: JsValue, input: &str) -> JsValue {
    let gpus: Vec<(String, GpuSpec)> = match serde_wasm_bindgen::from_value(gpus) {
        Ok(g) => g,
        Err(_) => return JsValue::NULL,
    };
    match hardware::find_gpu(&gpus, input) {
        Some((key, spec)) => {
            serde_wasm_bindgen::to_value(&(key, spec)).unwrap_or(JsValue::NULL)
        }
        None => JsValue::NULL,
    }
}

// ---------------------------------------------------------------------------
// Performance estimation
// ---------------------------------------------------------------------------

fn parse_runtime(s: &str) -> Option<Runtime> {
    match s {
        "llama.cpp" | "llamacpp" => Some(Runtime::LlamaCpp),
        "mlx" => Some(Runtime::Mlx),
        _ => None,
    }
}

fn parse_quant(s: &str) -> Option<estimate::Quant> {
    match s.to_uppercase().as_str() {
        "Q4" => Some(estimate::Quant::Q4),
        "Q8" => Some(estimate::Quant::Q8),
        "FP16" => Some(estimate::Quant::FP16),
        _ => None,
    }
}

/// Estimate performance for a GPU + model + quant + runtime.
/// params is f64 to avoid BigInt on the JS side.
#[wasm_bindgen]
pub fn estimate_perf(gpu: JsValue, params: f64, quant: &str, runtime: &str) -> JsValue {
    let gpu: GpuSpec = match serde_wasm_bindgen::from_value(gpu) {
        Ok(g) => g,
        Err(_) => return JsValue::NULL,
    };
    let q = match parse_quant(quant) {
        Some(q) => q,
        None => return JsValue::NULL,
    };
    let rt = match parse_runtime(runtime) {
        Some(r) => r,
        None => return JsValue::NULL,
    };
    let est = estimate::estimate(&gpu, params as u64, q, rt);
    serde_wasm_bindgen::to_value(&est).unwrap_or(JsValue::NULL)
}

/// Pick the best quantization that fits this GPU for a model of `params` parameters.
/// Returns [quant_label, Estimate] or null.
#[wasm_bindgen]
pub fn best_quant(gpu: JsValue, params: f64, runtime: &str) -> JsValue {
    let gpu: GpuSpec = match serde_wasm_bindgen::from_value(gpu) {
        Ok(g) => g,
        Err(_) => return JsValue::NULL,
    };
    let rt = match parse_runtime(runtime) {
        Some(r) => r,
        None => return JsValue::NULL,
    };
    match estimate::best_quant(&gpu, params as u64, rt) {
        Some((q, est)) => {
            serde_wasm_bindgen::to_value(&(q.label(), est)).unwrap_or(JsValue::NULL)
        }
        None => JsValue::NULL,
    }
}

// ---------------------------------------------------------------------------
// Machine report (reference models on a given GPU)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct MachineResult {
    short: &'static str,
    params: f64,
    id: &'static str,
    results: Vec<RuntimeResult>,
}

#[derive(serde::Serialize)]
struct RuntimeResult {
    runtime: String,
    quant: Option<String>,
    decode: Option<f64>,
    prefill: Option<f64>,
    fits: bool,
    weight_gb: f64,
}

/// Generate a machine report: for each reference model, estimate performance
/// across all runtimes available on this GPU.
#[wasm_bindgen]
pub fn machine_report(gpu: JsValue) -> JsValue {
    let gpu: GpuSpec = match serde_wasm_bindgen::from_value(gpu) {
        Ok(g) => g,
        Err(_) => return JsValue::NULL,
    };
    let runtimes = gpu.available_runtimes();
    let mut results: Vec<MachineResult> = Vec::new();

    for rm in REFERENCE_MODELS {
        let mut rt_results = Vec::new();
        for &rt in &runtimes {
            match estimate::best_quant(&gpu, rm.params, rt) {
                Some((q, est)) => {
                    rt_results.push(RuntimeResult {
                        runtime: rt.to_string(),
                        quant: Some(q.label().to_string()),
                        decode: est.decode_tok_s,
                        prefill: est.prefill_tok_s,
                        fits: true,
                        weight_gb: est.weight_gb,
                    });
                }
                None => {
                    let weight_gb = rm.params as f64 * 0.5 / 1e9; // Q4 weight
                    rt_results.push(RuntimeResult {
                        runtime: rt.to_string(),
                        quant: None,
                        decode: None,
                        prefill: None,
                        fits: false,
                        weight_gb,
                    });
                }
            }
        }
        results.push(MachineResult {
            short: rm.short,
            params: rm.params as f64,
            id: rm.id,
            results: rt_results,
        });
    }

    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

// ---------------------------------------------------------------------------
// Reference models
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct RefModelJs {
    id: &'static str,
    short: &'static str,
    params: f64,
}

/// Get the list of curated reference models.
#[wasm_bindgen]
pub fn get_reference_models() -> JsValue {
    let models: Vec<RefModelJs> = REFERENCE_MODELS
        .iter()
        .map(|m| RefModelJs {
            id: m.id,
            short: m.short,
            params: m.params as f64,
        })
        .collect();
    serde_wasm_bindgen::to_value(&models).unwrap_or(JsValue::NULL)
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/// Generate a code snippet for a model + provider + language.
#[wasm_bindgen]
pub fn generate_snippet(model_id: &str, provider: &str, lang: &str) -> JsValue {
    let l = match lang.parse::<snippet::Lang>() {
        Ok(l) => l,
        Err(_) => return JsValue::NULL,
    };
    JsValue::from_str(&snippet::generate_simple(model_id, provider, l))
}

// ---------------------------------------------------------------------------
// Cost utilities
// ---------------------------------------------------------------------------

/// Cost per million output tokens given $/hr and tok/s.
#[wasm_bindgen]
pub fn cost_per_million(price_hr: f64, tok_s: f64) -> f64 {
    if tok_s <= 0.0 {
        return f64::INFINITY;
    }
    price_hr / (tok_s * 3600.0) * 1_000_000.0
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/// Format a parameter count as human-readable string: "70.6B", "8.0B", etc.
#[wasm_bindgen]
pub fn fmt_params(n: f64) -> String {
    Model::fmt_params(n as u64)
}

/// Extract a param hint from a model name, e.g. "70B" from "Llama-3.3-70B-Instruct".
#[wasm_bindgen]
pub fn param_hint(name: &str) -> JsValue {
    match Model::param_hint(name) {
        Some(h) => JsValue::from_str(&h),
        None => JsValue::NULL,
    }
}

/// Detect if a model name suggests a Mixture-of-Experts architecture.
#[wasm_bindgen]
pub fn is_moe(name: &str) -> bool {
    Model::detect_moe(name)
}
