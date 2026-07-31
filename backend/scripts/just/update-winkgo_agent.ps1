# Modified from AionCore by WINK GO contributors in 2026.
$ErrorActionPreference = "Stop"
Write-Output "winkgo_agent is vendored under backend/agent-runtime; verifying the integrated workspace."
cargo check --workspace --locked
exit $LASTEXITCODE
