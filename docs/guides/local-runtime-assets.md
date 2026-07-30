# Local runtime assets

The public WINK GO source tree excludes generated binaries and externally supplied bundles whose redistribution rights are not established in this repository.

The following optional assets are provisioned locally for approved release builds:

- `public/knowledge-canvas/index.html`
- `resources/winkgo/provider-skills/`
- `packages/desktop/native/winkgo_native_drop.node`

The application source and core checks work without these files. Tests that validate an optional bundle run when that bundle is present and skip only the bundle-specific checks when it is absent.

Before packaging a release that uses these features, place the approved assets at the paths above, verify their licenses and provenance, and run the full build and test gates. Generated caches, credentials, logs, and locally compiled binaries must not be committed.
