# Codex CLI 0.145.0 samples

`turn-steer-live-redacted.ndjson` was captured from the locally installed
`codex-cli 0.145.0` app server on 2026-08-22. Thread and turn identifiers were
replaced with stable placeholders; no credentials, environment variables, file
contents, or provider payloads are included.

The three retained frames prove the contract WINK GO depends on:

1. `turn/started` supplies the active turn identifier.
2. `turn/steer` sends that identifier as `expectedTurnId`.
3. The matching JSON-RPC response acknowledges the steer with `result.turnId`.
