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
    BotInfo, MessageContentType, PluginConfig, PluginStatus, PluginType, UnifiedAttachment, UnifiedIncomingMessage,
    UnifiedMessageContent, UnifiedOutgoingMessage, UnifiedUser,
};

const DISCORD_API: &str = "https://discord.com/api/v10";
const GATEWAY_INTENTS: u64 = 512 | 4096 | 32768;
const MAX_MESSAGE_LENGTH: usize = 2_000;

#[derive(Clone)]
struct DiscordApi {
    client: Client,
    token: String,
}

impl DiscordApi {
    async fn request_json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, ChannelError> {
        let mut request = self
            .client
            .request(method, format!("{DISCORD_API}{path}"))
            .header("Authorization", format!("Bot {}", self.token));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|e| ChannelError::ConnectionFailed(format!("Discord request failed: {e}")))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|e| ChannelError::PlatformApi(format!("Discord returned invalid JSON: {e}")))?;
        if !status.is_success() {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown Discord API error");
            return Err(ChannelError::PlatformApi(message.to_owned()));
        }
        Ok(value)
    }

    async fn current_user(&self) -> Result<Value, ChannelError> {
        self.request_json(reqwest::Method::GET, "/users/@me", None).await
    }

    async fn gateway_url(&self) -> Result<String, ChannelError> {
        let value = self.request_json(reqwest::Method::GET, "/gateway/bot", None).await?;
        value
            .get("url")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| ChannelError::PlatformApi("Discord did not return a Gateway URL".into()))
    }

    async fn send_message(&self, channel_id: &str, text: &str) -> Result<String, ChannelError> {
        let value = self
            .request_json(
                reqwest::Method::POST,
                &format!("/channels/{channel_id}/messages"),
                Some(json!({"content": truncate(text, MAX_MESSAGE_LENGTH)})),
            )
            .await?;
        value
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| ChannelError::MessageSendFailed("Discord did not return a message id".into()))
    }

    async fn edit_message(&self, channel_id: &str, message_id: &str, text: &str) -> Result<(), ChannelError> {
        self.request_json(
            reqwest::Method::PATCH,
            &format!("/channels/{channel_id}/messages/{message_id}"),
            Some(json!({"content": truncate(text, MAX_MESSAGE_LENGTH)})),
        )
        .await?;
        Ok(())
    }
}

pub struct DiscordPlugin {
    status: PluginStatus,
    bot_info: Option<BotInfo>,
    last_error: Option<String>,
    api: Option<Arc<DiscordApi>>,
    callbacks: Option<PluginCallbacks>,
    gateway_handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<watch::Sender<bool>>,
}

impl Default for DiscordPlugin {
    fn default() -> Self {
        Self {
            status: PluginStatus::Created,
            bot_info: None,
            last_error: None,
            api: None,
            callbacks: None,
            gateway_handle: None,
            shutdown_tx: None,
        }
    }
}

impl DiscordPlugin {
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
impl ChannelPlugin for DiscordPlugin {
    async fn initialize(&mut self, config: PluginConfig, callbacks: PluginCallbacks) -> Result<(), ChannelError> {
        self.status = PluginStatus::Initializing;
        let token = match config
            .credentials
            .token
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(value) => value.to_owned(),
            None => return Err(self.fail_config("Missing Discord Bot Token")),
        };
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("WINK-GO/1.0")
            .build()
            .map_err(|e| ChannelError::ConnectionFailed(format!("Discord HTTP client init failed: {e}")))?;
        let api = Arc::new(DiscordApi { client, token });
        let me = api.current_user().await.map_err(|e| {
            self.status = PluginStatus::Error;
            self.last_error = Some(e.to_string());
            e
        })?;
        let id = me.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
        let username = me.get("username").and_then(Value::as_str).map(str::to_owned);
        let display_name = me
            .get("global_name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| username.clone())
            .unwrap_or_else(|| "WINK GO Discord Bot".into());
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
        if self.gateway_handle.is_some() {
            self.status = PluginStatus::Running;
            return Ok(());
        }
        let api = self
            .api
            .as_ref()
            .cloned()
            .ok_or_else(|| ChannelError::PlatformApi("Discord plugin not initialized".into()))?;
        let gateway_url = api.gateway_url().await.map_err(|e| {
            self.status = PluginStatus::Error;
            self.last_error = Some(e.to_string());
            e
        })?;
        let bot_id = self.bot_info.as_ref().map(|b| b.id.clone()).unwrap_or_default();
        let callbacks = self
            .callbacks
            .clone()
            .ok_or_else(|| ChannelError::PlatformApi("Discord callbacks not initialized".into()))?;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.shutdown_tx = Some(shutdown_tx);
        self.gateway_handle = Some(tokio::spawn(discord_gateway_loop(
            api,
            gateway_url,
            bot_id,
            callbacks,
            shutdown_rx,
        )));
        self.status = PluginStatus::Running;
        info!("Discord Gateway channel started");
        Ok(())
    }

