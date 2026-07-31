// Modified from aionrs by WINK GO contributors in 2026.
use async_trait::async_trait;

use super::{CommandContext, CommandResult, SlashCommand};
use crate::compact::state::CompactState;

pub struct ClearCommand;

#[async_trait]
impl SlashCommand for ClearCommand {
    fn name(&self) -> &str {
        "clear"
    }

    fn description(&self) -> &str {
        "Clear conversation history"
    }

    async fn execute(&self, ctx: &mut CommandContext<'_>, _args: &str) -> anyhow::Result<CommandResult> {
        ctx.messages.clear();
        *ctx.compact_state = CompactState::new();
        ctx.output.emit_info("Conversation cleared");
        Ok(CommandResult::Continue)
    }
}

#[cfg(test)]
#[path = "clear_test.rs"]
mod clear_test;
