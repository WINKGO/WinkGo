// Modified from aionrs by WINK GO contributors in 2026.
//! Top-level subcommand dispatch for the `winkgo` CLI binary.

use super::{cmd_config, cmd_session, cmd_skills};
use crate::cli::Commands;

pub(crate) async fn dispatch(cmd: Commands) -> anyhow::Result<()> {
    match cmd {
        Commands::Auth { .. } => anyhow::bail!("subscriber OAuth commands are not supported"),
        Commands::Config { action } => cmd_config::run(action),
        Commands::Session { action } => cmd_session::run(action),
        Commands::Skills { action } => cmd_skills::run(action),
    }
}
