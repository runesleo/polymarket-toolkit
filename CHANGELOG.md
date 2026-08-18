# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and tagged toolkit releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `examples/22-tennis-event-livescore.ts` + `docs/tennis-livescore-source.md`: read-only cross-check of a Polymarket tennis event's Gamma resolution inputs against an independent live score (Live Tennis API free tier, opt-in via `LIVETENNIS_API_KEY`).
- Glama metadata and a root Docker entrypoint pinned to the official `polymarket-toolkit-mcp@0.7.2` package.
- Regression coverage for the Docker package selection, maintainer metadata, official npm registry, and packed executable mode.

### Fixed

- MCP package builds now preserve executable permissions on `dist/server.js`, so npm-installed stdio clients can start the declared binary.

## [0.5.0] - 2026-05-26

### Added

- Toolbox CLI, bilingual documentation, and the builder attribution helper.

## [0.4.0] - 2026-05-02

### Added

- Redeem watchdog observability for the pUSD era.

[Unreleased]: https://github.com/runesleo/polymarket-toolkit/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/runesleo/polymarket-toolkit/releases/tag/v0.5.0
[0.4.0]: https://github.com/runesleo/polymarket-toolkit/releases/tag/v0.4.0
