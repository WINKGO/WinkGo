// Modified from aionrs by WINK GO contributors in 2026.
use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use super::config::McpServerConfig;
use super::manager::McpManager;
use winkgo_agent_protocol::events::ToolCategory;
use winkgo_agent_tools::Tool;
use winkgo_agent_types::tool::{JsonSchema, ToolResult};

const MAX_PROVIDER_TOOL_NAME_LEN: usize = 64;

fn normalize_provider_tool_name(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    let mut previous_was_separator = false;

    for character in name.chars() {
        let safe = character.is_ascii_alphanumeric() || matches!(character, '_' | '-');
        if safe {
            normalized.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator {
            normalized.push('_');
            previous_was_separator = true;
        }
    }

    let normalized = normalized.trim_matches('_');
    if normalized.is_empty() {
        "tool".to_string()
    } else {
        normalized.to_string()
    }
}

fn stable_tool_name_hash(server_name: &str, tool_name: &str) -> u32 {
    // FNV-1a keeps aliases deterministic across processes and Rust versions.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in server_name.bytes().chain([0]).chain(tool_name.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash ^ (hash >> 32)) as u32
}

fn provider_safe_tool_name(server_name: &str, tool_name: &str, needs_disambiguation: bool) -> String {
    let normalized_tool = normalize_provider_tool_name(tool_name);
    let original_is_safe = tool_name.len() <= MAX_PROVIDER_TOOL_NAME_LEN
        && tool_name
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'_' | b'-'));

    if original_is_safe && !needs_disambiguation {
        return tool_name.to_string();
    }

    if normalized_tool.len() <= MAX_PROVIDER_TOOL_NAME_LEN && !needs_disambiguation {
        return normalized_tool;
    }

    let normalized_server = normalize_provider_tool_name(server_name);
    let suffix = format!("__{:08x}", stable_tool_name_hash(server_name, tool_name));
    let mut prefix = format!("mcp__{normalized_server}__{normalized_tool}");
    prefix.truncate(MAX_PROVIDER_TOOL_NAME_LEN.saturating_sub(suffix.len()));
    format!("{prefix}{suffix}")
}

/// Wraps an MCP server tool as a local Tool trait implementation.
/// Uses a provider-safe alias for MCP names containing dots, colons or other
/// unsupported characters. The original server/tool identity is retained for
/// execution, so this only changes the LLM-facing function name.
pub struct McpToolProxy {
    /// Display name used for registration (may be prefixed)
    display_name: String,
    /// Original tool name on the MCP server
    tool_name: String,
    /// Server this tool belongs to
    server_name: String,
    description: String,
    input_schema: JsonSchema,
    manager: Arc<McpManager>,
    /// Whether this tool's schema should be deferred (sent as name-only stub).
    deferred: bool,
}

impl McpToolProxy {
    pub fn new(
        display_name: String,
        tool_name: String,
        server_name: String,
        description: String,
        input_schema: JsonSchema,
        manager: Arc<McpManager>,
        deferred: bool,
    ) -> Self {
        Self {
            display_name,
            tool_name,
            server_name,
            description,
            input_schema,
            manager,
            deferred,
        }
    }
}

#[async_trait]
impl Tool for McpToolProxy {
    fn name(&self) -> &str {
        &self.display_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> JsonSchema {
        self.input_schema.clone()
    }

    fn is_concurrency_safe(&self, _input: &Value) -> bool {
        // MCP tools are assumed not concurrency-safe
        false
    }

    fn is_deferred(&self) -> bool {
        self.deferred
    }

    async fn execute(&self, input: Value) -> ToolResult {
        match self.manager.call_tool(&self.server_name, &self.tool_name, input).await {
            Ok(content) => ToolResult {
                content,
                is_error: false,
            },
            Err(e) => ToolResult {
                content: format!("MCP tool error: {}", e),
                is_error: true,
            },
        }
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Mcp
    }

    fn describe(&self, input: &Value) -> String {
        format!(
            "MCP {}/{}: {}",
            self.server_name,
            self.tool_name,
            serde_json::to_string(input).unwrap_or_default()
        )
    }
}

/// Register all MCP tools into the tool registry, handling name collisions.
///
/// Strategy:
/// - If tool name doesn't collide with built-in or other MCP tools → use as-is
/// - If collision detected → prefix with "mcp__{server_name}__"
///
/// Each tool's deferred flag is read from the server's config:
/// `McpServerConfig::deferred` — defaults to `true` when absent.
pub fn register_mcp_tools(
    registry: &mut winkgo_agent_tools::registry::ToolRegistry,
    manager: &Arc<McpManager>,
    builtin_names: &[String],
    server_configs: &HashMap<String, McpServerConfig>,
) {
    let all_tools = manager.all_tools();

    // Determine which names need prefixing
    for (server_name, tool_def) in &all_tools {
        let original_name = &tool_def.name;

        // Check collision with built-in tools
        let normalized_name = normalize_provider_tool_name(original_name);
        let collides_builtin = builtin_names
            .iter()
            .any(|name| name == original_name || normalize_provider_tool_name(name) == normalized_name);

        // Check collision with other MCP servers' tools
        let cross_server_collision = manager.tool_name_count(original_name) > 1;
        let normalized_collision = all_tools
            .iter()
            .filter(|(_, candidate)| normalize_provider_tool_name(&candidate.name) == normalized_name)
            .count()
            > 1;

        let display_name = provider_safe_tool_name(
            server_name,
            original_name,
            collides_builtin || cross_server_collision || normalized_collision,
        );

        // MCP tools are deferred by default; server config can override.
        let deferred = server_configs
            .get(*server_name)
            .and_then(|c| c.deferred)
            .unwrap_or(true);

        let proxy = McpToolProxy::new(
            display_name,
            original_name.clone(),
            server_name.to_string(),
            tool_def.description.clone().unwrap_or_default(),
            tool_def.input_schema.clone(),
            Arc::clone(manager),
            deferred,
        );

        registry.register(Box::new(proxy));
    }
}

/// Register tools from a single newly-connected MCP server.
/// Uses the same collision-detection logic as `register_mcp_tools`.
pub fn register_single_server_tools(
    registry: &mut winkgo_agent_tools::registry::ToolRegistry,
    manager: &Arc<McpManager>,
    server_name: &str,
    builtin_names: &[String],
    deferred: bool,
) {
    let all_tools = manager.all_tools();
    let server_tools: Vec<_> = all_tools.iter().filter(|(sn, _)| *sn == server_name).collect();

    for (_, tool_def) in &server_tools {
        let original_name = &tool_def.name;
        let normalized_name = normalize_provider_tool_name(original_name);
        let collides_builtin = builtin_names
            .iter()
            .any(|name| name == original_name || normalize_provider_tool_name(name) == normalized_name);
        let cross_server_collision = manager.tool_name_count(original_name) > 1;
        let normalized_collision = all_tools
            .iter()
            .filter(|(_, candidate)| normalize_provider_tool_name(&candidate.name) == normalized_name)
            .count()
            > 1;

        let display_name = provider_safe_tool_name(
            server_name,
            original_name,
            collides_builtin || cross_server_collision || normalized_collision,
        );

        let proxy = McpToolProxy::new(
            display_name,
            original_name.clone(),
            server_name.to_string(),
            tool_def.description.clone().unwrap_or_default(),
            tool_def.input_schema.clone(),
            Arc::clone(manager),
            deferred,
        );

        registry.register(Box::new(proxy));
    }
}

#[cfg(test)]
#[path = "tool_proxy_test.rs"]
mod tool_proxy_test;
