# Security Policy

## Supported versions

Only the latest WINK GO release and the current `main` branch receive security
updates. Older releases should be upgraded before reporting a problem that is
already fixed in the latest version.

The desktop runtime is pinned to Electron `41.10.3` while the native SQLite
dependency is validated against that Electron ABI. This is a short-lived
compatibility bridge, not permission to float Electron versions independently.
Electron 41 reaches end of support on 2026-08-25, so the runtime and
`better-sqlite3` must be upgraded together before that date.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** form when private
vulnerability reporting is available. If it is not available, contact the
maintainers at **1394748660@qq.com**. Do not publish credentials, personal
data, proof-of-concept exploits, or an unpatched vulnerability in a public
issue.

Include:

- the affected version, platform, and installation method;
- the smallest reproducible example;
- the security impact and required attacker capabilities;
- relevant logs with tokens, passwords, paths, and personal data removed; and
- whether the issue is already being exploited.

Maintainers will acknowledge the report, reproduce and assess it, coordinate a
fix, and publish attribution when requested and safe. Response and release times
depend on severity and reproducibility; this policy does not promise a fixed
service-level agreement or bug-bounty payment.

## Dependency audit policy

Run the production dependency gate before release:

```bash
bun install --frozen-lockfile
bun run security:audit
```

The gate validates the resolved `brace-expansion` packages before applying the
single Bun advisory exception for `GHSA-mh99-v99m-4gvg`. The lockfile must
contain only the reviewed patched versions `1.1.18`, `2.1.4`, and `5.0.9`.
Do not replace older major versions with version 5 through a global resolution:
their CommonJS APIs are incompatible.

An ignored advisory is not considered permanently accepted. If the dependency
graph changes, update or remove the exception only after reviewing every
resolved version and recording the reason in the pull request.
