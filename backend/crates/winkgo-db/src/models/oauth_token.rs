// Modified from AionCore by WINK GO contributors in 2026.
use serde::{Deserialize, Serialize};
use winkgo_common::TimestampMs;

/// Row mapping for the `oauth_tokens` table.
///
/// Stores OAuth tokens keyed by MCP server URL.
/// Token values (`access_token`, `refresh_token`) should be stored
/// encrypted; callers handle encryption/decryption.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct OAuthTokenRow {
    /// MCP server URL (primary key).
    pub server_url: String,
    /// Encrypted OAuth access token.
    pub access_token: String,
    /// Encrypted OAuth refresh token (optional).
    pub refresh_token: Option<String>,
    /// Token type, typically "bearer".
    pub token_type: String,
    /// Token expiration timestamp (milliseconds).
    pub expires_at: Option<TimestampMs>,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}
