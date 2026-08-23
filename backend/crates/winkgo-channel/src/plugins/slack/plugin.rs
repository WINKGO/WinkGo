// Modified from AionCore by WINK GO contributors in 2026.
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{debug, info, warn};

use crate::error::ChannelError;
use crate::plugin::{ChannelPlugin, PluginCallbacks};
use crate::types::{
    BotInfo, MessageContentType, PluginConfig, PluginStatus, PluginType, UnifiedIncomingMessage, UnifiedMessageContent,
    UnifiedOutgoingMessage, UnifiedUser,
};

const SLACK_API: &str = "https://slack.com/api";
const MAX_MESSAGE_LENGTH: usize = 40_000;

#[derive(Clone)]
struct SlackApi {
    client: Client,
    bot_token: String,
    app_token: Option<String>,
}

impl SlackApi {
    async fn call(&self, method: &str, token: &str, body: Value) -> Result<Value, ChannelError> {
        let response = self
            .client
            .post(format!("{SLACK_API}/{method}"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| ChannelError::ConnectionFailed(format!("Slack request failed: {e}")))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|e| ChannelError::PlatformApi(format!("Slack returned invalid JSON: {e}")))?;
        if !status.is_success() || value.get("ok").and_then(Value::as_bool) != Some(true) {
            let message = value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown Slack API error");
            return Err(ChannelError::PlatformApi(message.to_owned()));
        }
        Ok(value)
    }

    async fn auth_test(&self) -> Result<Value, ChannelError> {
        self.call("auth.test", &self.bot_token, json!({})).await
    }

    async fn open_socket(&self) -> Result<String, ChannelError> {
        let app_token = self
            .app_token
            .as_deref()
            .ok_or_else(|| ChannelError::InvalidConfig("Missing Slack App-Level Token (xapp-)".into()))?;
        let value = self.call("apps.connections.open", app_token, json!({})).await?;
        value
            .get("url")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| ChannelError::PlatformApi("Slack did not return a Socket Mode URL".into()))
    }

    async fn send_message(&self, chat_id: &str, text: &str) -> Result<String, ChannelError> {
        let value = self
            .call(
                "chat.postMessage",
                &self.bot_token,
                json!({"channel": chat_id, "text": truncate(text, MAX_MESSAGE_LENGTH)}),
            )
            .await?;
        value
            .get("ts")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| ChannelError::MessageSendFailed("Slack did not return a message id".into()))
    }

    async fn edit_message(&self, chat_id: &str, message_id: &str, text: &str) -> Result<(), ChannelError> {
        self.call(
            "chat.update",
            &self.bot_token,
            json!({"channel": chat_id, "ts": message_id, "text": truncate(text, MAX_MESSAGE_LENGTH)}),
        )
        .await?;
        Ok(())
    }
}

pub struct SlackPlugin {
    status: PluginStatus,
    bot_info: Option<BotInfo>,
    last_error: Option<String>,
    api: Option<Arc<SlackApi>>,
    callbacks: Option<PluginCallbacks>,
    ws_handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<watch::Sender<bool>>,
}

impl Default for SlackPlugin {
    fn default() -> Self {
        Self {
            status: PluginStatus::Created,
            bot_info: None,
            last_error: None,
            api: None,
            callbacks: None,
            ws_handle: None,
            shutdown_tx: None,
        }
    }
}

impl SlackPlugin {
    pub fn new() -> Self {
        Self::default()
    }

    fn fail_config(&mut self, message: &str) -> ChannelError {
        self.status = PluginStatus::Error;
        self.last_error = Some(message.to_owned());
        ChannelError::InvalidConfig(message.to_owned())
    }
}

