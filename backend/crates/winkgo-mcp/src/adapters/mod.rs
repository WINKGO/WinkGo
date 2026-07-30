mod claude;
mod cli_helpers;
mod codebuddy;
mod codex;
mod gemini;
mod opencode;
mod qwen;
mod winkgo;
mod winkgo_agent;

pub use claude::ClaudeAdapter;
pub use codebuddy::CodeBuddyAdapter;
pub use codex::CodexAdapter;
pub use gemini::GeminiAdapter;
pub use opencode::OpencodeAdapter;
pub use qwen::QwenAdapter;
pub use winkgo::WinkGouiAdapter;
pub use winkgo_agent::WinkGoAgentAdapter;
