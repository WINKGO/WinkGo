# Third-Party Notices

WINK GO incorporates and modifies third-party software. This file records
project-level attribution notices; dependencies may also include their own
license files and package metadata.

## AionUI, AionCore, and aionrs

This repository is an independent, renamed derivative of three related
Apache-2.0 upstream projects:

| Upstream | Version   | Commit                                     | Source                                  | Copyright                          |
| -------- | --------- | ------------------------------------------ | --------------------------------------- | ---------------------------------- |
| AionUI   | `v2.1.41` | `2d8925fc67a97a20996fadcd2a0862b778b572ba` | <https://github.com/iOfficeAI/AionUi>   | Copyright 2025 AionUi (aionui.com) |
| AionCore | `v0.1.52` | `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d` | <https://github.com/iOfficeAI/AionCore> | Copyright 2025 AionUi (aionui.com) |
| aionrs   | `v0.2.7`  | `445a18e1625cc68ded3a647ee99332195fbe8508` | <https://github.com/iOfficeAI/aionrs>   | Copyright 2026 iOfficeAI           |

The AionCore tree is distributed under `backend/`; its `aionui-*` crates were
renamed to `winkgo-*`. The aionrs tree is distributed under
`backend/agent-runtime/`; its `aion-*` crates were renamed to
`winkgo-agent-*`. Product, package, executable, environment-variable, and
identifier renames are modifications by WINK GO contributors and do not
remove or replace upstream authorship.

Modified files that safely support comments carry a prominent
`Modified from … by WINK GO contributors in 2026.` notice. JSON, lock
files, SQL migrations, binary assets, and other formats where a comment could
break parsing, checksums, or runtime behavior are identified by exact path and
SHA-256 in the following machine-verifiable manifests:

- [`docs/vendor/aionui-modification-manifest.tsv`](docs/vendor/aionui-modification-manifest.tsv)
- [`docs/vendor/aioncore-modification-manifest.tsv`](docs/vendor/aioncore-modification-manifest.tsv)
- [`docs/vendor/aionrs-modification-manifest.tsv`](docs/vendor/aionrs-modification-manifest.tsv)

Coverage is checked against commit-pinned inventories built from canonical
Git blobs, so a file that was previously byte-identical cannot be modified
later without entering the modification manifest:

- [`docs/vendor/aionui-upstream-inventory.tsv`](docs/vendor/aionui-upstream-inventory.tsv)
- [`docs/vendor/aioncore-upstream-inventory.tsv`](docs/vendor/aioncore-upstream-inventory.tsv)
- [`docs/vendor/aionrs-upstream-inventory.tsv`](docs/vendor/aionrs-upstream-inventory.tsv)

The original AionUI and AionCore copyright segment is retained in `LICENSE`
and `backend/LICENSE`; the original aionrs copyright segment is retained in
`backend/agent-runtime/LICENSE`. WINK GO's modification copyright appears
in addition to, rather than in place of, those notices.

This attribution is included for license compliance and does not imply
sponsorship, endorsement, or affiliation.

The complete Apache License 2.0 text is available in [LICENSE](LICENSE).
The distribution notice is available in [NOTICE](NOTICE).

## OfficeCLI

Bundled Office automation skills contain material derived from OfficeCLI at
commit `e04dee2af5a0822db867edd67fcf29c9e02739fc`.

