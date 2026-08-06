// Modified from AionCore by WINK GO contributors in 2026.
/// File crate application errors.
#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("{0}")]
    BadRequest(String),

    #[error("{0}")]
    Forbidden(String),

    #[error("{message}")]
    PathOutsideSandbox {
        message: String,
        field: Option<&'static str>,
        operation: Option<&'static str>,
    },

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Internal(String),

    /// The platform file watcher could not be created. This is non-fatal for
    /// the backend: callers receive a stable error while non-watch features
    /// remain available.
    #[error("file watch service is unavailable")]
    WatchUnavailable { errno: Option<i32> },

    /// Revealing an item in the OS file manager failed (the shell reveal command
    /// errored). Distinct from `NotFound` (missing path) so the frontend can tell
    /// "couldn't open the file manager" from "the item is gone". Maps to the
    /// stable API code `REVEAL_FAILED`.
    #[error("failed to reveal item: {0}")]
    RevealFailed(String),
}
