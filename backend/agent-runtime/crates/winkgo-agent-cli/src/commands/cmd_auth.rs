use winkgo_agent_config::auth::{AuthConfig, OAuthManager};

use crate::cli::AuthAction;

pub(crate) async fn run(action: AuthAction) -> anyhow::Result<()> {
    let oauth = OAuthManager::new(AuthConfig::default());
    match action {
        AuthAction::Login => {
            oauth.login().await?;
            eprintln!("Login successful! You can now use winkgo_agent without --api-key.");
            Ok(())
        }
        AuthAction::Logout => oauth.logout(),
    }
}
