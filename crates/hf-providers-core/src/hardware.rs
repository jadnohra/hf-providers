use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::error::{HfpError, Result};

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
    pub decode_eff: f64,
    pub prefill_eff: f64,
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
        assert!(rtx4090.decode_eff > 0.0 && rtx4090.decode_eff <= 1.0);
        assert!(rtx4090.prefill_eff > 0.0 && rtx4090.prefill_eff <= 1.0);
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
            assert!(gpu.decode_eff > 0.0 && gpu.decode_eff <= 1.0,
                "{key}: decode_eff {:.2} out of range", gpu.decode_eff);
            assert!(gpu.prefill_eff > 0.0 && gpu.prefill_eff <= 1.0,
                "{key}: prefill_eff {:.2} out of range", gpu.prefill_eff);
        }
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
decode_eff = 0.65
prefill_eff = 0.30
"#;
        let gpus = parse_hardware(toml).unwrap();
        assert_eq!(gpus.len(), 1);
        assert_eq!(gpus[0].0, "test_gpu");
        assert!(gpus[0].1.street_usd.is_none());
    }
}