    async fn stop(&mut self) -> Result<(), ChannelError> {
        self.status = PluginStatus::Stopping;
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = self.gateway_handle.take() {
            let _ = tokio::time::timeout(Duration::from_secs(5), handle).await;
        }
        self.status = PluginStatus::Stopped;
        Ok(())
    }

    async fn send_message(&self, chat_id: &str, message: UnifiedOutgoingMessage) -> Result<String, ChannelError> {
        self.api
            .as_ref()
            .ok_or_else(|| ChannelError::PlatformApi("Discord plugin not initialized".into()))?
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
            .ok_or_else(|| ChannelError::PlatformApi("Discord plugin not initialized".into()))?
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
        PluginType::Discord
    }
    fn status(&self) -> PluginStatus {
        self.status
    }
    fn last_error(&self) -> Option<&str> {
        self.last_error.as_deref()
    }
}

async fn discord_gateway_loop(
    api: Arc<DiscordApi>,
    mut url: String,
    bot_id: String,
    callbacks: PluginCallbacks,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let mut failures = 0u32;
    loop {
        if *shutdown_rx.borrow() {
            break;
        }
        match run_gateway(&url, &api.token, &bot_id, &callbacks, &mut shutdown_rx).await {
            Ok(()) if *shutdown_rx.borrow() => break,
            Ok(()) => failures = 0,
            Err(error) => {
                failures = failures.saturating_add(1);
                warn!(%error, "Discord Gateway disconnected");
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(2u64.saturating_pow(failures.min(4)))) => {},
            _ = shutdown_rx.changed() => break,
        }
        match api.gateway_url().await {
            Ok(next) => url = next,
            Err(error) => warn!(%error, "Discord Gateway URL refresh failed"),
        }
    }
    debug!("Discord Gateway loop exited");
}

async fn run_gateway(
    base_url: &str,
    token: &str,
    bot_id: &str,
    callbacks: &PluginCallbacks,
    shutdown_rx: &mut watch::Receiver<bool>,
) -> Result<(), ChannelError> {
    let url = format!("{}?v=10&encoding=json", base_url.trim_end_matches('/'));
    let (stream, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| ChannelError::ConnectionFailed(format!("Discord Gateway connect failed: {e}")))?;
    let (mut write, mut read) = stream.split();
    let hello = tokio::time::timeout(Duration::from_secs(15), read.next())
        .await
        .map_err(|_| ChannelError::ConnectionFailed("Discord Gateway hello timed out".into()))?
        .ok_or_else(|| ChannelError::ConnectionFailed("Discord Gateway closed before hello".into()))?
        .map_err(|e| ChannelError::ConnectionFailed(format!("Discord Gateway hello failed: {e}")))?;
    let hello_value = parse_text_frame(hello)?;
    if hello_value.get("op").and_then(Value::as_i64) != Some(10) {
        return Err(ChannelError::ConnectionFailed(
            "Discord Gateway returned an invalid hello".into(),
        ));
    }
    let heartbeat_ms = hello_value
        .pointer("/d/heartbeat_interval")
        .and_then(Value::as_u64)
        .ok_or_else(|| ChannelError::ConnectionFailed("Discord Gateway omitted heartbeat interval".into()))?;
    write.send(WsMessage::Text(json!({"op":2,"d":{"token":token,"intents":GATEWAY_INTENTS,"properties":{"os":"windows","browser":"WINK GO","device":"WINK GO"}}}).to_string().into())).await.map_err(|e| ChannelError::ConnectionFailed(format!("Discord identify failed: {e}")))?;
    let mut heartbeat = tokio::time::interval(Duration::from_millis(heartbeat_ms));
    heartbeat.tick().await;
    let mut sequence: Option<i64> = None;
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                write.send(WsMessage::Text(json!({"op":1,"d":sequence}).to_string().into())).await.map_err(|e| ChannelError::ConnectionFailed(format!("Discord heartbeat failed: {e}")))?;
            }
            frame = read.next() => match frame {
                Some(Ok(WsMessage::Text(text))) => {
                    let value: Value = serde_json::from_str(&text)?;
                    if let Some(seq) = value.get("s").and_then(Value::as_i64) { sequence = Some(seq); }
                    match value.get("op").and_then(Value::as_i64) {
                        Some(0) if value.get("t").and_then(Value::as_str) == Some("MESSAGE_CREATE") => {
                            if let Some(message) = value.get("d").and_then(|event| parse_gateway_message(event, bot_id)) {
                                let _ = callbacks.message_tx.send(message).await;
                            }
                        }
                        Some(7 | 9) => return Err(ChannelError::ConnectionFailed("Discord Gateway requested reconnect".into())),
                        Some(1) => { write.send(WsMessage::Text(json!({"op":1,"d":sequence}).to_string().into())).await.map_err(|e| ChannelError::ConnectionFailed(format!("Discord heartbeat response failed: {e}")))?; }
                        _ => {}
                    }
                }
                Some(Ok(WsMessage::Ping(data))) => { write.send(WsMessage::Pong(data)).await.map_err(|e| ChannelError::ConnectionFailed(format!("Discord pong failed: {e}")))?; }
                Some(Ok(WsMessage::Close(_))) | None => return Ok(()),
                Some(Err(e)) => return Err(ChannelError::ConnectionFailed(format!("Discord Gateway read failed: {e}"))),
                _ => {}
            },
            _ = shutdown_rx.changed() => return Ok(()),
        }
    }
}

