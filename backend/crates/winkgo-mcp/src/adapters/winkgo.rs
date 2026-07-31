// Modified from AionCore by WINK GO contributors in 2026.
use std::sync::Arc;

use winkgo_common::McpSource;
use winkgo_db::IMcpServerRepository;

use crate::adapter::{DetectedServer, McpAgentAdapter};
use crate::error::McpError;
use crate::types::{McpServer, McpServerTransport};

/// MCP Agent adapter for WinkGoui itself.
///
/// Unlike CLI-based adapters, this adapter reads/writes directly to the
/// local database. It is always "installed" since WinkGo is the host
/// application.
///
/// # Behavior
///
/// - `is_installed()` → always `true`
/// - `detect_existing()` → reads all MCP servers from the DB
/// - `install_server()` → no-op (DB writes are handled by `McpConfigService`)
/// - `remove_server()` → no-op (configuration is managed via the frontend)
pub struct WinkGouiAdapter {
    repo: Arc<dyn IMcpServerRepository>,
}

impl WinkGouiAdapter {
    pub fn new(repo: Arc<dyn IMcpServerRepository>) -> Self {
        Self { repo }
    }
}

#[async_trait::async_trait]
impl McpAgentAdapter for WinkGouiAdapter {
    fn source(&self) -> McpSource {
        McpSource::WinkGoui
    }

    async fn is_installed(&self) -> Result<bool, McpError> {
        Ok(true)
    }

    async fn detect_existing(&self) -> Result<Vec<DetectedServer>, McpError> {
        let rows = self.repo.list().await?;

        let mut servers = Vec::new();
        for row in rows {
            let server = McpServer::from_row(row)?;
            servers.push(DetectedServer {
                name: server.name,
                transport: server.transport,
                importable: true,
                import_skip_reason: None,
            });
        }

        Ok(servers)
    }

    async fn install_server(&self, _name: &str, _transport: &McpServerTransport) -> Result<(), McpError> {
        // No-op: DB writes are handled by McpConfigService.
        // The sync service calls install_server on all adapters, but for
        // WinkGoui the server is already in the DB.
        Ok(())
    }

    async fn remove_server(&self, _name: &str) -> Result<(), McpError> {
        // No-op: configuration is managed via the frontend/REST API.
        // Removing from the DB is done through McpConfigService.delete_server().
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::types::McpServerTransport;
    use winkgo_db::models::McpServerRow;

    /// In-memory mock repository for testing.
    struct MockRepo {
        servers: Vec<McpServerRow>,
    }

    impl MockRepo {
        fn new(servers: Vec<McpServerRow>) -> Self {
            Self { servers }
        }
    }

    #[async_trait::async_trait]
    impl IMcpServerRepository for MockRepo {
        async fn list(&self) -> Result<Vec<McpServerRow>, winkgo_db::DbError> {
            Ok(self.servers.clone())
        }

        async fn find_by_id(&self, id: &str) -> Result<Option<McpServerRow>, winkgo_db::DbError> {
            Ok(self.servers.iter().find(|s| s.id == id).cloned())
        }

        async fn find_by_name(&self, name: &str) -> Result<Option<McpServerRow>, winkgo_db::DbError> {
            Ok(self.servers.iter().find(|s| s.name == name).cloned())
        }

        async fn create(
            &self,
            _params: winkgo_db::CreateMcpServerParams<'_>,
        ) -> Result<McpServerRow, winkgo_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn update(
            &self,
            _id: &str,
            _params: winkgo_db::UpdateMcpServerParams<'_>,
        ) -> Result<McpServerRow, winkgo_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn delete(&self, _id: &str) -> Result<(), winkgo_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn batch_upsert(
            &self,
            _servers: &[winkgo_db::CreateMcpServerParams<'_>],
        ) -> Result<Vec<McpServerRow>, winkgo_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn update_status(
            &self,
            _id: &str,
            _status: &str,
            _last_connected: Option<winkgo_common::TimestampMs>,
        ) -> Result<(), winkgo_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }

        async fn update_tools(&self, _id: &str, _tools: Option<&str>) -> Result<(), winkgo_db::DbError> {
            unimplemented!("not needed for adapter tests")
        }
    }

    fn make_row(name: &str, transport_type: &str, transport_config: &str) -> McpServerRow {
        McpServerRow {
            id: format!("mcp_{name}"),
            name: name.to_owned(),
            description: None,
            enabled: true,
            transport_type: transport_type.into(),
            transport_config: transport_config.into(),
            tools: None,
            last_test_status: "disconnected".into(),
            last_connected: None,
            original_json: None,
            builtin: false,
            deleted_at: None,
            created_at: 1000,
            updated_at: 1000,
        }
    }

    #[test]
    fn source_is_winkgo() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = WinkGouiAdapter::new(repo);
        assert_eq!(adapter.source(), McpSource::WinkGoui);
    }

    #[tokio::test]
    async fn is_always_installed() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = WinkGouiAdapter::new(repo);
        assert!(adapter.is_installed().await.unwrap());
    }

    #[tokio::test]
    async fn detect_existing_returns_db_servers() {
        let rows = vec![
            make_row("srv-a", "stdio", r#"{"command":"npx","args":[]}"#),
            make_row("srv-b", "http", r#"{"url":"https://b.com/mcp","headers":{}}"#),
        ];
        let repo = Arc::new(MockRepo::new(rows));
        let adapter = WinkGouiAdapter::new(repo);

        let servers = adapter.detect_existing().await.unwrap();
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "srv-a");
        assert_eq!(servers[1].name, "srv-b");
        assert!(matches!(servers[0].transport, McpServerTransport::Stdio { .. }));
        assert!(matches!(servers[1].transport, McpServerTransport::Http { .. }));
    }

    #[tokio::test]
    async fn detect_existing_empty_db() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = WinkGouiAdapter::new(repo);

        let servers = adapter.detect_existing().await.unwrap();
        assert!(servers.is_empty());
    }

    #[tokio::test]
    async fn install_server_is_noop() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = WinkGouiAdapter::new(repo);

        let transport = McpServerTransport::Stdio {
            command: "npx".into(),
            args: vec![],
            env: HashMap::new(),
        };
        // Should succeed without side effects
        adapter.install_server("test", &transport).await.unwrap();
    }

    #[tokio::test]
    async fn remove_server_is_noop() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter = WinkGouiAdapter::new(repo);

        // Should succeed without side effects
        adapter.remove_server("test").await.unwrap();
    }

    #[tokio::test]
    async fn trait_is_object_safe() {
        let repo = Arc::new(MockRepo::new(vec![]));
        let adapter: Arc<dyn McpAgentAdapter> = Arc::new(WinkGouiAdapter::new(repo));
        assert_eq!(adapter.source(), McpSource::WinkGoui);
        assert!(adapter.is_installed().await.unwrap());
    }
}
