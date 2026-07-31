// Modified from AionCore by WINK GO contributors in 2026.
use std::sync::Arc;

use winkgo_api_types::{
    RuntimeFailureKind, RuntimeResourceKind, RuntimeStatusPayload, RuntimeStatusPhase, RuntimeStatusScope,
    RuntimeStatusScopeKind, WebSocketMessage,
};
use winkgo_realtime::EventBroadcaster;
use winkgo_runtime::{NodeRuntimeFailureKind, NodeRuntimeProgress, SharedNodeRuntimeProgressReporter};

pub(crate) fn conversation_runtime_reporter(
    broadcaster: Arc<dyn EventBroadcaster>,
    conversation_id: impl Into<String>,
) -> SharedNodeRuntimeProgressReporter {
    node_runtime_reporter(
        broadcaster,
        RuntimeStatusScope {
            kind: RuntimeStatusScopeKind::Conversation,
            id: conversation_id.into(),
        },
    )
}

pub(crate) fn custom_agent_runtime_reporter(
    broadcaster: Arc<dyn EventBroadcaster>,
    scope_id: impl Into<String>,
) -> SharedNodeRuntimeProgressReporter {
    node_runtime_reporter(
        broadcaster,
        RuntimeStatusScope {
            kind: RuntimeStatusScopeKind::CustomAgent,
            id: scope_id.into(),
        },
    )
}

fn node_runtime_reporter(
    broadcaster: Arc<dyn EventBroadcaster>,
    scope: RuntimeStatusScope,
) -> SharedNodeRuntimeProgressReporter {
    Arc::new(move |update: NodeRuntimeProgress| {
        let payload = RuntimeStatusPayload {
            resource: RuntimeResourceKind::Node,
            resource_id: None,
            scope: scope.clone(),
            phase: map_phase(update.phase),
            failure_kind: update.failure_kind.map(map_failure_kind),
            message: update.message,
            status_code: update.status_code,
        };
        let payload = serde_json::to_value(payload).expect("runtime status payload should serialize");
        broadcaster.broadcast(WebSocketMessage::new("runtime.statusChanged", payload));
    })
}

fn map_phase(phase: winkgo_runtime::NodeRuntimeProgressPhase) -> RuntimeStatusPhase {
    match phase {
        winkgo_runtime::NodeRuntimeProgressPhase::WaitingForLock => RuntimeStatusPhase::WaitingForLock,
        winkgo_runtime::NodeRuntimeProgressPhase::Downloading => RuntimeStatusPhase::Downloading,
        winkgo_runtime::NodeRuntimeProgressPhase::Extracting => RuntimeStatusPhase::Extracting,
        winkgo_runtime::NodeRuntimeProgressPhase::Validating => RuntimeStatusPhase::Validating,
        winkgo_runtime::NodeRuntimeProgressPhase::Ready => RuntimeStatusPhase::Ready,
        winkgo_runtime::NodeRuntimeProgressPhase::Failed => RuntimeStatusPhase::Failed,
    }
}

fn map_failure_kind(kind: NodeRuntimeFailureKind) -> RuntimeFailureKind {
    match kind {
        NodeRuntimeFailureKind::Timeout => RuntimeFailureKind::Timeout,
        NodeRuntimeFailureKind::DownloadFailed => RuntimeFailureKind::DownloadFailed,
        NodeRuntimeFailureKind::HttpStatus => RuntimeFailureKind::HttpStatus,
        NodeRuntimeFailureKind::ChecksumMismatch => RuntimeFailureKind::ChecksumMismatch,
        NodeRuntimeFailureKind::ValidationFailed => RuntimeFailureKind::ValidationFailed,
        NodeRuntimeFailureKind::UnsupportedPlatform => RuntimeFailureKind::UnsupportedPlatform,
        NodeRuntimeFailureKind::BundledResourceMissing => RuntimeFailureKind::BundledResourceMissing,
        NodeRuntimeFailureKind::BundledResourceInvalid => RuntimeFailureKind::BundledResourceInvalid,
        NodeRuntimeFailureKind::Unknown => RuntimeFailureKind::Unknown,
    }
}
