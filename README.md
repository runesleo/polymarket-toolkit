# Polymarket Toolkit

AI-powered tools for Polymarket prediction market analysis. Built for AI agents — works with Claude Code, OpenClaw, Cursor, or any LLM that can run shell commands.

## polymarket-profile

Turn any Polymarket address into a complete trading profile.

### What you get

- **PnL Overview** — Total profit/loss, 7d/30d trends
- **Win Rate** — Accurate settlement-based calculation (not position-level approximation)
- **Open Positions** — Current holdings with unrealized PnL and expiry dates
- **Activity Breakdown** — TRADE / SPLIT / MERGE / REDEEM volume with full pagination
- **Category Distribution** — Where the money goes: Crypto, Politics, Sports, Weather, etc.
- **Top Wins & Losses** — Best and worst settled positions
- **Strategy Pattern** — Auto-detected: Market Maker, SPLIT Arbitrage, Diversified, Whale, etc.

### How it works

The skill instructs your AI agent to call Polymarket's public APIs (lb-api, data-api, gamma-api), process the data, and output a structured profile. No API key needed, no local database, no setup.

```
You: Profile this Polymarket address: 0x63ce342161250d705dc0b16df89036c8e5f9ba9a

AI: Fetching data... (paginating 12 pages of activity)

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      Polymarket Profile: 0x8dxd
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    📊 Overview
      Total PnL:  $2,382,780.64
      Win Rate:   6/11 (54.5%)
      ...

    🎯 Strategy: Market Maker (high-frequency, concentrated in Crypto)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Setup

**Claude Code:**
```bash
# Copy the skill to your skills directory
cp -R skills/polymarket-profile ~/.claude/skills/
```

**OpenClaw:**
```bash
cp -R skills/polymarket-profile ~/.openclaw/skills/
```

**Any other AI agent:**
Just paste the content of `skills/polymarket-profile/SKILL.md` into your conversation and ask your AI to follow the instructions.

### Requirements

- An AI agent that can run `curl` commands
- Internet access to Polymarket APIs (some endpoints may need a proxy in certain regions)
- That's it. No API keys, no database, no dependencies.

New to Polymarket? [Create an account here](https://polymarket.com/signup?via=runes-leo&utm_source=github&utm_content=polymarket-toolkit).

### Supported input

| Input | Example | Resolution |
|-------|---------|------------|
| 0x address | `0x63ce342161250d705dc0b16df89036c8e5f9ba9a` | Direct |
| Profile URL | `polymarket.com/profile/Theo4` | Auto-resolve via leaderboard |
| Username | `Theo4` | Auto-resolve via leaderboard |

Username lookup works for all leaderboard-ranked users (auto-resolved via `lb-api`). Unranked accounts (zero trading history) require the 0x address directly.

### Data sources

All public, no authentication required:

| API | What it provides |
|-----|-----------------|
| `lb-api.polymarket.com` | PnL, leaderboard rankings |
| `data-api.polymarket.com` | Positions, activity history |
| `gamma-api.polymarket.com` | Market metadata, categories, tags |

### Known limitations (v0.1)

- Username → address auto-resolution works for leaderboard-ranked users only (unranked accounts need 0x address)
- Category mapping uses Gamma API tags + keyword fallback (not 100% accurate)
- Top Wins/Losses uses position-level cashPnl (approximate, not per-trade)
- Large accounts (10K+ trades) may take 30+ seconds to paginate
- lb-api 7d/30d PnL may return empty for inactive accounts

## Roadmap

**Analysis Tools**
- [ ] PnL Calculator — Precise per-trade PnL with MERGE/SPLIT/REDEEM handling
- [ ] Brier Score Rating — Prediction quality scoring per address
- [ ] Trading Style Tags — Conservative / Aggressive / Event-driven / Market Maker labels

**Market Intelligence**
- [ ] Market Scanner — Discover markets by category, volume, spread, or pricing inefficiency
- [ ] Market Liquidity Gauge — Spread, depth, and maker concentration analysis
- [ ] LP Reward Scanner — Find active liquidity incentive programs and estimate APY

**Tracking & Alerts**
- [ ] Leaderboard Tracker — Daily snapshots, rank changes, streak detection
- [ ] Whale Alert — Large position changes from top traders

**API** (planned)
- [ ] REST API for all tools above — integrate Polymarket intelligence into your own apps

## Author

**Leo** ([@runes_leo](https://x.com/runes_leo))

AI × Crypto independent builder. Trading prediction markets with AI-powered strategies.

- [leolabs.me](https://leolabs.me) — Open-source tools & research
