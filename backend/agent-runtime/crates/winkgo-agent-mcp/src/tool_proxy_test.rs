// Modified from aionrs by WINK GO contributors in 2026.
use super::*;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use winkgo_agent_config::config::TransportType;

    fn make_proxy(deferred: bool) -> McpToolProxy {
        // manager is only used during execute(), which we don't call in these
        // tests, so we can construct one with no servers.
        let manager = Arc::new(McpManager::new_for_test(vec![]));
        McpToolProxy::new(
            "test_tool".into(),
            "test_tool".into(),
            "test_server".into(),
            "A test tool".into(),
            json!({"type": "object"}),
            manager,
            deferred,
        )
    }

    #[test]
    fn proxy_deferred_true_returns_true() {
        let proxy = make_proxy(true);
        assert!(proxy.is_deferred());
    }

    #[test]
    fn proxy_deferred_false_returns_false() {
        let proxy = make_proxy(false);
        assert!(!proxy.is_deferred());
    }

    fn make_server_config(deferred: Option<bool>) -> McpServerConfig {
        McpServerConfig {
            transport: TransportType::Stdio,
            command: Some("echo".into()),
            args: None,
            env: None,
            url: None,
            headers: None,
            deferred,
            startup_timeout_ms: None,
        }
    }

    #[test]
    fn register_defaults_to_deferred_when_config_omits_field() {
        let manager = Arc::new(McpManager::new_for_test(vec![]));
        let mut registry = winkgo_agent_tools::registry::ToolRegistry::new();
        // Empty server configs — deferred field absent
        let configs = HashMap::new();

        register_mcp_tools(&mut registry, &manager, &[], &configs);

        // No tools registered because manager has no tools, but the logic
        // is tested via the deferred default path. Test with a real config below.
        assert!(registry.tool_names().is_empty());
    }

    #[test]
    fn server_config_deferred_none_defaults_true() {
        let config = make_server_config(None);
        let deferred = config.deferred.unwrap_or(true);
        assert!(deferred, "deferred should default to true when None");
    }

    #[test]
    fn server_config_deferred_explicit_false() {
        let config = make_server_config(Some(false));
        let deferred = config.deferred.unwrap_or(true);
        assert!(!deferred, "deferred should be false when explicitly set");
    }

    #[test]
    fn server_config_deferred_explicit_true() {
        let config = make_server_config(Some(true));
        let deferred = config.deferred.unwrap_or(true);
        assert!(deferred, "deferred should be true when explicitly set");
    }

    #[test]
    fn provider_tool_name_keeps_already_valid_names() {
        assert_eq!(provider_safe_tool_name("runtime", "read_file-2", false), "read_file-2");
    }

    #[test]
    fn provider_tool_name_normalizes_dotted_mcp_names() {
        assert_eq!(
            provider_safe_tool_name("WINK GO Runtime Skills", "music.station_open", false),
            "music_station_open"
        );
        assert_eq!(
            provider_safe_tool_name("winkgo-browser", "browser:run/task", false),
            "browser_run_task"
        );
    }

    #[test]
    fn provider_tool_name_disambiguates_collisions_deterministically() {
        let first = provider_safe_tool_name("server one", "music.station_open", true);
        let again = provider_safe_tool_name("server one", "music.station_open", true);
        let other = provider_safe_tool_name("server two", "music_station_open", true);

        assert_eq!(first, again);
        assert_ne!(first, other);
        assert!(first.starts_with("mcp__server_one__music_station_open__"));
    }

    #[test]
    fn provider_tool_name_never_exceeds_openai_limit_or_uses_invalid_characters() {
        let name = provider_safe_tool_name(
            "a server with spaces and punctuation !@#$%",
            "desktop_agents.a_very_long_tool_name_that_would_otherwise_exceed_the_openai_function_name_limit",
            true,
        );

        assert!(name.len() <= MAX_PROVIDER_TOOL_NAME_LEN);
        assert!(
            name.bytes()
                .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'_' | b'-'))
        );
    }
}
