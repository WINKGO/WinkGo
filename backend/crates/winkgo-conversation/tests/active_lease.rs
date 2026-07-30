use std::sync::Arc;

use serde_json::json;
use winkgo_ai_agent::{ActiveLeaseRegistry, AgentError, IWorkerTaskManager};
use winkgo_api_types::{CreateConversationRequest, WebSocketMessage};
use winkgo_common::{AgentKillReason, TimestampMs};
use winkgo_conversation::skill_resolver::SkillResolver;
use winkgo_conversation::{ConversationError, ConversationService};
use winkgo_db::{SqliteConversationRepository, init_database_memory};
use winkgo_realtime::EventBroadcaster;

struct NoopBroadcaster;

impl EventBroadcaster for NoopBroadcaster {
    fn broadcast(&self, _event: WebSocketMessage<serde_json::Value>) {}
}

struct NoopTaskManager;

#[async_trait::async_trait]
impl IWorkerTaskManager for NoopTaskManager {
    fn get_task(&self, _: &str) -> Option<winkgo_ai_agent::AgentInstance> {
        None
    }

    async fn get_or_build_task(
        &self,
        _: &str,
        _: winkgo_ai_agent::types::BuildTaskOptions,
    ) -> Result<winkgo_ai_agent::AgentInstance, AgentError> {
        Err(AgentError::internal("noop"))
    }

    fn kill(&self, _: &str, _: Option<AgentKillReason>) -> Result<(), AgentError> {
        Ok(())
    }

    fn kill_and_wait(
        &self,
        _: &str,
        _: Option<AgentKillReason>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(std::future::ready(()))
    }

    async fn clear(&self) {}

    fn active_count(&self) -> usize {
        0
    }

    fn collect_idle(&self, _: TimestampMs) -> Vec<String> {
        vec![]
    }
}

struct EmptySkillResolver;

#[async_trait::async_trait]
impl SkillResolver for EmptySkillResolver {
    async fn auto_inject_names(&self) -> Vec<String> {
        Vec::new()
    }

    async fn resolve_skills(&self, _names: &[String]) -> Vec<winkgo_extension::ResolvedAgentSkill> {
        Vec::new()
    }

    async fn link_workspace_skills(
        &self,
        _workspace: &std::path::Path,
        _rel_dirs: &[&str],
        _skills: &[winkgo_extension::ResolvedAgentSkill],
    ) -> usize {
        0
    }
}

const USER_ID: &str = "system_default_user";
const OTHER_USER_ID: &str = "other-user";

async fn setup() -> ConversationService {
    let db = init_database_memory().await.unwrap();
    let repo = Arc::new(SqliteConversationRepository::new(db.pool().clone()));
    let agent_metadata_repo: Arc<dyn winkgo_db::IAgentMetadataRepository> =
        Arc::new(winkgo_db::SqliteAgentMetadataRepository::new(db.pool().clone()));
    let acp_session_repo: Arc<dyn winkgo_db::IAcpSessionRepository> =
        Arc::new(winkgo_db::SqliteAcpSessionRepository::new(db.pool().clone()));

    ConversationService::new(
        std::env::temp_dir(),
        Arc::new(NoopBroadcaster),
        Arc::new(EmptySkillResolver),
        Arc::new(NoopTaskManager),
        repo,
        agent_metadata_repo,
        acp_session_repo,
    )
}

fn make_create_req() -> CreateConversationRequest {
    serde_json::from_value(json!({
        "type": "acp",
        "extra": { "workspace": std::env::temp_dir().to_string_lossy() }
    }))
    .unwrap()
}

#[tokio::test]
async fn renew_active_lease_records_owned_conversation() {
    let service = setup().await;
    let conversation = service.create(USER_ID, make_create_req()).await.unwrap();
    let active_leases = ActiveLeaseRegistry::new();

    service
        .renew_active_lease(USER_ID, &conversation.id, &active_leases)
        .await
        .unwrap();

    assert!(active_leases.is_active(&conversation.id));
}

#[tokio::test]
async fn renew_active_lease_rejects_other_users_conversation() {
    let service = setup().await;
    let conversation = service.create(USER_ID, make_create_req()).await.unwrap();
    let active_leases = ActiveLeaseRegistry::new();

    let err = service
        .renew_active_lease(OTHER_USER_ID, &conversation.id, &active_leases)
        .await
        .unwrap_err();

    assert!(matches!(err, ConversationError::NotFound { .. }));
    assert!(!active_leases.is_active(&conversation.id));
}

#[tokio::test]
async fn renew_active_lease_rejects_missing_conversation() {
    let service = setup().await;
    let active_leases = ActiveLeaseRegistry::new();

    let err = service
        .renew_active_lease(USER_ID, "missing-conversation", &active_leases)
        .await
        .unwrap_err();

    assert!(matches!(err, ConversationError::NotFound { .. }));
    assert!(!active_leases.is_active("missing-conversation"));
}
