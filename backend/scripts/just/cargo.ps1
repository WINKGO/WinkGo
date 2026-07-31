# Modified from AionCore by WINK GO contributors in 2026.
$ErrorActionPreference = "Stop"

$CargoArgs = @($args)
if (-not [string]::IsNullOrWhiteSpace($env:WINKGO_AGENT)) {
    Write-Error "WINKGO_AGENT overrides are no longer supported. The agent runtime is built from backend/agent-runtime in this repository."
    exit 1
}

& cargo @CargoArgs
exit $LASTEXITCODE
