// Modified from aionrs by WINK GO contributors in 2026.
pub mod clear;
pub mod compact;
pub mod help;
pub mod quit;
mod registry;

pub use registry::{CommandContext, CommandRegistry, CommandResult, SlashCommand, default_registry};
