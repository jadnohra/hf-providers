#[derive(Debug, thiserror::Error)]
pub enum HfpError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("model not found: {0}")]
    ModelNotFound(String),

    #[error("API error (HTTP {status}): {body}")]
    Api { status: u16, body: String },

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("no HF token found — set $HF_TOKEN or run `huggingface-cli login`")]
    NoToken,

    #[error("IO error: {0}")]
    Io(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, HfpError>;
