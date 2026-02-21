use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

use serde::Deserialize;

use crate::error::{HfpError, Result};

/// Inference runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runtime {
    LlamaCpp,
    Mlx,
}

impl fmt::Display for Runtime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Runtime::LlamaCpp => write!(f, "llama.cpp"),
            Runtime::Mlx => write!(f, "mlx"),
        }
    }
}

/// GPU specification from hardware.toml.
#[derive(Debug, Clone, Deserialize)]
pub struct GpuSpec {
    pub name: String,
    pub vendor: String,
    pub arch: String,
    pub vram_gb: f64,
    pub mem_bw_gb_s: f64,
    pub fp16_tflops: f64,
    pub tdp_w: u32,
    pub street_usd: Option<u32>,
    pub llamacpp_decode_eff: f64,
    pub llamacpp_prefill_eff: f64,
    pub mlx_decode_eff: Option<f64>,
    pub mlx_prefill_eff: Option<f64>,
}

impl GpuSpec {
    /// Which runtimes are available for this GPU.
    /// Returns mlx first (preferred on Apple), then llama.cpp.
    pub fn available_runtimes(&self) -> Vec<Runtime> {
        let mut rts = Vec::new();
        if self.mlx_decode_eff.is_some() {
            rts.push(Runtime::Mlx);
        }
        rts.push(Runtime::LlamaCpp);
        rts
    }

    pub fn decode_eff(&self, rt: Runtime) -> f64 {
        match rt {
            Runtime::LlamaCpp => self.llamacpp_decode_eff,
            Runtime::Mlx => self.mlx_decode_eff.unwrap_or(self.llamacpp_decode_eff),
        }
    }

    pub fn prefill_eff(&self, rt: Runtime) -> f64 {
        match rt {
            Runtime::LlamaCpp => self.llamacpp_prefill_eff,
            Runtime::Mlx => self.mlx_prefill_eff.unwrap_or(self.llamacpp_prefill_eff),
        }
    }
}

#[derive(Debug, Deserialize)]
struct HardwareFile {
    gpu: BTreeMap<String, GpuSpec>,
}

/// Load GPU specs from a hardware.toml file.
pub fn load_hardware(path: &Path) -> Result<Vec<(String, GpuSpec)>> {
    let content = std::fs::read_to_string(path).map_err(|e| HfpError::Io(e.to_string()))?;
    parse_hardware(&content)
}

/// Parse GPU specs from TOML string.
pub fn parse_hardware(toml_str: &str) -> Result<Vec<(String, GpuSpec)>> {
    let hw: HardwareFile =
        toml::from_str(toml_str).map_err(|e| HfpError::Io(format!("bad hardware.toml: {e}")))?;
    Ok(hw.gpu.into_iter().collect())
}

/// Load the bundled hardware.toml from the data/ directory.
/// Looks relative to the cargo manifest dir at compile time.
pub fn load_bundled_hardware() -> Result<Vec<(String, GpuSpec)>> {
    let toml_str = include_str!("../../../data/hardware.toml");
    parse_hardware(toml_str)
}

/// Find a GPU by user input like "4090", "rtx4090", "m4-max", "h100".
/// Normalizes input, then tries exact match, suffix match, substring match.
/// Also tries matching with underscores stripped so "rtx4090" finds "rtx_4090".
/// Prefers shorter keys (more specific) when multiple match.
pub fn find_gpu(gpus: &[(String, GpuSpec)], input: &str) -> Option<(String, GpuSpec)> {
    let norm = input.to_lowercase().replace(['-', ' '], "_");
    let norm_compact = norm.replace('_', "");

    // Exact match.
    if let Some((k, g)) = gpus.iter().find(|(k, _)| *k == norm) {
        return Some((k.clone(), g.clone()));
    }

    // Suffix match: input "4090" matches "rtx_4090".
    let mut candidates: Vec<&(String, GpuSpec)> = gpus
        .iter()
        .filter(|(k, _)| k.ends_with(&norm))
        .collect();

    if candidates.is_empty() {
        // Substring match.
        candidates = gpus.iter().filter(|(k, _)| k.contains(&norm)).collect();
    }

    if candidates.is_empty() {
        // Try compact match: strip underscores from both sides.
        candidates = gpus
            .iter()
            .filter(|(k, _)| k.replace('_', "").contains(&norm_compact))
            .collect();
    }

    if candidates.is_empty() {
        return None;
    }

    // Prefer shorter keys (more specific).
    candidates.sort_by_key(|(k, _)| k.len());
    let (k, g) = candidates[0];
    Some((k.clone(), g.clone()))
}

