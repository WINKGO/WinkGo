#!/usr/bin/env bash
# Modified from AionCore by WINK GO contributors in 2026.
set -euo pipefail

if [[ -n "${WINKGO_AGENT:-}" ]]; then
    echo "WINKGO_AGENT overrides are no longer supported. The agent runtime is built from backend/agent-runtime in this repository." >&2
    exit 1
fi

cargo "$@"
