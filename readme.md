# WINK GO

WINK GO is a cross-platform desktop workspace for AI agents. It brings local and remote agents, files, tools, skills, scheduled tasks, WebUI access, and multi-agent collaboration into one application.

[Website](https://winkgo.top) · [Repository](https://github.com/xuweihafeichangniu-lab/wink) · [Releases](https://github.com/xuweihafeichangniu-lab/wink/releases) · [Issues](https://github.com/xuweihafeichangniu-lab/wink/issues)

## Edition status

| Edition     | Current status                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Free 2.1.45 | Full access. The Free edition currently includes every feature available in the Pro build.                |
| Pro         | Reserved for future edition and licensing work. It does not currently unlock additional product features. |

Users of Free 2.1.45 do not need a Pro build to use the complete feature set.

## Highlights

- Work with built-in and external AI agents from one desktop interface.
- Give agents controlled access to files, previews, tools, MCP integrations, and reusable skills.
- Run multiple agents and coordinated teams in parallel.
- Use WebUI and supported channels for remote access.
- Create scheduled and unattended workflows.
- Build and use editable document, presentation, and spreadsheet workflows.

## Development

Requirements: Bun, Node.js 22, and the platform prerequisites described in [the development guide](docs/contributing/development.md).

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run lint
bun run test
bun run format:check
```

Free desktop builds use `WINKGO_EDITION=free`. Pro build commands are development-only while the Pro distribution path remains reserved.

## Documentation

- [Documentation index](docs/README.md)
- [Development guide](docs/contributing/development.md)
- [Local runtime assets](docs/guides/local-runtime-assets.md)
- [WebUI guide](docs/guides/webui.md)
- [Contributing](CONTRIBUTING.md)

Localized project summaries are available in [简体中文](docs/readme/readme_ch.md), [繁體中文](docs/readme/readme_tw.md), [日本語](docs/readme/readme_jp.md), [한국어](docs/readme/readme_ko.md), [Español](docs/readme/readme_es.md), [Português](docs/readme/readme_pt.md), [Türkçe](docs/readme/readme_tr.md), [Русский](docs/readme/readme_ru.md), and [Українська](docs/readme/readme_uk.md).

## License

WINK GO is distributed under the [Apache License 2.0](LICENSE). Required attribution for incorporated third-party work is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
