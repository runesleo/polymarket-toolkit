# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and tagged toolkit releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Moved every Data API read to v2 (`/v2/activity`, `/v2/positions`, `/v2/trades`, `/v2/leaderboard`, `/v2/user-pnl`). v1 routes, `lb-api.polymarket.com` and `user-pnl-api.polymarket.com` answer HTTP 410. The exported fetchers keep their names, options and v1-named rows; `offset` and `limit` above 1000 are served by following v2 cursors, and activity reads ask for the full history (`start=1`) instead of v2's three-year default.
- `fetchActivityPages` pages by cursor for every type, reports a scan stopped at `maxPages` as `INCOMPLETE`, and no longer raises the v1 `APPROACHING_CAP` warning.
- `fetchLbProfitForAddress` reports `amount: null` when v2 answers `pnl: 0` for a wallet with real volume.

### Added

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
