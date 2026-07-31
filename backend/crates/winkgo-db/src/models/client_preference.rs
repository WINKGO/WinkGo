// Modified from AionCore by WINK GO contributors in 2026.
use serde::{Deserialize, Serialize};
use winkgo_common::TimestampMs;

/// Row mapping for the `client_preferences` table.
///
/// Generic key-value store. Values are stored as JSON-serialized TEXT.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ClientPreference {
    pub key: String,
    pub value: String,
    pub updated_at: TimestampMs,
}
