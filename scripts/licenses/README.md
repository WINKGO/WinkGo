# Third-party license artifacts

Run `bun run licenses:generate` after changing `bun.lock`, a Cargo lock file,
or dependency license metadata. The generator works offline from installed
`node_modules` packages and Cargo's local source cache.

`bun run licenses:check` regenerates in memory and fails if the committed
artifacts are stale. It also fails when a third-party package has neither
license metadata nor a discoverable license/notice file.

`bun run licenses:check:locks` is the fast preflight gate. It proves that both Bun
lock files and all three Cargo lock files match the committed inventory, every
locked Bun package is represented, and every referenced license-text hash
exists in the archive.

The release workflow also installs Bun packages, fetches the locked Cargo
dependency metadata, and runs the complete `bun run licenses:check` validation.

Use `license-overrides.json` only after manually verifying the upstream
license. Every override must state a reason. A `licenseFile` path is resolved
from the repository root and must stay inside the repository.

The inventory deliberately includes development and build dependencies as a
conservative superset. That avoids omitting code that may be bundled by a
compiler or packaging tool. Cross-platform optional Bun packages that are not
installed on the current host are labeled `lock-only-platform-or-optional`.
Cargo is resolved offline for the six supported desktop target triples; a
missing release-target crate cache is a hard failure.
