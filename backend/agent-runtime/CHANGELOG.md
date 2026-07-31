<!-- Modified from aionrs by WINK GO contributors in 2026. -->

# WINK GO Agent Runtime Changelog

## 0.2.7 — WINK GO 2.2.0 baseline (2026-07-30)

This is the first WINK GO public-source baseline for the Rust agent runtime.
It is a modified derivative of the Apache-2.0-licensed aionrs project. Exact
upstream commits, path mappings, file hashes, and modification notices are
retained in the repository root
[`NOTICE`](../../NOTICE),
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md), and
[`docs/vendor/`](../../docs/vendor/).

### Included capabilities

- ACP-compatible agent lifecycle, sessions, protocol events, approvals,
  provider transports, MCP, Skills, tools, memory, process containment, and
  context compaction.
- OpenAI-compatible, Anthropic-compatible, Bedrock, Vertex, and composed
  provider paths with streaming, retry, projection, and error sanitization.
- Cross-platform command execution and file tools with bounded output,
  workspace scoping, cancellation, and structured diagnostics.

### WINK GO changes

- Renamed crate families to `winkgo-agent-*` for compatibility with the
  WINK GO runtime integration.
- Removed bundled authentication paths that could imply reuse of unrelated
  consumer subscriptions; external CLIs and credentials remain user-managed.
- Hardened tool policy enforcement, image/file handling, process boundaries,
  configuration parsing, stream diagnostics, and session recovery.
- Added comprehensive unit and integration coverage for the modified runtime.

Earlier upstream release history is intentionally not duplicated here. This
file records WINK GO releases; upstream history and authorship remain
available through the pinned provenance records described above.
