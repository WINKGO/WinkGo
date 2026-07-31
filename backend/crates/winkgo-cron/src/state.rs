// Modified from AionCore by WINK GO contributors in 2026.
use std::sync::Arc;

use winkgo_conversation::ConversationService;

use crate::service::CronService;

#[derive(Clone)]
pub struct CronRouterState {
    pub cron_service: Arc<CronService>,
    pub conversation_service: ConversationService,
}
