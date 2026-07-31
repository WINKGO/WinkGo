<!-- Modified from AionUI by WINK GO contributors in 2026. -->

# Changelog

## 2.2.0 (2026-07-30)

This is the first public release under the **WINK GO** name. WINK GO is an
independent derivative project; upstream provenance, copyright notices, and
third-party license terms are recorded in
[NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and the
version-pinned manifests under [`docs/vendor/`](docs/vendor/).

### Product

- Renamed the public product, repository metadata, installer, documentation,
  and visible application surfaces to **WINK GO**.
- Published the currently shipped desktop capabilities as one open, free,
  public-interest edition without a paid feature gate.
- Documented the complete product surface, Dynamic Island modules, technical
  architecture, desktop-to-mini-program pairing, operating boundaries, and
  five-part roadmap.
- Removed decorative promotional artwork from project documentation.

### Added

- Added one-time, 10-digit device pairing between the companion mini program
  and a specific desktop installation.
- Added explicit privacy-policy and terms consent to registration and sign-in.
- Added reproducible third-party license generation, pinned upstream
  inventories, per-file modification manifests, release privacy audits, and a
  production dependency-security gate.
- Added independently authored, Apache-2.0-licensed `pdf-toolkit` guidance in
  place of the removed restricted legacy PDF Skill.

### Fixed

- Restored resilient account registration and sign-in transport, including
  Electron-network fallback, redirect restrictions, bounded timeouts, and
  structured error handling.
- Preserved existing account/device sessions when a new login attempt fails,
  while continuing to clear explicitly revoked sessions.
- Removed stale third-party product artwork and unreviewed bundled runtime
  assets from public release payloads.
- Updated release, installer, update, and repository links for WINK GO 2.2.0.

### Security

- Upgraded the supported Electron, React, router, and build-tool dependency
  baseline and added an auditable exception for fixed `brace-expansion`
  maintenance backports.
- Hardened navigation, pop-up, WebView, IPC, permission, content-security,
  preview, and deep-link boundaries.
- Kept automatic production telemetry disabled and added stage, packed-app,
  and final-installer privacy checks.

### Compatibility

- Legacy `winkgo` protocol identifiers, package scopes, environment variables,
  cloud contracts, data directories, and selected executable names remain
  where changing them would break existing installations or stored data.
- Compatibility identifiers do not change the public product name and should
  not be interpreted as separate editions or branding.