- Source: <https://github.com/iOfficeAI/OfficeCLI/tree/e04dee2af5a0822db867edd67fcf29c9e02739fc/skills>
- Copyright: Copyright 2026 OfficeCLI (https://OfficeCLI.AI)
- License: Apache License 2.0

The applicable complete license, upstream NOTICE, pinned source, and WINK GO
modification notes are retained beside each redistributed skill.

## Moltbook skill

The bundled Moltbook integration is the snapshot recorded in the pinned
AionCore `v0.1.52` inventory and identifies its author as `moltbook`, homepage
as <https://www.moltbook.com>, and license as MIT. The official Moltbook
`skill.json` endpoint was rechecked on 2026-07-31 and also reported the MIT
license.

- Copyright: Copyright (c) moltbook
- License: MIT

The complete MIT notice and source record are retained in
`backend/crates/winkgo-app/assets/builtin-skills/moltbook/`. Moltbook is an
independent service; inclusion does not imply sponsorship or affiliation.

## WINK GO Knowledge Canvas

The bundled single-file Knowledge Canvas is built from the independently
developed `wink-go-canvans` project version `0.1.2`, preserved in WINK GO's
read-only historical project archive. It is not sourced from AionUI or
AionCore.

Its runtime dependency closure includes React Flow, React, Lucide, QRCode,
Zustand, and their transitive dependencies. The exact package inventory,
complete license texts, source hashes, and React Flow attribution record are
distributed under `public/knowledge-canvas/`.

## Anthropic skill-creator

The bundled `skill-creator` material is based on Anthropic's skills repository
at commit `ef740771ac901e03fbca3ce4e1c453a96010f30a`.

- Source: <https://github.com/anthropics/skills/tree/ef740771ac901e03fbca3ce4e1c453a96010f30a/skills/skill-creator>
- Copyright: Copyright 2026 Anthropic, PBC.
- License: Apache License 2.0

The complete upstream license and WINK GO modification record are retained in
the redistributed `skill-creator` directory.

OfficeCLI, Anthropic, Claude, and other third-party service names are marks of
their respective owners. Attribution and compatibility identification do not
imply sponsorship, endorsement, or affiliation.

## Wry

The Windows native OLE drag-and-drop bridge adapts source code from Wry
0.55.1, including material from `src/webview2/drag_drop.rs`.

- Source: <https://github.com/tauri-apps/wry/tree/a5bf203a1c8dbb3583588382538d6521655222a8>
- Tag: `wry-v0.55.1`
- Commit: `a5bf203a1c8dbb3583588382538d6521655222a8`
- Copyright: Copyright 2020-2023 Tauri Programme within The Commons Conservancy
- License: Apache License 2.0 OR MIT

The original copyright and SPDX notices remain in the adapted Rust source.
The complete upstream license texts, pinned source record, and WINK GO
modification record are distributed under
`packages/desktop/native/winkgo-native-drop/vendor/wry-0.55.1/` and in the
desktop application's `legal/vendor/wry-0.55.1/` directory.

## sharp and libvips

The installer-artwork build dependency is pinned to `sharp` version `0.35.3`;
its target-specific prebuilt packages report libvips version `8.18.3` and declare
`Apache-2.0 AND LGPL-3.0-or-later`.

- sharp source: <https://github.com/lovell/sharp/tree/v0.35.3>
- libvips source: <https://github.com/libvips/libvips/tree/v8.18.3>
- License and corresponding-source information:
  `scripts/licenses/reference/SHARP-LIBVIPS-SOURCE.md`

The conservative dependency archive includes the complete LGPL v3 text and the
GPL v3 text incorporated by reference. sharp/libvips are excluded from
Electron and compiled web CLI runtime payloads; post-pack checks reject their
presence in end-user installers.

## option-ext

WINK GO executables include the unmodified `option-ext` Rust crate version
`0.2.0` as a transitive dependency of `dirs-sys`/`dirs`.

- License: Mozilla Public License 2.0 (`MPL-2.0`)
- Source Code Form:
  <https://crates.io/api/v1/crates/option-ext/0.2.0/download>
- crates.io archive SHA-256:
  `04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d`
- Browsable source and complete license:
  <https://docs.rs/crate/option-ext/0.2.0/source/>

The source archive above is the exact source package selected by
`backend/Cargo.lock`; WINK GO has not modified its covered source files.
The complete MPL 2.0 text is also included in
`legal/THIRD_PARTY_LICENSES.txt`.

## Node.js and npm managed runtime

WINK GO can distribute the official Node.js `24.11.0` runtime, which embeds
npm `11.6.1`, so its built-in agents work without a separate Node.js setup.

- Node.js source and license: <https://github.com/nodejs/node/tree/v24.11.0>
- Official release and signed checksum files:
  <https://nodejs.org/dist/v24.11.0/>
- npm source and license:
  <https://github.com/npm/cli/tree/v11.6.1>
- Licenses: Node.js is MIT; npm is Artistic-2.0. Additional license notices
  shipped by those official distributions remain inside their runtime trees.

Every supported archive is fixed to the SHA-256 published in Node.js
`SHASUMS256.txt`:

| Archive                             | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `node-v24.11.0-darwin-arm64.tar.gz` | `0be2ab2816a4fa02d1acff014a434f29f56d8d956f5af6a98b70ced6c5f4d201` |
| `node-v24.11.0-darwin-x64.tar.gz`   | `3884671e87f46f773832d98a0a6cabcc5ec4f637084f0f3515b69e66ea27f2f1` |
| `node-v24.11.0-linux-arm64.tar.gz`  | `4786d00c4d259d3ff0b2328307f764ef3ced65f2d6e9502d433e68d66238509d` |
| `node-v24.11.0-linux-x64.tar.gz`    | `b3c071cdf47aab867c3b2aa287257df12ec5d7c962bf922b32fd33226c4295fd` |
| `node-v24.11.0-win-arm64.zip`       | `12d3b1aa9696b7411e115a4fa2aef57f95560b5ee16bb62cd69843e535ec72be` |
| `node-v24.11.0-win-x64.zip`         | `1054540bce22b54ec7e50ebc078ec5d090700a77657607a58f6a64df21f49fdd` |

The managed-resource contract and release checks require both Node.js's root
`LICENSE` and npm's own `LICENSE` to remain present in every packaged runtime.

## Build-only tools

The dependency inventory is intentionally a compliance-safe superset and
therefore includes development/build packages. In particular, target-specific
`@sentry/cli-*` packages licensed under `FSL-1.1-MIT` are used only while
building and uploading diagnostics metadata; they are not included in WINK GO
end-user installers.

## Package dependencies

Exact Bun/npm and Cargo dependency versions are recorded in
`legal/THIRD_PARTY_DEPENDENCIES.json`. Deduplicated license and notice texts are
provided in `legal/THIRD_PARTY_LICENSES.txt`.
