use crate::cache;
use crate::cloud;
use crate::error::{HfpError, Result};
use crate::hardware;

const HARDWARE_URL: &str =
    "https://raw.githubusercontent.com/jadnohra/hf-providers/main/data/hardware.toml";
const CLOUD_URL: &str =
    "https://raw.githubusercontent.com/jadnohra/hf-providers/main/data/cloud.toml";

pub struct SyncResult {
    pub hardware_count: usize,
    pub cloud_count: usize,
}

/// Download hardware.toml and cloud.toml from GitHub, validate, and write to cache.
pub async fn sync_data() -> Result<SyncResult> {
    let client = reqwest::Client::new();
    let cache_dir =
        cache::cache_dir().ok_or_else(|| HfpError::Io("cannot determine cache directory".into()))?;

    // Download both in parallel.
    let (hw_resp, cl_resp) = tokio::join!(
        client.get(HARDWARE_URL).send(),
        client.get(CLOUD_URL).send(),
    );

    let hw_text = hw_resp
        .map_err(|e| HfpError::Io(format!("failed to download hardware.toml: {e}")))?
        .text()
        .await
        .map_err(|e| HfpError::Io(format!("failed to read hardware.toml response: {e}")))?;

    let cl_text = cl_resp
        .map_err(|e| HfpError::Io(format!("failed to download cloud.toml: {e}")))?
        .text()
        .await
        .map_err(|e| HfpError::Io(format!("failed to read cloud.toml response: {e}")))?;

    // Validate by parsing before writing.
    let hw = hardware::parse_hardware(&hw_text)?;
    let cl = cloud::parse_cloud(&cl_text)?;

    // Write to cache.
    std::fs::write(cache_dir.join("hardware.toml"), &hw_text)
        .map_err(|e| HfpError::Io(format!("failed to write hardware.toml cache: {e}")))?;
    std::fs::write(cache_dir.join("cloud.toml"), &cl_text)
        .map_err(|e| HfpError::Io(format!("failed to write cloud.toml cache: {e}")))?;

    Ok(SyncResult {
        hardware_count: hw.len(),
        cloud_count: cl.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Integration test: actually downloads from GitHub and validates.
    /// Run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore]
    async fn sync_downloads_and_validates() {
        let result = sync_data().await.expect("sync should succeed");
        assert!(
            result.hardware_count >= 200,
            "expected >=200 GPUs, got {}",
            result.hardware_count
        );
        assert!(
            result.cloud_count >= 10,
            "expected >=10 cloud offerings, got {}",
            result.cloud_count
        );

        // Verify files were written to cache.
        let hw_path = cache::cache_path("hardware.toml").expect("cache path");
        let cl_path = cache::cache_path("cloud.toml").expect("cache path");
        assert!(hw_path.exists(), "hardware.toml not cached");
        assert!(cl_path.exists(), "cloud.toml not cached");
    }

    #[test]
    fn cache_aware_loaders_fall_back_to_bundled() {
        // Even without cache, load_hardware_cached and load_cloud_cached work.
        let gpus = hardware::load_hardware_cached().expect("should load hardware");
        assert!(gpus.len() >= 200);
        let offerings = cloud::load_cloud_cached().expect("should load cloud");
        assert!(offerings.len() >= 10);
    }
}