fn parse_text_frame(frame: WsMessage) -> Result<Value, ChannelError> {
    match frame {
        WsMessage::Text(text) => Ok(serde_json::from_str(&text)?),
        _ => Err(ChannelError::ConnectionFailed(
            "Discord Gateway returned a non-text hello".into(),
        )),
    }
}

fn parse_gateway_message(event: &Value, bot_id: &str) -> Option<UnifiedIncomingMessage> {
    let author = event.get("author")?;
    let author_id = author.get("id")?.as_str()?;
    if author_id == bot_id || author.get("bot").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let attachments = event
        .get("attachments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(UnifiedAttachment {
                        file_id: item.get("id").and_then(Value::as_str).map(str::to_owned),
                        file_name: item.get("filename").and_then(Value::as_str).map(str::to_owned),
                        mime_type: item.get("content_type").and_then(Value::as_str).map(str::to_owned),
                        file_size: item.get("size").and_then(Value::as_u64),
                        url: item.get("url").and_then(Value::as_str).map(str::to_owned),
                    })
                })
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty());
    Some(UnifiedIncomingMessage {
        id: event.get("id")?.as_str()?.to_owned(),
        platform: PluginType::Discord,
        chat_id: event.get("channel_id")?.as_str()?.to_owned(),
        user: UnifiedUser {
            id: author_id.to_owned(),
            username: author.get("username").and_then(Value::as_str).map(str::to_owned),
            display_name: author
                .get("global_name")
                .and_then(Value::as_str)
                .or_else(|| author.get("username").and_then(Value::as_str))
                .unwrap_or(author_id)
                .to_owned(),
            avatar_url: None,
        },
        content: UnifiedMessageContent {
            content_type: MessageContentType::Text,
            text: event
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            attachments,
        },
        timestamp: now_unix(),
        reply_to_message_id: event
            .pointer("/message_reference/message_id")
            .and_then(Value::as_str)
            .map(str::to_owned),
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

    fn empty_config() -> PluginConfig {
        PluginConfig {
            credentials: PluginCredentials {
                token: None,
                app_id: None,
                app_secret: None,
                encrypt_key: None,
                verification_token: None,
                client_id: None,
                client_secret: None,
                account_id: None,
                bot_token: None,
                extra: HashMap::new(),
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
        let mut plugin = DiscordPlugin::new();
        let result = plugin.initialize(empty_config(), callbacks()).await;
        assert!(matches!(result, Err(ChannelError::InvalidConfig(_))));
        assert_eq!(plugin.status(), PluginStatus::Error);
    }

    #[test]
    fn parses_human_gateway_message() {
        let value = json!({"id":"M1","channel_id":"C1","content":"hello","author":{"id":"U1","username":"alice","bot":false},"attachments":[]});
        let message = parse_gateway_message(&value, "BOT").expect("message");
        assert_eq!(message.platform, PluginType::Discord);
        assert_eq!(message.chat_id, "C1");
        assert_eq!(message.user.display_name, "alice");
    }

    #[test]
    fn ignores_own_bot_message() {
        let value =
            json!({"id":"M1","channel_id":"C1","content":"hello","author":{"id":"BOT","username":"winkgo","bot":true}});
        assert!(parse_gateway_message(&value, "BOT").is_none());
    }
}
