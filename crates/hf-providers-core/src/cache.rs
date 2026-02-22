use std::path::PathBuf;

/// Return the cache directory for hf-providers data files.
/// Creates it if it doesn't exist.
pub fn cache_dir() -> Option<PathBuf> {
    let dir = dirs::cache_dir()?.join("hf-providers");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).ok()?;
    }
    Some(dir)
}

/// Return the path to a cached data file, if the cache directory is available.
pub fn cache_path(filename: &str) -> Option<PathBuf> {
    Some(cache_dir()?.join(filename))
}
