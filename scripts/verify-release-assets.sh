#!/usr/bin/env bash
# Modified from AionUI by WINK GO contributors in 2026.

set -euo pipefail

OUTPUT_DIR="${1:-release-assets}"
VERSION="${2:-${MOCK_VERSION:-}}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
fi
VERSION="${VERSION#v}"
ERRORS=0

for f in LICENSE NOTICE THIRD_PARTY_NOTICES.md THIRD_PARTY_DEPENDENCIES.json THIRD_PARTY_LICENSES.txt PRIVACY.md TERMS.md; do
  if [ ! -s "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing or empty legal document: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

if [ -s "$OUTPUT_DIR/LICENSE" ] && ! grep -q "Apache License" "$OUTPUT_DIR/LICENSE"; then
  echo "FAIL: LICENSE does not contain the Apache License text"
  ERRORS=$((ERRORS + 1))
fi
if [ -s "$OUTPUT_DIR/NOTICE" ] && ! grep -q "AionUi" "$OUTPUT_DIR/NOTICE"; then
  echo "FAIL: NOTICE does not contain the upstream attribution"
  ERRORS=$((ERRORS + 1))
fi
if [ -s "$OUTPUT_DIR/PRIVACY.md" ] && ! grep -q "Privacy Policy" "$OUTPUT_DIR/PRIVACY.md"; then
  echo "FAIL: PRIVACY.md does not contain the privacy policy"
  ERRORS=$((ERRORS + 1))
fi
if [ -s "$OUTPUT_DIR/TERMS.md" ] && ! grep -q "Terms of Service" "$OUTPUT_DIR/TERMS.md"; then
  echo "FAIL: TERMS.md does not contain the terms of service"
  ERRORS=$((ERRORS + 1))
fi

for f in latest.yml latest-mac.yml latest-linux.yml latest-linux-arm64.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing canonical metadata: $f"
    ERRORS=$((ERRORS + 1))
  fi
done

extract_ref_file() {
  local metadata_file="$1"
  local ref
  ref=$(grep -E '^path:' "$metadata_file" | head -n 1 | sed -E 's/^path:[[:space:]]*//')
  if [ -z "$ref" ]; then
    ref=$(grep -E '^[[:space:]]*-?[[:space:]]*url:' "$metadata_file" | head -n 1 | sed -E 's/^[[:space:]]*-?[[:space:]]*url:[[:space:]]*//')
  fi
  echo "$ref"
}

assert_metadata_points_to_existing_file() {
  local metadata_name="$1"
  local expected_pattern="$2"
  local metadata_path="$OUTPUT_DIR/$metadata_name"

  local ref_file
  ref_file=$(extract_ref_file "$metadata_path")

  if [ -z "$ref_file" ]; then
    echo "FAIL: $metadata_name has no path/url entry"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [[ ! "$ref_file" =~ $expected_pattern ]]; then
    echo "FAIL: $metadata_name points to unexpected file: $ref_file"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ ! -f "$OUTPUT_DIR/$ref_file" ]; then
    echo "FAIL: $metadata_name references missing file: $ref_file"
    ERRORS=$((ERRORS + 1))
    return
  fi

  echo "PASS: $metadata_name -> $ref_file"
}

assert_metadata_points_to_existing_file "latest.yml" "(win-x64|win32-x64|x64)"
assert_metadata_points_to_existing_file "latest-mac.yml" "(mac-x64|darwin-x64|x64)"
assert_metadata_points_to_existing_file "latest-linux.yml" "(linux|AppImage|deb)"
assert_metadata_points_to_existing_file "latest-linux-arm64.yml" "(arm64|aarch64)"

for f in latest-win-arm64.yml latest-arm64-mac.yml; do
  if [ ! -f "$OUTPUT_DIR/$f" ]; then
    echo "FAIL: missing arch-specific updater metadata: $f"
    ERRORS=$((ERRORS + 1))
  else
    echo "PASS: $f exists"
  fi
done

for arch in x64 arm64; do
  for f in \
    "WINK-GO-Free-Setup-${VERSION}-${arch}.exe" \
    "WINK-GO-Free-${VERSION}-mac-${arch}.dmg" \
    "WINK-GO-Free-${VERSION}-mac-${arch}.zip" \
    "WINK-GO-Free-${VERSION}-linux-${arch}.deb"; do
    if [ ! -f "$OUTPUT_DIR/$f" ]; then
      echo "FAIL: missing distributable: $f"
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: $f exists"
    fi
  done
done

# Web-CLI tarballs + checksums
for plat in darwin-arm64 darwin-x86_64 linux-arm64 linux-x86_64 win-x86_64; do
  tarball="winkgo-web-${VERSION}-${plat}.tar.gz"
  for f in "$tarball" "${tarball}.sha256"; do
    if [ ! -f "$OUTPUT_DIR/$f" ]; then
      echo "FAIL: missing web-cli asset: $f"
      ERRORS=$((ERRORS + 1))
    else
      echo "PASS: $f exists"
    fi
  done
done

if [ ! -f "$OUTPUT_DIR/install-web.sh" ]; then
  echo "FAIL: missing install-web.sh"
  ERRORS=$((ERRORS + 1))
else
  echo "PASS: install-web.sh exists"
fi

if [ "$ERRORS" -eq 0 ]; then
  NODE_RUNTIME=node
  if ! command -v "$NODE_RUNTIME" >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
    NODE_RUNTIME=bun
  elif ! command -v "$NODE_RUNTIME" >/dev/null 2>&1 && command -v node.exe >/dev/null 2>&1; then
    NODE_RUNTIME=node.exe
  fi
  if "$NODE_RUNTIME" scripts/security/nginx-release-receiver.cjs validate "$VERSION" "$OUTPUT_DIR"; then
    echo "PASS: Windows website updater bytes and metadata are consistent"
  else
    echo "FAIL: Windows website updater bytes or metadata are inconsistent"
    ERRORS=$((ERRORS + 1))
  fi
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
  echo "FAILED: $ERRORS errors found"
  exit 1
fi

echo "ALL CHECKS PASSED"
