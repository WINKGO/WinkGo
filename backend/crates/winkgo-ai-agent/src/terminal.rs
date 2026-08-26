// Modified from AionCore by WINK GO contributors in 2026.
// SPDX-License-Identifier: Apache-2.0
//! Client-hosted terminal service backing the ACP `terminal/*` methods.
//!
//! Delegated commands run inside the WINK GO process tree. Output is retained
//! for the live terminal card and one command can be stopped without killing
//! its owning Agent session.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::io::AsyncReadExt;
use tokio::process::Child;
use tokio::sync::{Mutex, watch};
use tracing::{info, warn};

pub const DEFAULT_OUTPUT_BYTE_LIMIT: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalExit {
    pub exit_code: Option<u32>,
    pub signaled: bool,
}

#[derive(Debug, Clone)]
pub struct TerminalOutputSnapshot {
    pub output: String,
    pub truncated: bool,
    pub exit: Option<TerminalExit>,
}

struct TerminalEntry {
    child: Arc<Mutex<Option<Child>>>,
    buffer: Arc<Mutex<OutputBuffer>>,
    exit_rx: watch::Receiver<Option<TerminalExit>>,
    exit_tx: watch::Sender<Option<TerminalExit>>,
    command_line: String,
}

struct OutputBuffer {
    data: String,
    truncated: bool,
    limit: usize,
}

impl OutputBuffer {
    fn push(&mut self, chunk: &str) {
        self.data.push_str(chunk);
        if self.data.len() > self.limit {
            let mut cut = self.data.len() - self.limit;
            while !self.data.is_char_boundary(cut) {
                cut += 1;
            }
            self.data.drain(..cut);
            self.truncated = true;
        }
    }
}

// Process-global ids avoid collisions after an Agent connection is rebuilt
// while its previous live card is still visible.
static NEXT_TERMINAL_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct TerminalRegistry {
    entries: Mutex<HashMap<String, TerminalEntry>>,
    label: String,
    default_cwd: Option<std::path::PathBuf>,
}

impl TerminalRegistry {
    pub fn new(label: impl Into<String>, default_cwd: Option<std::path::PathBuf>) -> Self {
        Self {
            label: label.into(),
            default_cwd,
            ..Self::default()
        }
    }
}

pub struct CreateTerminalParams {
    pub command: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<std::path::PathBuf>,
    pub output_byte_limit: Option<u64>,
}

