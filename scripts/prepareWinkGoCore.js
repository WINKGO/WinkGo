/**
 * CLI wrapper for prepare-winkgo-core.
 *
 * Reads environment variables and invokes the shared module.
 *
 * By default this builds the repository's backend/ workspace. A complete local
 * bundle, an explicit binary, this repository's Actions artifact, or a WINK GO
 * release can be selected through the environment variables below.
 *
 * Environment variables:
 *  - WINKGO_BACKEND_RUN_ID: WINK GO workflow run id
 *  - WINKGO_BACKEND_VERSION: override the pinned version
 *  - WINKGO_BACKEND_ARCH: target architecture (default: process.arch)
 *  - WINKGO_BACKEND_LOCAL_BUNDLE_DIR: complete prebuilt backend bundle
 *  - WINKGO_BACKEND_LOCAL_BINARY: explicit backend binary
 *  - WINKGO_BACKEND_SKIP_LOCAL_BUILD=1: skip the repository-local Cargo build
 *  - WINKGO_BACKEND_CARGO_TARGET_DIR: optional Cargo target cache
 *  - GH_TOKEN / GITHUB_TOKEN: token for this repository's artifacts/releases
 */

const path = require('path');
const { prepareWinkGoCore } = require('../packages/shared-scripts/src/prepare-winkgo-core.js');
const { resolveWinkGoCoreVersion } = require('./resolveWinkGoCoreVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
// Support cross-compilation: WINKGO_BACKEND_ARCH > npm_config_target_arch > process.arch
const arch = process.env.WINKGO_BACKEND_ARCH || process.env.npm_config_target_arch || process.arch;
const version = resolveWinkGoCoreVersion(projectRoot);

try {
  prepareWinkGoCore({ projectRoot, platform, arch, version });
} catch (error) {
  console.error('❌ prepareWinkGoCore failed:', error.message);
  process.exit(1);
}

module.exports = function () {
  try {
    return prepareWinkGoCore({ projectRoot, platform, arch, version });
  } catch (error) {
    console.error('❌ prepareWinkGoCore failed:', error.message);
    throw error;
  }
};
