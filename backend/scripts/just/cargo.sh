#!/usr/bin/env bash
# Modified from AionCore by WINK GO contributors in 2026.
set -euo pipefail

cargo_config=()
restore_cargo_lock=false
cargo_lock_snapshot=""
winkgo_agent_root=""

restore_local_lockfile() {
    local status=$?

    if [[ -n "$cargo_lock_snapshot" && -f "$cargo_lock_snapshot" ]]; then
        if [[ "$restore_cargo_lock" == "true" || "$status" -ne 0 ]]; then
            cp "$cargo_lock_snapshot" Cargo.lock || status=$?
        fi
    fi
    if [[ -n "$cargo_lock_snapshot" ]]; then
        rm -f "$cargo_lock_snapshot"
    fi

    return "$status"
}
trap restore_local_lockfile EXIT

verify_local_winkgo_agent_patch() {
    local metadata_file
    metadata_file=$(mktemp)
    cargo "${cargo_config[@]}" metadata --format-version 1 > "$metadata_file"

    python3 - "$winkgo_agent_root" "$metadata_file" "${crates[@]}" <<'PY'
import json
import sys
from pathlib import Path

winkgo_agent_root = Path(sys.argv[1]).resolve()
metadata_path = Path(sys.argv[2])
crates = sys.argv[3:]
metadata = json.loads(metadata_path.read_text())
packages = {package["name"]: package for package in metadata["packages"]}

for crate in crates:
    package = packages.get(crate)
    expected = (winkgo_agent_root / "crates" / crate).resolve()
    if not package:
        print(f"WINKGO_AGENT patch was not used for {crate}.", file=sys.stderr)
        print("  resolved: package not found", file=sys.stderr)
        print(f"  expected: {expected}", file=sys.stderr)
        sys.exit(1)

    actual = Path(package["manifest_path"]).resolve().parent
    if actual != expected:
        print(f"WINKGO_AGENT patch was not used for {crate}.", file=sys.stderr)
        print(f"  resolved: {actual}", file=sys.stderr)
        print(f"  expected: {expected}", file=sys.stderr)
        sys.exit(1)
PY

    rm -f "$metadata_file"
}

if [[ -n "${WINKGO_AGENT:-}" ]]; then
    if [[ ! -d "$WINKGO_AGENT" ]]; then
        echo "WINKGO_AGENT does not exist or is not a directory: $WINKGO_AGENT" >&2
        exit 1
    fi

    winkgo_agent_root=$(cd "$WINKGO_AGENT" && pwd -P)
    crates=(
        winkgo-agent
        winkgo-compact
        winkgo-config
        winkgo-mcp
        winkgo-memory
        winkgo-process
        winkgo-protocol
        winkgo-providers
        winkgo-skills
        winkgo-tools
        winkgo-types
    )

    for crate in "${crates[@]}"; do
        crate_dir="$winkgo_agent_root/crates/$crate"
        if [[ ! -f "$crate_dir/Cargo.toml" ]]; then
            echo "WINKGO_AGENT is missing $crate: $crate_dir/Cargo.toml" >&2
            exit 1
        fi

        toml_path=${crate_dir//\\/\\\\}
        toml_path=${toml_path//\"/\\\"}
        cargo_config+=(--config "patch.'https://github.com/xuweihafeichangniu-lab/winkgo_agent.git'.$crate.path = \"$toml_path\"")
    done

    echo "Using local winkgo_agent SDK: $winkgo_agent_root" >&2

    if [[ -f Cargo.lock ]]; then
        cargo_lock_snapshot=$(mktemp)
        cp Cargo.lock "$cargo_lock_snapshot"

        if git diff --quiet -- Cargo.lock && git diff --cached --quiet -- Cargo.lock; then
            restore_cargo_lock=true
        else
            echo "Cargo.lock already has changes; leaving successful WINKGO_AGENT lockfile updates in place." >&2
        fi
    fi

    echo "Resolving Cargo.lock against local winkgo_agent SDK" >&2
    cargo "${cargo_config[@]}" update \
        -p winkgo-agent \
        -p winkgo-compact \
        -p winkgo-config \
        -p winkgo-mcp \
        -p winkgo-memory \
        -p winkgo-process \
        -p winkgo-protocol \
        -p winkgo-providers \
        -p winkgo-skills \
        -p winkgo-tools \
        -p winkgo-types
    verify_local_winkgo_agent_patch
fi

if ((${#cargo_config[@]})); then
    cargo "${cargo_config[@]}" "$@"
else
    cargo "$@"
fi
