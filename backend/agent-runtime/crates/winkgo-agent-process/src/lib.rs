// Modified from aionrs by WINK GO contributors in 2026.
mod containment;
mod runner;
#[cfg(windows)]
mod windows_job;

pub use runner::{CommandResult, CommandRunner, DEFAULT_POST_PROCESS_DRAIN, DEFAULT_TIMEOUT};
