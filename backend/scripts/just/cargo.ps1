$ErrorActionPreference = "Stop"

$CargoArgs = @($args)
$cargoConfig = @()
$restoreCargoLock = $false
$cargoLockSnapshot = $null
$winkgo_agentRoot = $null
$crates = @()

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,
        [string[]] $Arguments = @()
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        $script:status = $LASTEXITCODE
        exit $LASTEXITCODE
    }
}

function Test-GitDiffClean {
    param([string[]] $Arguments)

    & git @Arguments | Out-Null
    return $LASTEXITCODE -eq 0
}

function Resolve-LocalPath {
    param([string] $Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
}

function Test-WinkGoAgentPatch {
    $metadataJson = & cargo @cargoConfig metadata --format-version 1
    if ($LASTEXITCODE -ne 0) {
        $script:status = $LASTEXITCODE
        exit $LASTEXITCODE
    }
    $metadata = $metadataJson | ConvertFrom-Json

    foreach ($crate in $crates) {
        $expectedPath = Resolve-LocalPath (Join-Path $winkgo_agentRoot "crates/$crate")
        $package = $metadata.packages | Where-Object { $_.name -eq $crate } | Select-Object -First 1
        $actualPath = if ($null -eq $package) {
            "package not found"
        } else {
            Resolve-LocalPath (Split-Path -Parent $package.manifest_path)
        }

        if ($actualPath -ne $expectedPath) {
            Write-Error "WINKGO_AGENT patch was not used for $crate.`n  resolved: $actualPath`n  expected: $expectedPath"
            $script:status = 1
            exit 1
        }
    }
}

$status = 0
try {
    if (-not [string]::IsNullOrWhiteSpace($env:WINKGO_AGENT)) {
        if (-not (Test-Path -LiteralPath $env:WINKGO_AGENT -PathType Container)) {
            Write-Error "WINKGO_AGENT does not exist or is not a directory: $env:WINKGO_AGENT"
            exit 1
        }

        $winkgo_agentRoot = (Resolve-Path -LiteralPath $env:WINKGO_AGENT).ProviderPath
        $crates = @(
            "winkgo-agent",
            "winkgo-compact",
            "winkgo-config",
            "winkgo-mcp",
            "winkgo-memory",
            "winkgo-process",
            "winkgo-protocol",
            "winkgo-providers",
            "winkgo-skills",
            "winkgo-tools",
            "winkgo-types"
        )

        foreach ($crate in $crates) {
            $crateDir = Join-Path $winkgo_agentRoot "crates/$crate"
            $manifest = Join-Path $crateDir "Cargo.toml"
            if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
                Write-Error "WINKGO_AGENT is missing ${crate}: $manifest"
                exit 1
            }

            $tomlPath = $crateDir.Replace("\", "/").Replace('"', '\"')
            $cargoConfig += @("--config", "patch.'https://github.com/xuweihafeichangniu-lab/winkgo_agent.git'.$crate.path = `"`"$tomlPath`"`"")
        }

        [Console]::Error.WriteLine("Using local winkgo_agent SDK: $winkgo_agentRoot")

        if (Test-Path -LiteralPath "Cargo.lock" -PathType Leaf) {
            $cargoLockSnapshot = [System.IO.Path]::GetTempFileName()
            Copy-Item -LiteralPath "Cargo.lock" -Destination $cargoLockSnapshot -Force

            $worktreeClean = Test-GitDiffClean @("diff", "--quiet", "--", "Cargo.lock")
            $indexClean = Test-GitDiffClean @("diff", "--cached", "--quiet", "--", "Cargo.lock")
            if ($worktreeClean -and $indexClean) {
                $restoreCargoLock = $true
            } else {
                [Console]::Error.WriteLine("Cargo.lock already has changes; leaving successful WINKGO_AGENT lockfile updates in place.")
            }
        }

        [Console]::Error.WriteLine("Resolving Cargo.lock against local winkgo_agent SDK")
        $updateArgs = @($cargoConfig) + @(
            "update",
            "-p", "winkgo-agent",
            "-p", "winkgo-compact",
            "-p", "winkgo-config",
            "-p", "winkgo-mcp",
            "-p", "winkgo-memory",
            "-p", "winkgo-process",
            "-p", "winkgo-protocol",
            "-p", "winkgo-providers",
            "-p", "winkgo-skills",
            "-p", "winkgo-tools",
            "-p", "winkgo-types"
        )
        Invoke-Native "cargo" $updateArgs
        Test-WinkGoAgentPatch
    }

    & cargo @cargoConfig @CargoArgs
    $status = $LASTEXITCODE
} finally {
    if ($null -ne $cargoLockSnapshot -and (Test-Path -LiteralPath $cargoLockSnapshot -PathType Leaf)) {
        if ($restoreCargoLock -or $status -ne 0) {
            Copy-Item -LiteralPath $cargoLockSnapshot -Destination "Cargo.lock" -Force
        }
        Remove-Item -LiteralPath $cargoLockSnapshot -Force
    }
}

exit $status
