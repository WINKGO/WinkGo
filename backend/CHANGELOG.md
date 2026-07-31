<!-- Modified from AionCore by WINK GO contributors in 2026. -->

# WINK GO Core Changelog

## 0.1.52 — WINK GO 2.2.0 baseline (2026-07-30)

This is the first WINK GO public-source baseline for the local Rust service.
It is a modified derivative of the Apache-2.0-licensed AionCore project.
Exact upstream commits, path mappings, file hashes, and modification notices
are retained in the repository root
[`NOTICE`](../NOTICE), [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md),
and [`docs/vendor/`](../docs/vendor/).

### Included capabilities

- Local account/session coordination, conversations, projects, files, Office
  workflows, providers, MCP, Skills, extensions, teams, scheduled tasks,
  channels, WebUI, and desktop integration APIs.
- Tokio/Axum services with SQLite/SQLx persistence, migrations, WebSocket
  events, bounded startup, and process lifecycle management.
- Account and device contracts used by WINK GO desktop-to-mini-program
  pairing and cloud relay.

### WINK GO changes

- Renamed public-facing service terminology and crate families while retaining
  compatible `winkgo-*` package, executable, protocol, and storage identifiers
  where migrations depend on them.
- Added registration/sign-in robustness, device isolation, policy-consent
  records, relay validation, and privacy-safe diagnostics.
- Removed or isolated runtime assets that lacked a complete redistributable
  source and license chain.
- Added deterministic upstream attribution, third-party licensing, privacy,
  release, migration, and source-scanning tests.

Earlier upstream release history is intentionally not duplicated here. This
file records WINK GO releases; upstream history and authorship remain
available through the pinned provenance records described above.
