// Modified from aionrs by WINK GO contributors in 2026.
use winkgo_agent_config::config;

use crate::cli::ConfigAction;

pub(crate) fn run(action: ConfigAction) -> anyhow::Result<()> {
    match action {
        ConfigAction::Init => config::init_config(),
        ConfigAction::Path => {
            println!("{}", config::global_config_path().display());
            Ok(())
        }
    }
}