impl TerminalRegistry {
    pub async fn create(&self, params: CreateTerminalParams) -> Result<String, String> {
        // Explicit args are executed verbatim. A bare command is interpreted by
        // the platform shell because several ACP agents send a compound line.
        let mut builder = if params.args.is_empty() {
            #[cfg(unix)]
            {
                let mut builder = winkgo_runtime::Builder::new("/bin/sh");
                builder.arg("-c").arg(&params.command);
                builder
            }
            #[cfg(windows)]
            {
                let mut builder = winkgo_runtime::Builder::new("cmd");
                builder.arg("/C").arg(&params.command);
                builder
            }
        } else {
            let mut builder = winkgo_runtime::Builder::new(&params.command);
            builder.args(&params.args);
            builder
        };
        builder
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        for (key, value) in &params.env {
            builder.env(key, value);
        }
        if let Some(cwd) = params.cwd.as_ref().or(self.default_cwd.as_ref()) {
            builder.current_dir(cwd);
        }
        let mut child = builder.spawn().map_err(|error| format!("spawn failed: {error}"))?;

        let id = format!("winkgo-term-{}", NEXT_TERMINAL_SEQ.fetch_add(1, Ordering::Relaxed) + 1);
        let command_line = std::iter::once(params.command.as_str())
            .chain(params.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        info!(
            conversation_id = %self.label,
            terminal_id = %id,
            command = %command_line,
            "client terminal created"
        );

        let limit = params.output_byte_limit.unwrap_or(DEFAULT_OUTPUT_BYTE_LIMIT) as usize;
        let buffer = Arc::new(Mutex::new(OutputBuffer {
            data: String::new(),
            truncated: false,
            limit: limit.max(1),
        }));
        let (exit_tx, exit_rx) = watch::channel(None);
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(Some(child)));

        let task_buffer = Arc::clone(&buffer);
        tokio::spawn(async move {
            let mut stdout = stdout;
            let mut stderr = stderr;
            let mut stdout_buffer = [0u8; 8192];
            let mut stderr_buffer = [0u8; 8192];
            let mut stdout_open = stdout.is_some();
            let mut stderr_open = stderr.is_some();
            while stdout_open || stderr_open {
                tokio::select! {
                    result = async { stdout.as_mut().expect("stdout exists while open").read(&mut stdout_buffer).await }, if stdout_open => {
                        match result {
                            Ok(0) | Err(_) => stdout_open = false,
                            Ok(size) => task_buffer.lock().await.push(&String::from_utf8_lossy(&stdout_buffer[..size])),
                        }
                    }
                    result = async { stderr.as_mut().expect("stderr exists while open").read(&mut stderr_buffer).await }, if stderr_open => {
                        match result {
                            Ok(0) | Err(_) => stderr_open = false,
                            Ok(size) => task_buffer.lock().await.push(&String::from_utf8_lossy(&stderr_buffer[..size])),
                        }
                    }
                }
            }
        });

        // Poll the direct child. A background descendant may keep its output
        // pipe open after the direct child exits, so EOF is not an exit signal.
        let reap_child = Arc::clone(&child);
        let reap_tx = exit_tx.clone();
        let reap_id = id.clone();
        tokio::spawn(async move {
            loop {
                {
                    let mut guard = reap_child.lock().await;
                    match guard.as_mut() {
                        Some(child) => match child.try_wait() {
                            Ok(Some(status)) => {
                                *guard = None;
                                #[cfg(unix)]
                                let signaled = {
                                    use std::os::unix::process::ExitStatusExt as _;
                                    status.signal().is_some()
                                };
                                #[cfg(not(unix))]
                                let signaled = false;
                                let _ = reap_tx.send(Some(TerminalExit {
                                    exit_code: status.code().map(|code| code as u32),
                                    signaled,
                                }));
                                return;
                            }
                            Ok(None) => {}
                            Err(error) => {
                                warn!(terminal_id = %reap_id, error = %error, "terminal wait failed");
                                *guard = None;
                                let _ = reap_tx.send(Some(TerminalExit {
                                    exit_code: None,
                                    signaled: false,
                                }));
                                return;
                            }
                        },
                        None => return,
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });

        self.entries.lock().await.insert(
            id.clone(),
            TerminalEntry {
                child,
                buffer,
                exit_rx,
                exit_tx,
                command_line,
            },
        );
        Ok(id)
    }

    pub async fn output(&self, terminal_id: &str) -> Option<TerminalOutputSnapshot> {
        let entries = self.entries.lock().await;
        let entry = entries.get(terminal_id)?;
        let buffer = entry.buffer.lock().await;
        Some(TerminalOutputSnapshot {
            output: buffer.data.clone(),
            truncated: buffer.truncated,
            exit: *entry.exit_rx.borrow(),
        })
    }

    pub async fn command_line(&self, terminal_id: &str) -> Option<String> {
        let entries = self.entries.lock().await;
        Some(entries.get(terminal_id)?.command_line.clone())
    }

    pub async fn wait_for_exit(&self, terminal_id: &str) -> Option<TerminalExit> {
        let mut receiver = {
            let entries = self.entries.lock().await;
            entries.get(terminal_id)?.exit_rx.clone()
        };
        loop {
            if let Some(exit) = *receiver.borrow() {
                return Some(exit);
            }
            if receiver.changed().await.is_err() {
                return (*receiver.borrow()).or(Some(TerminalExit {
                    exit_code: None,
                    signaled: true,
                }));
            }
        }
    }

    pub async fn kill(&self, terminal_id: &str, source: &str) -> bool {
        let Some((child, exit_tx)) = ({
            let entries = self.entries.lock().await;
            entries
                .get(terminal_id)
                .map(|entry| (Arc::clone(&entry.child), entry.exit_tx.clone()))
        }) else {
            return false;
        };
        let mut guard = child.lock().await;
        if let Some(child) = guard.as_mut() {
            info!(terminal_id, source, "client terminal killed");
            let _ = winkgo_runtime::kill_process_tree(child).await;
            *guard = None;
            let _ = exit_tx.send(Some(TerminalExit {
                exit_code: None,
                signaled: true,
            }));
        }
        true
    }

    pub async fn release(&self, terminal_id: &str) -> bool {
        let entry = self.entries.lock().await.remove(terminal_id);
        match entry {
            Some(entry) => {
                let mut guard = entry.child.lock().await;
                if let Some(child) = guard.as_mut() {
                    let _ = winkgo_runtime::kill_process_tree(child).await;
                    *guard = None;
                    let _ = entry.exit_tx.send(Some(TerminalExit {
                        exit_code: None,
                        signaled: true,
                    }));
                }
                true
            }
            None => false,
        }
    }

    pub async fn kill_all(&self) {
        let ids: Vec<String> = self.entries.lock().await.keys().cloned().collect();
        if !ids.is_empty() {
            info!(count = ids.len(), "tearing down all client terminals");
        }
        for id in ids {
            self.release(&id).await;
        }
    }

    pub async fn ids(&self) -> Vec<String> {
        self.entries.lock().await.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(command: &str, args: &[&str]) -> CreateTerminalParams {
        CreateTerminalParams {
            command: command.into(),
            args: args.iter().map(|value| value.to_string()).collect(),
            env: vec![],
            cwd: None,
            output_byte_limit: None,
        }
    }

    #[cfg(unix)]
    fn long_running_params() -> CreateTerminalParams {
        params("sleep", &["30"])
    }

    #[cfg(windows)]
    fn long_running_params() -> CreateTerminalParams {
        params("ping 127.0.0.1 -n 31 > nul", &[])
    }

    #[tokio::test]
    async fn create_runs_command_and_reports_output_and_exit() {
        let registry = TerminalRegistry::new("conv-t", None);
        let id = registry.create(params("echo hello_term", &[])).await.unwrap();
        let exit = registry.wait_for_exit(&id).await.unwrap();
        assert_eq!(exit.exit_code, Some(0));
        let snapshot = registry.output(&id).await.unwrap();
        assert!(snapshot.output.contains("hello_term"));
        assert!(snapshot.exit.is_some());
    }

    #[test]
    fn output_byte_limit_truncates_from_front_at_character_boundary() {
        let mut buffer = OutputBuffer {
            data: String::new(),
            truncated: false,
            limit: 5,
        };
        buffer.push("A好BC");
        assert_eq!(buffer.data, "好BC");
        assert!(buffer.truncated);
    }

    #[tokio::test]
    async fn kill_terminates_long_command_and_remains_queryable_until_release() {
        let registry = TerminalRegistry::new("conv-t", None);
        let id = registry.create(long_running_params()).await.unwrap();
        assert!(registry.kill(&id, "test").await);
        assert!(registry.wait_for_exit(&id).await.unwrap().signaled);
        assert!(registry.output(&id).await.is_some());
        assert!(registry.release(&id).await);
        assert!(registry.output(&id).await.is_none());
    }

    #[tokio::test]
    async fn release_is_idempotent_and_kill_all_clears() {
        let registry = TerminalRegistry::new("conv-t", None);
        let id = registry.create(long_running_params()).await.unwrap();
        let _second = registry.create(long_running_params()).await.unwrap();
        assert!(registry.release(&id).await);
        assert!(!registry.release(&id).await);
        registry.kill_all().await;
        assert!(registry.ids().await.is_empty());
    }

    #[tokio::test]
    async fn unknown_terminal_id_is_none_or_false() {
        let registry = TerminalRegistry::new("conv-t", None);
        assert!(registry.output("missing").await.is_none());
        assert!(registry.wait_for_exit("missing").await.is_none());
        assert!(!registry.kill("missing", "test").await);
        assert!(!registry.release("missing").await);
    }

    #[tokio::test]
    async fn bare_compound_command_runs_through_platform_shell() {
        let registry = TerminalRegistry::new("conv-t", None);
        let id = registry
            .create(params("echo before && echo shell_interpreted", &[]))
            .await
            .unwrap();
        assert_eq!(registry.wait_for_exit(&id).await.unwrap().exit_code, Some(0));
        assert!(registry.output(&id).await.unwrap().output.contains("shell_interpreted"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn background_child_holding_stdout_does_not_hang_exit() {
        let registry = TerminalRegistry::new("conv-t", None);
        let id = registry
            .create(params("sh", &["-c", "sleep 30 & echo parent_done"]))
            .await
            .unwrap();
        let exit = tokio::time::timeout(std::time::Duration::from_secs(5), registry.wait_for_exit(&id))
            .await
            .expect("direct child exit must be detected")
            .unwrap();
        assert_eq!(exit.exit_code, Some(0));
    }

    #[tokio::test]
    async fn terminal_ids_are_unique_across_registries() {
        let first = TerminalRegistry::new("conv-a", None);
        let second = TerminalRegistry::new("conv-b", None);
        let first_id = first.create(params("exit 0", &[])).await.unwrap();
        let second_id = second.create(params("exit 0", &[])).await.unwrap();
        assert_ne!(first_id, second_id);
    }
}