#[async_trait::async_trait]
impl ChannelPlugin for SlackPlugin {
    async fn initialize(&mut self, config: PluginConfig, callbacks: PluginCallbacks) -> Result<(), ChannelError> {
        self.status = PluginStatus::Initializing;
        let bot_token = match config
            .credentials
            .token
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(value) => value.to_owned(),
            None => return Err(self.fail_config("Missing Slack Bot Token (xoxb-)")),
        };
        if !bot_token.starts_with("xoxb-") {
            return Err(self.fail_config("Slack Bot Token must start with xoxb-"));
        }
        let app_token = config
            .credentials
            .extra
            .get("app_token")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_owned);
        if let Some(value) = app_token.as_deref()
            && !value.starts_with("xapp-")
        {
            return Err(self.fail_config("Slack App-Level Token must start with xapp-"));
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| ChannelError::ConnectionFailed(format!("Slack HTTP client init failed: {e}")))?;
        let api = Arc::new(SlackApi {
            client,
            bot_token,
            app_token,
        });
        let me = api.auth_test().await.map_err(|e| {
            self.status = PluginStatus::Error;
            self.last_error = Some(e.to_string());
            e
        })?;
        let id = me.get("user_id").and_then(Value::as_str).unwrap_or_default().to_owned();
        let username = me.get("user").and_then(Value::as_str).map(str::to_owned);
        let display_name = username.clone().unwrap_or_else(|| "WINK GO Slack Bot".into());
        self.bot_info = Some(BotInfo {
            id,
            username,
            display_name,
        });
        self.api = Some(api);
        self.callbacks = Some(callbacks);
        self.status = PluginStatus::Ready;
        Ok(())
    }

    async fn start(&mut self) -> Result<(), ChannelError> {
        self.status = PluginStatus::Starting;
        if self.ws_handle.is_some() {
            self.status = PluginStatus::Running;
            return Ok(());
        }
        let api = self
            .api
            .as_ref()
            .cloned()
            .ok_or_else(|| ChannelError::PlatformApi("Slack plugin not initialized".into()))?;
        // Fail before reporting Running when Socket Mode credentials are invalid.
        let first_url = api.open_socket().await.map_err(|e| {
            self.status = PluginStatus::Error;
            self.last_error = Some(e.to_string());
            e
        })?;
        let callbacks = self
            .callbacks
            .clone()
            .ok_or_else(|| ChannelError::PlatformApi("Slack callbacks not initialized".into()))?;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.shutdown_tx = Some(shutdown_tx);
        self.ws_handle = Some(tokio::spawn(slack_socket_loop(api, first_url, callbacks, shutdown_rx)));
        self.status = PluginStatus::Running;
        info!("Slack Socket Mode channel started");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.status = PluginStatus::Stopping;
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.ws_handle.take() {
            let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
        }
        self.status = PluginStatus::Stopped;
        Ok(())
    }

    async fn send_message(&self, chat_id: &str, message: UnifiedOutgoingMessage) -> Result<String, ChannelError> {
        self.api
            .as_ref()
            .ok_or_else(|| ChannelError::PlatformApi("Slack plugin not initialized".into()))?
            .send_message(chat_id, message.text.as_deref().unwrap_or(""))
            .await
    }

    async fn edit_message(
        &self,
        chat_id: &str,
        message_id: &str,
        message: UnifiedOutgoingMessage,
    ) -> Result<(), ChannelError> {
        self.api
            .as_ref()
            .ok_or_else(|| ChannelError::PlatformApi("Slack plugin not initialized".into()))?
            .edit_message(chat_id, message_id, message.text.as_deref().unwrap_or(""))
            .await
    }

    fn active_user_count(&self) -> usize {
        0
    }
    fn bot_info(&self) -> Option<&BotInfo> {
        self.bot_info.as_ref()
    }
    fn plugin_type(&self) -> PluginType {
        PluginType::Slack
    }
    fn status(&self) -> PluginStatus {
        self.status
    }
    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

async fn slack_socket_loop(
    api: Arc<SlackApi>,
    mut url: String,
    callbacks: PluginCallbacks,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let mut failures = 0u32;
    loop {
        if *shutdown_rx.borrow() {
            break;
        }
        match run_slack_socket(&url, &callbacks, &mut shutdown_rx).await {
            Ok(()) if *shutdown_rx.borrow() => break,
            Ok(()) => failures = 0,
            Err(error) => {
                failures = failures.saturating_add(1);
                warn!(%error, "Slack Socket Mode disconnected");
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(2u64.saturating_pow(failures.min(4)))) => {},
            _ = shutdown_rx.changed() => break,
        }
        match api.open_socket().await {
            Ok(next) => url = next,
            Err(error) => warn!(%error, "Slack Socket Mode reconnect URL failed"),
        }
    }
    debug!("Slack Socket Mode loop exited");
}

