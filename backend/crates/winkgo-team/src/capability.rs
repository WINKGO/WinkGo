// Modified from AionCore by WINK GO contributors in 2026.
pub use winkgo_common::constants::WINKGO_AGENT_RUNTIME_BACKEND;
use winkgo_common::constants::{is_team_capable, supports_team_cli_fallback, supports_team_mcp};

/// Determine if a backend supports team mode.
///
/// Built-in Team MCP backends pass directly. Other backends use persisted
/// `agent_capabilities` for MCP transport or shell/CLI fallback eligibility.
pub fn is_team_capable_backend(backend: &str, agent_capabilities: Option<&serde_json::Value>) -> bool {
    is_team_capable(backend, agent_capabilities)
}

pub fn supports_team_mcp_backend(backend: &str, agent_capabilities: Option<&serde_json::Value>) -> bool {
    supports_team_mcp(backend, agent_capabilities)
}

pub fn supports_team_cli_fallback_backend(agent_capabilities: Option<&serde_json::Value>) -> bool {
    supports_team_cli_fallback(agent_capabilities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builtin_backend_is_mcp_capable_regardless_of_capabilities() {
        assert!(is_team_capable_backend("winkgo_agent", None));
        assert!(supports_team_mcp_backend("winkgo_agent", None));
        assert!(supports_team_mcp_backend("winkgo_agent", Some(&json!({}))));
        assert_eq!(WINKGO_AGENT_RUNTIME_BACKEND, "winkgo_agent");
    }

    #[test]
    fn acp_backend_mcp_transport_requires_stdio_or_http_capabilities() {
        let caps_stdio = json!({"mcp_capabilities": {"stdio": true}});
        assert!(is_team_capable_backend("qwen", Some(&caps_stdio)));
        assert!(supports_team_mcp_backend("qwen", Some(&caps_stdio)));

        let caps_http = json!({"mcpCapabilities": {"http": true, "sse": true}});
        assert!(is_team_capable_backend("droid", Some(&caps_http)));
        assert!(supports_team_mcp_backend("droid", Some(&caps_http)));

        let caps_mcp = json!({"mcp": {"stdio": true}});
        assert!(is_team_capable_backend("goose", Some(&caps_mcp)));
        assert!(supports_team_mcp_backend("goose", Some(&caps_mcp)));

        let caps_disabled_transport = json!({"mcp_capabilities": {"http": false, "sse": false}});
        assert!(is_team_capable_backend("zed", Some(&caps_disabled_transport)));
        assert!(!supports_team_mcp_backend("zed", Some(&caps_disabled_transport)));

        let caps_empty = json!({"mcp_capabilities": {}});
        assert!(is_team_capable_backend("cursor", Some(&caps_empty)));
        assert!(!supports_team_mcp_backend("cursor", Some(&caps_empty)));

        assert!(!supports_team_mcp_backend("claude", None));
        assert!(!supports_team_mcp_backend("acp", None));
    }

    #[test]
    fn custom_backend_without_mcp_capabilities_is_cli_fallback_capable_by_default() {
        assert!(is_team_capable_backend("custom", None));
        assert!(is_team_capable_backend("custom", Some(&json!({}))));
        assert!(!supports_team_mcp_backend("custom", None));
        assert!(supports_team_cli_fallback_backend(None));
        assert!(!is_team_capable_backend("custom", Some(&json!({"shell": false}))));
        assert!(!is_team_capable_backend("", None));
        assert!(is_team_capable_backend("Claude", None));
    }
}
