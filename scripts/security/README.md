# Dependency security audit

Run the production dependency gate from the repository root:

```bash
bun run security:audit
```

`audit-dependencies.cjs` performs two checks:

1. It reads `bun.lock` and requires the resolved `brace-expansion` version set
   to be exactly `1.1.18`, `2.1.4`, and `5.0.9`.
2. It runs `bun audit --production`, ignoring only
   `GHSA-mh99-v99m-4gvg`.

The targeted ignore is necessary because Bun currently applies that advisory's
broad range to old major lines even when their patched releases are locked.
The local lockfile check prevents the ignore from hiding a downgrade.

Do not force every consumer to `brace-expansion` 5. Its export shape is not
compatible with consumers that require the version 1 or 2 CommonJS function.
When the dependency graph legitimately removes or changes one of the reviewed
versions, review the new graph first, then update the exact allowlist and this
document in the same change.

The script exits non-zero when the lockfile is missing, a resolved version is
missing or unexpected, Bun cannot be started, or the production audit finds
another vulnerability.
