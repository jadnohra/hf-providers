use crate::hardware::{GpuSpec, Runtime};

/// Quantization level for weight storage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Quant {
    Q4,
    Q8,
    FP16,
}

impl Quant {
    pub fn bytes_per_param(self) -> f64 {
        match self {
            Quant::Q4 => 0.5,
            Quant::Q8 => 1.0,
            Quant::FP16 => 2.0,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Quant::Q4 => "Q4",
            Quant::Q8 => "Q8",
            Quant::FP16 => "FP16",
        }
    }
}

/// Whether the model fits in GPU VRAM.
#[derive(Debug, Clone, PartialEq)]
pub enum Fit {
    /// Fits entirely in VRAM.
    Full,
    /// Too large for VRAM.
    NoFit,
}

/// Performance estimate for a model on a specific GPU at a given quantization.
#[derive(Debug, Clone)]
pub struct Estimate {
    pub gpu_key: String,
    pub gpu_name: String,
    pub quant: Quant,
    pub weight_gb: f64,
    pub fit: Fit,
    pub decode_tok_s: Option<f64>,
    pub prefill_tok_s: Option<f64>,
}

/// Overhead fraction for framework/KV cache/activations.
const VRAM_OVERHEAD: f64 = 0.15;

/// Estimate performance of a model (given its total param count) on a GPU.
pub fn estimate(gpu: &GpuSpec, params: u64, quant: Quant, runtime: Runtime) -> Estimate {
    let weight_gb = params as f64 * quant.bytes_per_param() / 1e9;
    let usable_vram = gpu.vram_gb * (1.0 - VRAM_OVERHEAD);

    let fit = if weight_gb <= usable_vram {
        Fit::Full
    } else {
        Fit::NoFit
    };

    let decode_eff = gpu.decode_eff(runtime);
    let prefill_eff = gpu.prefill_eff(runtime);

    let decode_tok_s = match &fit {
        Fit::NoFit => None,
        Fit::Full => {
            let tok_s = gpu.mem_bw_gb_s * decode_eff / weight_gb;
            Some(tok_s)
        }
    };

    let prefill_tok_s = match &fit {
        Fit::NoFit => None,
        Fit::Full => {
            let params_f = params as f64;
            let tok_s = gpu.fp16_tflops * 1e12 * prefill_eff / (2.0 * params_f);
            Some(tok_s)
        }
    };

    Estimate {
        gpu_key: String::new(),
        gpu_name: gpu.name.clone(),
        quant,
        weight_gb,
        fit,
        decode_tok_s,
        prefill_tok_s,
    }
}

/// Estimate performance on a multi-GPU setup (e.g. cloud 8×H100).
/// Scales VRAM linearly for fit check and throughput linearly (tensor parallelism).
pub fn estimate_multi_gpu(
    gpu: &GpuSpec,
    params: u64,
    quant: Quant,
    runtime: Runtime,
    gpu_count: u32,
) -> Estimate {
    let weight_gb = params as f64 * quant.bytes_per_param() / 1e9;
    let usable_vram = gpu.vram_gb * gpu_count as f64 * (1.0 - VRAM_OVERHEAD);

    let fit = if weight_gb <= usable_vram {
        Fit::Full
    } else {
        Fit::NoFit
    };

    let n = gpu_count as f64;
    let decode_eff = gpu.decode_eff(runtime);
    let prefill_eff = gpu.prefill_eff(runtime);

    let decode_tok_s = match &fit {
        Fit::NoFit => None,
        Fit::Full => {
            let tok_s = gpu.mem_bw_gb_s * decode_eff * n / weight_gb;
            Some(tok_s)
        }
    };

    let prefill_tok_s = match &fit {
        Fit::NoFit => None,
        Fit::Full => {
            let params_f = params as f64;
            let tok_s = gpu.fp16_tflops * 1e12 * prefill_eff * n / (2.0 * params_f);
            Some(tok_s)
        }
    };

    Estimate {
        gpu_key: String::new(),
        gpu_name: gpu.name.clone(),
        quant,
        weight_gb,
        fit,
        decode_tok_s,
        prefill_tok_s,
    }
}

/// Pick the best quantization for a multi-GPU setup.
pub fn best_quant_multi_gpu(
    gpu: &GpuSpec,
    params: u64,
    runtime: Runtime,
    gpu_count: u32,
) -> Option<(Quant, Estimate)> {
    for q in [Quant::Q4, Quant::Q8, Quant::FP16] {
        let est = estimate_multi_gpu(gpu, params, q, runtime, gpu_count);
        if est.fit == Fit::Full {
            return Some((q, est));
        }
    }
    None
}

