// Modified from AionCore by WINK GO contributors in 2026.
use serde::{Deserialize, Serialize};
use winkgo_common::TimestampMs;

/// Row mapping for the `conversation_artifacts` table.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ConversationArtifactRow {
    pub id: String,
    pub conversation_id: String,
    pub cron_job_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub payload: String,
    pub created_at: TimestampMs,
    pub updated_at: TimestampMs,
}
