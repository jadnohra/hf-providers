use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::{HfpError, Result};

/// A cloud GPU rental offering from cloud.toml.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CloudOffering {
    pub name: String,
    pub provider: String,
    /// Key into hardware.toml (soft reference, not validated at parse time).
    pub gpu: String,
    pub gpu_count: u32,
    /// On-demand price in USD per hour (per GPU).
    pub price_hr: f64,
    /// Spot/interruptible price (optional).
    pub spot_hr: Option<f64>,
    /// Multi-GPU interconnect type (optional, e.g. "nvlink", "pcie").
    pub interconnect: Option<String>,
    pub region: Vec<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct CloudFile {
    cloud: BTreeMap<String, CloudOffering>,
}

/// Load cloud offerings from a cloud.toml file.
#[cfg(feature = "network")]
pub fn load_cloud(path: &std::path::Path) -> Result<Vec<(String, CloudOffering)>> {
    let content = std::fs::read_to_string(path).map_err(|e| HfpError::Io(e.to_string()))?;
    parse_cloud(&content)
}

/// Parse cloud offerings from TOML string.
pub fn parse_cloud(toml_str: &str) -> Result<Vec<(String, CloudOffering)>> {
    let cf: CloudFile =
        toml::from_str(toml_str).map_err(|e| HfpError::Io(format!("bad cloud.toml: {e}")))?;
    Ok(cf.cloud.into_iter().collect())
}

/// Load the bundled cloud.toml from the data/ directory.
pub fn load_bundled_cloud() -> Result<Vec<(String, CloudOffering)>> {
    let toml_str = include_str!("../../../data/cloud.toml");
    parse_cloud(toml_str)
}

/// Load cloud data: cached file if available, otherwise bundled.
#[cfg(feature = "network")]
pub fn load_cloud_cached() -> Result<Vec<(String, CloudOffering)>> {
    if let Some(path) = crate::cache::cache_path("cloud.toml") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(parsed) = parse_cloud(&content) {
                return Ok(parsed);
            }
        }
    }
    load_bundled_cloud()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bundled_cloud() {
        let offerings = load_bundled_cloud().expect("should parse bundled cloud.toml");
        assert!(
            offerings.len() >= 10,
            "expected at least 10 offerings, got {}",
            offerings.len()
        );

        // Check a known entry.
        let (_, lambda_h100) = offerings
            .iter()
            .find(|(k, _)| k == "lambda_h100_sxm_1x")
            .expect("lambda_h100_sxm_1x missing");
        assert_eq!(lambda_h100.provider, "lambda");
        assert_eq!(lambda_h100.gpu_count, 1);
        assert!(lambda_h100.price_hr > 0.0);
        assert!(!lambda_h100.region.is_empty());
    }

    #[test]
    fn all_offerings_have_valid_fields() {
        let offerings = load_bundled_cloud().unwrap();
        for (key, o) in &offerings {
            assert!(!o.name.is_empty(), "{key}: name is empty");
            assert!(!o.provider.is_empty(), "{key}: provider is empty");
            assert!(!o.gpu.is_empty(), "{key}: gpu is empty");
            assert!(o.gpu_count > 0, "{key}: gpu_count must be positive");
            assert!(o.price_hr > 0.0, "{key}: price_hr must be positive");
            assert!(!o.region.is_empty(), "{key}: region must not be empty");
            assert!(!o.url.is_empty(), "{key}: url is empty");
            if let Some(spot) = o.spot_hr {
                assert!(spot > 0.0, "{key}: spot_hr must be positive");
            }
        }
    }

    #[test]
    fn parse_minimal_toml() {
        let toml = r#"
[cloud.test_offering]
name = "Test 1x H100"
provider = "test"
gpu = "h100_sxm5_80_gb"
gpu_count = 1
price_hr = 2.50
region = ["US"]
url = "https://example.com"
"#;
        let offerings = parse_cloud(toml).unwrap();
        assert_eq!(offerings.len(), 1);
        assert_eq!(offerings[0].0, "test_offering");
        assert!(offerings[0].1.spot_hr.is_none());
        assert!(offerings[0].1.interconnect.is_none());
    }
}