/// A curated subset of GPUs shown by default in the detail view.
pub const DEFAULT_DISPLAY_GPUS: &[&str] = &[
    "rtx_4090",
    "rtx_5090",
    "m4_pro_48",
    "m4_max_128",
    "a100_pcie_80_gb",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bundled_hardware() {
        let gpus = load_bundled_hardware().expect("should parse bundled hardware.toml");
        assert!(gpus.len() >= 10, "expected at least 10 GPUs, got {}", gpus.len());

        // Check a known entry.
        let (_, rtx4090) = gpus.iter().find(|(k, _)| k == "rtx_4090").expect("rtx_4090 missing");
        assert_eq!(rtx4090.name, "GeForce RTX 4090");
        assert!((rtx4090.vram_gb - 24.0).abs() < 0.1);
        assert!((rtx4090.mem_bw_gb_s - 1010.0).abs() < 5.0);
        assert!(rtx4090.llamacpp_decode_eff > 0.0 && rtx4090.llamacpp_decode_eff <= 1.0);
        assert!(rtx4090.llamacpp_prefill_eff > 0.0 && rtx4090.llamacpp_prefill_eff <= 1.0);
        assert!(rtx4090.mlx_decode_eff.is_none(), "NVIDIA should not have mlx");
    }

    #[test]
    fn apple_gpu_has_both_runtimes() {
        let gpus = load_bundled_hardware().unwrap();
        let (_, m4) = gpus.iter().find(|(k, _)| k == "m4_max_128").expect("m4_max_128 missing");
        assert!(m4.mlx_decode_eff.is_some(), "Apple should have mlx");
        assert!(m4.mlx_prefill_eff.is_some());
        let rts = m4.available_runtimes();
        assert_eq!(rts.len(), 2);
        assert_eq!(rts[0], Runtime::Mlx);
        assert_eq!(rts[1], Runtime::LlamaCpp);
        // mlx should be faster than llama.cpp on Apple
        assert!(m4.decode_eff(Runtime::Mlx) > m4.decode_eff(Runtime::LlamaCpp));
    }

    #[test]
    fn all_gpus_have_valid_specs() {
        let gpus = load_bundled_hardware().unwrap();
        for (key, gpu) in &gpus {
            assert!(!gpu.name.is_empty(), "{key}: name is empty");
            assert!(gpu.vram_gb > 0.0, "{key}: vram_gb must be positive");
            assert!(gpu.mem_bw_gb_s > 0.0, "{key}: mem_bw_gb_s must be positive");
            assert!(gpu.fp16_tflops > 0.0, "{key}: fp16_tflops must be positive");
            assert!(gpu.tdp_w > 0, "{key}: tdp_w must be positive");
            assert!(gpu.llamacpp_decode_eff > 0.0 && gpu.llamacpp_decode_eff <= 1.0,
                "{key}: llamacpp_decode_eff {:.2} out of range", gpu.llamacpp_decode_eff);
            assert!(gpu.llamacpp_prefill_eff > 0.0 && gpu.llamacpp_prefill_eff <= 1.0,
                "{key}: llamacpp_prefill_eff {:.2} out of range", gpu.llamacpp_prefill_eff);
            if let Some(de) = gpu.mlx_decode_eff {
                assert!(de > 0.0 && de <= 1.0, "{key}: mlx_decode_eff {de:.2} out of range");
            }
            if let Some(pe) = gpu.mlx_prefill_eff {
                assert!(pe > 0.0 && pe <= 1.0, "{key}: mlx_prefill_eff {pe:.2} out of range");
            }
        }
    }

    #[test]
    fn find_gpu_exact() {
        let gpus = load_bundled_hardware().unwrap();
        let (k, g) = find_gpu(&gpus, "rtx_4090").expect("exact match");
        assert_eq!(k, "rtx_4090");
        assert_eq!(g.name, "GeForce RTX 4090");
    }

    #[test]
    fn find_gpu_suffix() {
        let gpus = load_bundled_hardware().unwrap();
        let (k, _) = find_gpu(&gpus, "4090").expect("suffix match");
        assert_eq!(k, "rtx_4090");
    }

    #[test]
    fn find_gpu_dash_normalization() {
        let gpus = load_bundled_hardware().unwrap();
        let (k, _) = find_gpu(&gpus, "m4-max-128").expect("dash normalization");
        assert_eq!(k, "m4_max_128");
    }

    #[test]
    fn find_gpu_no_prefix() {
        let gpus = load_bundled_hardware().unwrap();
        let (k, _) = find_gpu(&gpus, "rtx4090").expect("substring match");
        assert_eq!(k, "rtx_4090");
    }

    #[test]
    fn find_gpu_h100() {
        let gpus = load_bundled_hardware().unwrap();
        let result = find_gpu(&gpus, "h100");
        assert!(result.is_some(), "h100 should match");
    }

    #[test]
    fn find_gpu_not_found() {
        let gpus = load_bundled_hardware().unwrap();
        assert!(find_gpu(&gpus, "nonexistent_gpu_xyz").is_none());
    }

    #[test]
    fn parse_minimal_toml() {
        let toml = r#"
[gpu.test_gpu]
name = "Test GPU"
vendor = "nvidia"
arch = "test"
vram_gb = 24
mem_bw_gb_s = 1000
fp16_tflops = 80.0
tdp_w = 350
llamacpp_decode_eff = 0.65
llamacpp_prefill_eff = 0.30
"#;
        let gpus = parse_hardware(toml).unwrap();
        assert_eq!(gpus.len(), 1);
        assert_eq!(gpus[0].0, "test_gpu");
        assert!(gpus[0].1.street_usd.is_none());
        assert!(gpus[0].1.mlx_decode_eff.is_none());
    }
}
