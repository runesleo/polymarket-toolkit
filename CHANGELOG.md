# Changelog

**Repository:** https://github.com/runesleo/polymarket-toolkit

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- PnL cashflow reconstruction: preserve duplicate PnL boundary rows ([`a23cc45`](https://github.com/runesleo/polymarket-toolkit/commit/a23cc457bd91b16358acdbb7c24825f2995d0660)).
- PnL backfill: exact-second backfill runs even when `oldest_count == 1` ([`f89a5f0`](https://github.com/runesleo/polymarket-toolkit/commit/f89a5f059f44eb1df68b4bd1e990225bd9d19567)).

## [0.3.0] - 2026-04-22

### Added

- `polymarket-pnl` Claude skill — audit-grade PnL via Data API cashflow reconstruction ([`9a852bb`](https://github.com/runesleo/polymarket-toolkit/commit/9a852bb934e503a502edab5c42e13c2eb5041f6a), [#2](https://github.com/runesleo/polymarket-toolkit/pull/2)).

### Changed

- Polymarket outbound links upgraded to double-suffix attribution ([`06930ac`](https://github.com/runesleo/polymarket-toolkit/commit/06930ac156238a2e13ddd6152c33a465888a9655), [#4](https://github.com/runesleo/polymarket-toolkit/pull/4)).
- README Author section synced to latest SSOT template ([`9bb09d7`](https://github.com/runesleo/polymarket-toolkit/commit/9bb09d7c63dc1975ada7fe6a5cd0e2566bfa29fc), [#3](https://github.com/runesleo/polymarket-toolkit/pull/3)).

## [0.2.0] - 2026-03-31

### Added

- `polymarket-brier` skill — Brier score and prediction-quality analysis ([`a3f4e03`](https://github.com/runesleo/polymarket-toolkit/commit/a3f4e03831424d85c74188142b3beba0168fad01), [`44f9e02`](https://github.com/runesleo/polymarket-toolkit/commit/44f9e02191bfe0d73024e465cb9231e85ca90555)).

### Removed

- `polymarket-leaderboard` ship attempt reverted ([`5e86aad`](https://github.com/runesleo/polymarket-toolkit/commit/5e86aadbbfc25f614fcd9e788c189c4870b00336)) — leaderboard skill briefly landed then rolled back in favor of Brier-first roadmap.

## [0.1.x] - 2026-03-26 .. 2026-03-27

### Added

- Initial public toolkit: strategy pattern detection, Gamma category mapping, username ↔ address resolution via leaderboard API ([`f335b1d`](https://github.com/runesleo/polymarket-toolkit/commit/f335b1df5238d5da9d472a1ab127d8be8d04702b), [`984b0eb`](https://github.com/runesleo/polymarket-toolkit/commit/984b0ebfb148cd26100c1a41fedbb04ade2213e0), [`e4178d6`](https://github.com/runesleo/polymarket-toolkit/commit/e4178d671235a66ef1668101ab15fbfeff51f179), [`f990264`](https://github.com/runesleo/polymarket-toolkit/commit/f9902647eacb55200e49ce751101f950ef296fec)).
- MIT `LICENSE` and `.gitignore` for open release ([`bacc711`](https://github.com/runesleo/polymarket-toolkit/commit/bacc7116484c8681b7ab0c598da7fb4e30cc3c45)).

### Changed

- Expanded roadmap: analysis, intelligence, tracking, and API tiers ([`e2e10c2`](https://github.com/runesleo/polymarket-toolkit/commit/e2e10c2b7f0df5a6c12980527a338beb85dff877)).

### Fixed

- README / examples: remove personal trading profile exposure ([`8c5d68e`](https://github.com/runesleo/polymarket-toolkit/commit/8c5d68e23b93fc8db80f726813600b42c2595113)).
- Affiliate signup path corrected ([`b0042c4`](https://github.com/runesleo/polymarket-toolkit/commit/b0042c4d862aca6a77ab58b39799897fbd649f21)).
- Roadmap wording: PnL described at position level, not per-trade ([`c0fb387`](https://github.com/runesleo/polymarket-toolkit/commit/c0fb38724054940c3823bd7a6e0116a27b27013e)).
- Integration-test findings (four bugs) ([`7a6f629`](https://github.com/runesleo/polymarket-toolkit/commit/7a6f6295c87c6f5a626776f1445ab9fb2a6206db)).
- Pagination: drop contradictory 500-record shortcut, enforce full scans ([`5ff8a26`](https://github.com/runesleo/polymarket-toolkit/commit/5ff8a268a4273cc7a88583a2765c549d900a8cad)).
