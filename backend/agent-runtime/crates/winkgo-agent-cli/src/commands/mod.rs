// Modified from aionrs by WINK GO contributors in 2026.
//! Subcommand implementations for the `winkgo` CLI binary.
//!
//! This file is a façade — module declarations and re-export only.
//! All dispatch logic lives in `dispatch.rs`.

mod cmd_config;
mod cmd_session;
mod cmd_skills;
mod dispatch;

pub(crate) use dispatch::dispatch;