async fn run_slack_socket(
    url: &str,
    callbacks: &PluginCallbacks,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<(), ChannelError> {
    let (stream, _) = tokio_tungstenite::connect_async(url)
        .await
        .map_err(|e| ChannelError::ConnectionFailed(format!("Slack WebSocket connect failed: {e}")))?;
    let (mut write, mut read) = stream.split();
    loop {
        tokio::select! {
            frame = read.next() => match frame {
                Some(Ok(WsMessage::Text(text))) => {
                    let value: Value = serde_json::from_str(&text)?;
                    if let Some(envelope_id) = value.get("envelope_id").and_then(Value::as_str) {
                        write.send(WsMessage::Text(json!({"envelope_id": envelope_id}).to_string().into()))
                            .await.map_err(|e| ChannelError::ConnectionFailed(format!("Slack ack failed: {e}")))?;
                    }
                    if let Some(message) = parse_socket_message(&value) {
                        let _ = callbacks.message_tx.send(message).await;
                    }
                }
                Some(Ok(WsMessage::Ping(data))) => {
                    write.send(WsMessage::Pong(data)).await.map_err(|e| ChannelError::ConnectionFailed(format!("Slack pong failed: {e}")))?;
                }
                Some(Ok(WsMessage::Close(_))) | None => return Ok(()),
                Some(Err(e)) => return Err(ChannelError::ConnectionFailed(format!("Slack WebSocket read failed: {e}"))),
                _ => {}
            },
            _ = shutdown_rx.changed() => return Ok(()),
        }
    }
}

fn parse_socket_message(envelope: &Value) -> Option<UnifiedIncomingMessage> {
    if envelope.get("type")?.as_str()? != "events_api" {
        return None;
    }
    let event = envelope.get("payload")?.get("event")?;
    if event.get("type")?.as_str()? != "message" || event.get("bot_id").is_some() || event.get("subtype").is_some() {
        return None;
    }
    let id = event.get("ts")?.as_str()?.to_owned();
    let chat_id = event.get("channel")?.as_str()?.to_owned();
    let user_id = event.get("user")?.as_str()?.to_owned();
    let text = event.get("text").and_then(Value::as_str).unwrap_or_default().to_owned();
    Some(UnifiedIncomingMessage {
        id,
        platform: PluginType::Slack,
        chat_id,
        user: UnifiedUser {
            id: user_id.clone(),
            username: Some(user_id.clone()),
            display_name: user_id,
            avatar_url: None,
        },
        content: UnifiedMessageContent {
            content_type: MessageContentType::Text,
            text,
            attachments: None,
        },
        timestamp: now_unix(),
        reply_to_message_id: event.get("thread_ts").and_then(Value::as_str).map(str::to_owned),
        action: None,
        raw: Some(event.clone()),
    })
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}
fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use tokio::sync::mpsc;

    use crate::types::PluginCredentials;

    fn config(token: Option<&str>, app_token: Option<&str>) -> PluginConfig {
        let mut extra = HashMap::new();
        if let Some(value) = app_token {
            extra.insert("app_token".to_owned(), json!(value));
        }
        PluginConfig {
            credentials: PluginCredentials {
                token: token.map(str::to_owned),
                app_id: None,
                app_secret: None,
                encrypt_key: None,
                verification_token: None,
                client_id: None,
                client_secret: None,
                account_id: None,
                bot_token: None,
                extra,
            },
            config: None,
        }
    }

    fn callbacks() -> PluginCallbacks {
        let (message_tx, _) = mpsc::channel(1);
        let (confirm_tx, _) = mpsc::channel(1);
        PluginCallbacks { message_tx, confirm_tx }
    }

    #[tokio::test]
    async fn rejects_missing_bot_token_without_network_access() {
        let mut plugin = SlackPlugin::new();
        let result = plugin.initialize(config(None, Some("xapp-test")), callbacks()).await;
        assert!(matches!(result, Err(ChannelError::InvalidConfig(_))));
        assert_eq!(plugin.status(), PluginStatus::Error);
    }

    #[tokio::test]
    async fn rejects_invalid_app_token_without_network_access() {
        let mut plugin = SlackPlugin::new();
        let result = plugin
            .initialize(config(Some("xoxb-test"), Some("wrong")), callbacks())
            .await;
        assert!(matches!(result, Err(ChannelError::InvalidConfig(_))));
        assert_eq!(plugin.status(), PluginStatus::Error);
    }

    #[test]
    fn parses_human_socket_mode_message() {
        let value = json!({"type":"events_api","payload":{"event":{"type":"message","channel":"C1","user":"U1","text":"hello","ts":"171.1"}}});
        let message = parse_socket_message(&value).expect("message");
        assert_eq!(message.platform, PluginType::Slack);
        assert_eq!(message.chat_id, "C1");
        assert_eq!(message.content.text, "hello");
    }

    #[test]
    fn ignores_bot_messages() {
        let value = json!({"type":"events_api","payload":{"event":{"type":"message","channel":"C1","user":"U1","text":"hello","ts":"171.1","bot_id":"B1"}}});
        assert!(parse_socket_message(&value).is_none());
    }
}
