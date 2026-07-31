#!/usr/bin/env bash
# Modified from AionCore by WINK GO contributors in 2026.
set -euo pipefail

echo "winkgo_agent is vendored under backend/agent-runtime; verifying the integrated workspace."
cargo check --workspace --locked
