<!-- Modified from AionUI by WINK GO contributors in 2026. -->

# Selected upstream patches after the pinned baselines

WINK GO remains based on the complete, commit-pinned AionUI `v2.1.41` and
AionCore `v0.1.52` inventories recorded in this directory. Later upstream
history was reviewed through 2026-08-03. Only the changes listed below were
adapted; WINK GO branding, product identity, data model, and WINK GO-only
features were not replaced by an upstream tree.

## AionUI

| Commit | Adapted scope |
| --- | --- |
| `acd05b6` | Avoid unnecessary directory creation at an existing Windows drive root. |
| `bf42952` | Submit permission decisions in one click while guarding duplicate and stale responses. |
| `225e3d0` | Wrap long, unbroken message text safely. |
| `ed94ab9` | Start a chat directly from an enabled assistant row. |
| `4e1cbc9` | Explain that deleting a skill affects new conversations only. |
| `20403d2` | Preserve elapsed-turn timing across conversation switches. |
| `4879b7b` | Disable redundant focus refetch globally while retaining external Google-auth refresh. |
| `2220d6d` | Treat the desktop-pet IPC state as authoritative during settings hydration. |
| `3ccc1a2`, `5f808f0` | Make tray click and close-to-tray behavior consistent. |
| `1a2dee3` | Restore agent-reported ACP context usage without inventing a context-window denominator. |
| `1a6be8e7c9de472831d0c85434a03c2011fc14f2` | Accept an open `@file` menu with Tab while preserving WINK GO's absolute local-path message protocol. |
| `1204ffa88c839f35c71ecb84947202a00e346c7b` | Add a read-only skill file browser; WINK GO uses authenticated Rust HTTP routes and server-side path containment. |
| `bf1f9c9ab33f6c883519141537281d6dfb29b5fa`, `922fbac2fb5557491fd3f36373475cfd35e77f09`, `6d819d6dfde91ebb5ccb15f9c3fd9d1ea3a75017` | Allow a dormant or failed team member to be woken from its read-only model pill, with localized copy. |
| `d768ba550fbc6d21b4f4525dbe1786ed810d1e10` | Keep Office auto-preview inert when the native file watcher is unavailable instead of failing repeatedly. |
| `26a2e72e8`, `6998dc42c` | Add the project-scoped Explorer shell, project roots, directories-first sorting, panel sizing, and conversation-scoped state. |
| `14e189e0f`, `6e01c8887` | Add complete filename search and structured chat-file references, including the loading-window mention fallback. |
| `584fdcf4d`, `303bc8899` | Restore Explorer preview rendering and retain multiple preview tabs. |
| `1a6be8e7c`, `4edea7c5d` | Add reveal highlighting, Tab completion, and operating-system “show in folder” actions. |
| `c213c7652` | Add the latest-message anchor rail and its conversation search entry point. |
| `72784fe4f` | Add the Antigravity conversation UI path, model selection, usage display, and team-chat rendering. |

## AionCore

| Commit | Adapted scope |
| --- | --- |
| `3a2d7e48386fd608b752354f032657c442b13e1b` | Register the MiMo Code ACP agent, its pinned npm package version, native skill paths, and logo. |
| `91f375db0ba355c011309484382f4d5ab90ccbb2` | Register the omp (Oh My Pi) ACP agent, its pinned npm package version, native skill paths, and logo. |
| `bdb6d619c62cd5294bb09248b86b10fc5cd9ba1f` | Degrade gracefully when the operating-system file watcher cannot initialize, including a stable 503 error contract. |
| `0a791002b`, `6197117ef`, `8494a1f95` | Add the Project Explorer runtime, HTTP/WebSocket monitor, noise filtering, and correct watched-subdirectory attribution. |
| `b64ab4fd6`, `575feacd9` | Add cancellable project filename search and project-reference resolution for preview and chat-file flows. |
| `f6977c784` | Add the contained filesystem reveal endpoint used by “show in folder”. |
| `ddfd76b9a` | Add Antigravity as a direct `agy` CLI backend, including permission-hook, model catalog, usage, resume, team, channel, and scheduled-run compatibility. |

## WINK GO adaptation boundaries

- All product-facing names, events, headers, environment variables, IPC names,
  paths, and UI copy use WINK GO identifiers. Upstream names remain only in
  required copyright/provenance notices.
- Project references are resolved against WINK GO's authenticated project
  model and server-side containment checks before files reach a conversation.
- The Antigravity migration follows WINK GO's existing `agent_metadata` schema
  and registers the vendor's `agy` command directly; it is not presented as an
  ACP agent and does not replace WINK GO's own agent.
- Existing WINK GO product features, logos, skills, assistants, WebUI, Dynamic
  Island, mobile pairing, and data directories are outside this patch set and
  were not removed or renamed.

The AionUI and AionCore repositories and copyrights remain identified in
`NOTICE` and `THIRD_PARTY_NOTICES.md`. This file records source provenance only
and does not imply sponsorship, endorsement, or affiliation.
