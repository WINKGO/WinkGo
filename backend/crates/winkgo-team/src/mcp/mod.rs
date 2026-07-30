pub mod bridge;
pub mod protocol;
pub mod server;
pub mod tools;

pub use bridge::{TeamMcpStdioConfig, TeamMcpStdioServerSpec};
pub use server::TeamMcpServer;
pub use winkgo_api_types::TEAM_MCP_SERVER_NAME;
