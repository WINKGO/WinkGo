/**
 * Resolve the WINK GO Core version recorded in packaged manifests.
 *
 * Order:
 *   1. WINKGO_BACKEND_VERSION env (ad-hoc override, e.g. CI dispatch input)
 *   2. "winkgoCoreVersion" field in repo-root package.json (the pin)
 *   3. 'latest' (used only by the optional release fallback)
 *
 * Keep this file tiny and dependency-free — it's required from both
 * scripts/prepareWinkGoCore.js and scripts/pack-web-cli.js before
 * any project-level install has necessarily completed.
 */

const fs = require('fs');
const path = require('path');

function resolveWinkGoCoreVersion(projectRoot) {
  const envOverride = process.env.WINKGO_BACKEND_VERSION;
  if (envOverride && envOverride.trim()) {
    return envOverride.trim();
  }

  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (pkg && typeof pkg.winkgoCoreVersion === 'string' && pkg.winkgoCoreVersion.trim()) {
      return pkg.winkgoCoreVersion.trim();
    }
  } catch {
    // fall through
  }

  return 'latest';
}

module.exports = { resolveWinkGoCoreVersion };
