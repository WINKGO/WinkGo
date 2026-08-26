<!-- Modified from AionUI by WINK GO contributors in 2026. -->

# Changelog

## 2.2.22 (2026-08-27)

- Restored portable desktop and browser automation Skill imports by routing them through WINK GO's in-app bridge tools instead of legacy external-browser selectors.
- Hardened Runtime Skill audits by validating a sealed temporary Runtime copy and cleaning up only the audit processes launched from that copy.
- Selected the bundled WINK GO Core platform from the requested Electron Builder target so cross-platform Windows and macOS packaging resolves the correct Core artifact.
- Added the customer-facing desktop automation Skill bundle and regression coverage for portable actions, bridge selectors, and target-platform packaging.
- Ignored local stale Runtime backup directories so generated binaries and machine-specific configuration cannot enter source commits.
- Upgraded the mail parser dependency chain to remove the vulnerable `deepmerge-ts` release and normalized generated license text for CI-safe whitespace.

## 2.2.11 (2026-08-02)

- Fixed final release assembly to recognize the Debian-standard `amd64` package name produced for Linux x64 builds.
- Updated Linux installation instructions and release validation to use the same canonical architecture name.

## 2.2.10 (2026-08-02)

- Fixed Linux ARM64 release auditing to recognize architecture-specific unpacked output directories.
- Removed the in-run self-rerun job that GitHub rejects while the same workflow is still active.

## 2.2.9 (2026-08-02)

- Restored Windows startup for existing installations whose migration history was recorded with Windows line endings.
- Kept genuine migration changes blocked while safely recognizing SQL files that differ only by LF or CRLF line endings.
- Fixed Windows ARM64 release verification to locate the architecture-specific unpacked executable and its audited application archive.
- Built Linux x64 desktop and Web CLI bundles on Ubuntu 22.04 for Debian 12 / glibc 2.36 compatibility.

## 2.2.8 (2026-08-02)

- Restored Windows startup for existing installations whose migration history was recorded with Windows line endings.
- Kept genuine migration changes blocked while safely recognizing SQL files that differ only by LF or CRLF line endings.

## 2.2.7 (2026-08-02)

- Controlled Soda Music from Dynamic Island without foregrounding the player, clicking its window, or flashing a console.
- Prevented album artwork from a previous song or music application from appearing while the next verified cover is loading.
- Kept Dynamic Island stable during desktop file and image drags, then opened the collection destination directly after a drop.
- Stabilized Windows release tests against short-lived output-directory locks from scanners and build subprocesses.

## 2.2.6 (2026-08-01)

- Filtered Windows media sessions by the selected Dynamic Island platform for system media, NetEase Cloud Music, QQ Music, Kugou, Spotify, Apple Music, EchoMusic, and LX Music.
- Preserved verified artwork through temporary metadata gaps, rejected stale artwork, and restored cached covers when tracks return.
- Restored NetEase artwork from its local playback library by safely upgrading trusted NetEase image hosts to HTTPS.
- Added exact QQ Music artwork matching and kept the corresponding player icon visible whenever a platform does not expose album artwork.

## 2.2.5 (2026-08-01)

- Enabled WINK GO cloud device relay by default for new installations and migrated version 2.2.4 configurations.
- Started relay authorization and connection automatically after successful account login or registration.
- Preserved an explicit relay opt-out after the configuration has migrated to the current schema.
- Verified production signed desktop enrollment and short-lived 10-digit one-time pairing-code generation.

## 2.2.4 (2026-08-01)

- Made Dynamic Island identities stable while Windows notifications, task completions, and media artwork are loading or changing.
- Ensured completed and failed local tasks consistently show the WINK GO logo instead of an empty Windows application icon.
- Preferred verified bundled application logos for supported notification and music apps, with album-art and WINK GO fallbacks that remain visible during image loading.
- Rejected transparent and solid-color native Windows icons before they reach the renderer.
- Added an official mainland China high-speed download channel on `winkgo.top`, with GitHub retained as the backup mirror.

## 2.2.3 (2026-08-01)

- Fixed Dynamic Island clipping when the application UI scale is above 100% by keeping the fixed-size island renderer at native zoom across initial load, reloads, and later global zoom changes.

## 2.2.2 (2026-08-01)

- Fixed truncated Dynamic Island media, focus timer, file shelf, category, and format-conversion panels by sizing the floating window from its rendered content.
- Restored NetEase Cloud Music album artwork by matching missing system artwork against the local read-only playback library.
- Prevented official Windows builds from silently falling back to Electron's default executable icon and added a mandatory WINK GO icon verification gate.

## 2.2.1 (2026-07-31)

- Restored the bundled Knowledge Canvas in production builds.
- Restored desktop pet startup and synchronized its settings with the main process.
- Added custom theme creation while keeping Follow System as the only built-in theme option.
- Fixed Windows desktop file and image drag-and-drop in chat on current Electron versions.
- Refined the About page around `https://winkgo.top/` and moved legal information to the bottom.

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
