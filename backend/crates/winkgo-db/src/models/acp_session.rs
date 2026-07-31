// Modified from AionCore by WINK GO contributors in 2026.
use serde::{Deserialize, Serialize};
use winkgo_common::TimestampMs;

/// Row mapping for the `acp_session` table.
///
/// Stores ACP agent session state for suspend/resume across app restarts.
/// Primary key is `conversation_id` (one session per conversation).
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AcpSessionRow {
    pub conversation_id: String,
    pub agent_source: String,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub session_status: String,
    /// JSON object: serialized session configuration.
    pub session_config: String,
    pub last_active_at: Option<TimestampMs>,
    pub suspended_at: Option<TimestampMs>,
}