/// Pick the best quantization level that fits a GPU for a given model.
/// Tries Q4 first, then Q8, then FP16.
pub fn best_quant(gpu: &GpuSpec, params: u64, runtime: Runtime) -> Option<(Quant, Estimate)> {
    for q in [Quant::Q4, Quant::Q8, Quant::FP16] {
        let est = estimate(gpu, params, q, runtime);
        if est.fit == Fit::Full {
            return Some((q, est));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::load_bundled_hardware;

    fn gpu(key: &str) -> GpuSpec {
        let gpus = load_bundled_hardware().unwrap();
        gpus.into_iter().find(|(k, _)| k == key).unwrap().1
    }

    // 8B model at Q4 on RTX 4090: should fit, ~100-170 tok/s decode
    #[test]
    fn llama_8b_q4_rtx4090() {
        let est = estimate(&gpu("rtx_4090"), 8_000_000_000, Quant::Q4, Runtime::LlamaCpp);
        assert_eq!(est.fit, Fit::Full);
        assert!(est.weight_gb < 5.0, "8B Q4 should be ~4 GB");
        let d = est.decode_tok_s.unwrap();
        assert!(d > 80.0 && d < 200.0, "decode {d:.1} out of range for 8B Q4 on 4090");
        assert!(est.prefill_tok_s.unwrap() > 500.0, "prefill should be fast for 8B");
    }

    // 70B at Q4 on RTX 4090 (24GB): doesn't fit (~35GB model in 24GB)
    #[test]
    fn llama_70b_q4_rtx4090_nofit() {
        let est = estimate(&gpu("rtx_4090"), 70_600_000_000, Quant::Q4, Runtime::LlamaCpp);
        assert_eq!(est.fit, Fit::NoFit);
        assert!(est.decode_tok_s.is_none());
    }

    // 70B at Q4 on M4 Max 128GB with mlx: should fit comfortably
    #[test]
    fn llama_70b_q4_m4max128_fits_mlx() {
        let est = estimate(&gpu("m4_max_128"), 70_600_000_000, Quant::Q4, Runtime::Mlx);
        assert_eq!(est.fit, Fit::Full);
        let d = est.decode_tok_s.unwrap();
        assert!(d > 5.0 && d < 40.0, "decode {d:.1} out of range for 70B Q4 on M4 Max (mlx)");
    }

    // Same model, same GPU, llama.cpp should be slower than mlx
    #[test]
    fn mlx_faster_than_llamacpp_on_apple() {
        let g = gpu("m4_max_128");
        let mlx = estimate(&g, 8_000_000_000, Quant::Q4, Runtime::Mlx);
        let lcpp = estimate(&g, 8_000_000_000, Quant::Q4, Runtime::LlamaCpp);
        assert!(
            mlx.decode_tok_s.unwrap() > lcpp.decode_tok_s.unwrap(),
            "mlx ({:.1}) should be faster than llama.cpp ({:.1}) on Apple",
            mlx.decode_tok_s.unwrap(),
            lcpp.decode_tok_s.unwrap(),
        );
    }

    // 671B (DeepSeek-R1) at Q4 on RTX 4090: way too large
    #[test]
    fn deepseek_r1_q4_rtx4090_nofit() {
        let est = estimate(&gpu("rtx_4090"), 671_000_000_000, Quant::Q4, Runtime::LlamaCpp);
        assert_eq!(est.fit, Fit::NoFit);
        assert!(est.decode_tok_s.is_none());
    }

    // 671B at Q4 on M4 Max 128GB: 335 GB > 128 GB, no fit
    #[test]
    fn deepseek_r1_q4_m4max128_nofit() {
        let est = estimate(&gpu("m4_max_128"), 671_000_000_000, Quant::Q4, Runtime::Mlx);
        assert_eq!(est.fit, Fit::NoFit);
    }

    // 8B model: best_quant should pick Q4 (smallest that fits)
    #[test]
    fn best_quant_picks_q4_for_small_model() {
        let (q, est) = best_quant(&gpu("rtx_4090"), 8_000_000_000, Runtime::LlamaCpp).unwrap();
        assert_eq!(q, Quant::Q4);
        assert_eq!(est.fit, Fit::Full);
    }

    // Huge model: best_quant returns None when nothing fits
    #[test]
    fn best_quant_none_for_huge_model() {
        assert!(best_quant(&gpu("rtx_4090"), 671_000_000_000, Runtime::LlamaCpp).is_none());
    }

    // Verify weight_gb calculation
    #[test]
    fn weight_gb_math() {
        let est = estimate(&gpu("rtx_4090"), 70_000_000_000, Quant::Q4, Runtime::LlamaCpp);
        assert!((est.weight_gb - 35.0).abs() < 0.1, "70B Q4 = 35 GB");

        let est = estimate(&gpu("rtx_4090"), 70_000_000_000, Quant::FP16, Runtime::LlamaCpp);
        assert!((est.weight_gb - 140.0).abs() < 0.1, "70B FP16 = 140 GB");
    }

    // Decode speed should increase with better bandwidth
    #[test]
    fn faster_gpu_faster_decode() {
        let params = 8_000_000_000u64;
        let est_4090 = estimate(&gpu("rtx_4090"), params, Quant::Q4, Runtime::LlamaCpp);
        let est_3090 = estimate(&gpu("rtx_3090"), params, Quant::Q4, Runtime::LlamaCpp);
        assert!(
            est_4090.decode_tok_s.unwrap() > est_3090.decode_tok_s.unwrap(),
            "4090 should decode faster than 3090"
        );
    }

    // Prefill speed should increase with more compute
    #[test]
    fn more_compute_faster_prefill() {
        let params = 8_000_000_000u64;
        let est_h100 = estimate(&gpu("h100_sxm5_80_gb"), params, Quant::Q4, Runtime::LlamaCpp);
        let est_4090 = estimate(&gpu("rtx_4090"), params, Quant::Q4, Runtime::LlamaCpp);
        assert!(
            est_h100.prefill_tok_s.unwrap() > est_4090.prefill_tok_s.unwrap(),
            "H100 should prefill faster than 4090"
        );
    }
}
