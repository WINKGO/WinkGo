// Modified from AionCore by WINK GO contributors in 2026.
mod manager;

pub use manager::TeamRunManager;

use winkgo_api_types::TeamRunTargetRole;

use crate::types::TeammateRole;

pub fn target_role_for(role: TeammateRole) -> TeamRunTargetRole {
    match role {
        TeammateRole::Lead => TeamRunTargetRole::Lead,
        TeammateRole::Teammate => TeamRunTargetRole::Teammate,
    }
}

#[cfg(test)]
mod tests;
