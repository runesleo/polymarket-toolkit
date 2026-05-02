# Polymarket Toolkit

AI-powered tools for Polymarket prediction market analysis. Built for AI agents — works with Claude Code, OpenClaw, Cursor, or any LLM that can run shell commands.

## What's New in v0.4

**New public helper: redeem watchdog** — inspect redeemable positions without private keys.

After Polymarket's pUSD-era redemption flow, most users should rely on the official app for normal redemption. Agents still need a status lane: which wallet has redeemable value, which condition is stuck, and whether a low-cash strategy account needs attention. v0.4 adds `fetchRedeemablePositionsPage`, `summarizeRedeemablePositions`, and `resolveRedeemMode` for that exact workflow. It never signs or sends transactions.

```ts
import {
  fetchRedeemablePositionsPage,
  summarizeRedeemablePositions,
} from "./src/index.ts";

const positions = await fetchRedeemablePositionsPage("0x...");
console.log(summarizeRedeemablePositions(positions as never[]));
```

## What's New in v0.3

**New Skill: `polymarket-pnl`** — Audit-grade PnL via Data API cashflow reconstruction.

Most profilers (including `polymarket-profile`) use position-level `cashPnL` which is an approximation. `polymarket-pnl` replays every BUY / SELL / REDEEM / MERGE / SPLIT / REBATE event and reconciles against current unrealized position value. Validated against Polymarket's official `/profit` endpoint on the public leaderboard: **MAPE ~0.2%**, all top accounts within 1% error. Use this when the number has to hold up to scrutiny.

## TypeScript quickstart (public APIs)

Small, **zero-dependency** helpers for Polymarket’s public **Gamma**, **Data**, **LB**, and **CLOB** endpoints live in [`src/index.ts`](./src/index.ts). Run any demo with **Node 18+**:

```bash
npx tsx examples/01-fetch-gamma-markets.ts
# Zero extra installs on Node 22+:
node --experimental-strip-types examples/01-fetch-gamma-markets.ts
```

- **Examples index:** [`examples/`](./examples/) — one numbered script per exported helper (each file stays short and self-contained).
- **Bilingual recipes:** [`docs/cookbook.md`](./docs/cookbook.md) — ten common tasks (English first, Chinese rewrite) with copy-paste snippets and sample output.

## Skills

| Skill | What it does |
|-------|-------------|
| `polymarket-profile` | Deep profile any address — PnL, win rate, positions, categories, strategy detection |
| `polymarket-brier` | Prediction accuracy scoring, calibration analysis, forecast quality rating |
| `polymarket-pnl` | **NEW** — Audit-grade PnL via cashflow reconstruction (~0.2% MAPE vs. official) |
| Public TS helpers | **NEW in v0.4** — redeem watchdog, Gamma/Data/LB/CLOB helpers |

---

## Redeem Watchdog Helpers

Inspect redeemable positions for a public proxy wallet without touching keys, allowances, relayers, or transactions.

### What you get

- **Redeemable scan** — `fetchRedeemablePositionsPage(user)` calls Data API `/positions?redeemable=true`
- **Condition rollup** — `summarizeRedeemablePositions(rows)` groups by condition id and estimates redeemable value
- **Policy label** — `resolveRedeemMode({ lowWatermark })` returns `watchdog`, `low_watermark`, or `active` for agent reports

### Example

```bash
npx tsx examples/15-redeem-watchdog.ts 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
```

```json
{
  "mode": "low_watermark",
  "redeemableCount": 2,
  "conditionCount": 1,
  "estimatedRedeemableValue": 10,
  "topConditions": [
    { "conditionId": "0x...", "slug": "some-market", "count": 2, "estimatedValue": 10 }
  ]
}
```

### Safety boundary

This toolkit only reads public APIs. It does not redeem tokens, sign Safe transactions, call relayers, move funds, or require private keys. Treat it as a dashboard/agent primitive; execution belongs in your own production wallet system.

---

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

New to Polymarket? [Create an account here](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit).

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

### Known limitations

- Username → address auto-resolution works for leaderboard-ranked users only (unranked accounts need 0x address)
- Category mapping uses Gamma API tags + keyword fallback (not 100% accurate)
- Top Wins/Losses uses position-level cashPnl (approximate, not per-trade)
- Large accounts (10K+ trades) may take 30+ seconds to paginate
- lb-api 7d/30d PnL may return empty for inactive accounts

---

## polymarket-brier

Rate any trader's prediction accuracy with Brier Score — the standard metric used by Metaculus, Good Judgment Project, and forecasting research.

### Why not just look at PnL?

| Trader Type | PnL | Brier Score | Signal Value |
|-------------|-----|-------------|-------------|
| Skilled predictor | High | Good (low) | Best signal source |
| Market maker | High | Poor (high) | Earns spread, not predictions |
| SPLIT arbitrageur | High | N/A | Market-neutral, no directional view |
| Accurate but cautious | Low | Good (low) | Good signal, small sizing |

### Example

```
You: What's the Brier Score for Theo4?

AI: Fetching settled positions...

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    Brier Score: Theo4
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📊 Prediction Accuracy
    Brier Score:      0.12 (Good)
    Settled Markets:  36
    Correct:          29/36 (81%)

  📐 Calibration
    | Confidence | Positions | Forecast | Actual | Gap  |
    |------------|-----------|----------|--------|------|
    | High       | 12        | 87%      | 83%    | -4%  |
    | Moderate   | 15        | 68%      | 67%    | -1%  |
    | Coin flip  | 6         | 52%      | 50%    | -2%  |
    | Contrarian | 3         | 28%      | 33%    | +5%  |
```

### Setup

```bash
# Claude Code
cp -R skills/polymarket-brier ~/.claude/skills/

# OpenClaw
cp -R skills/polymarket-brier ~/.openclaw/skills/
```

After installation: "What's the Brier Score for 0x63ce..." or "How accurate is Theo4's predictions?"

New to Polymarket? [Create an account here](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit).

---

## polymarket-pnl

Audit-grade PnL for any Polymarket address via Data API cashflow reconstruction. Replays every BUY / SELL / REDEEM / MERGE / SPLIT / REBATE event and reconciles against current unrealized position value.

### Why not just use position-level cashPnL?

Position-level `cashPnL` (what most profilers surface) is rounded at the position level and drops partial fills, making it approximate. `polymarket-pnl` walks the full activity log — every trade event, every REDEEM, every MERGE — and computes PnL from the cashflow identity:

```
PnL = SUM(SELL + REDEEM + MERGE + REBATE) - SUM(BUY + SPLIT) + unrealized_position_value
```

Validated on Polymarket's own leaderboard: `precise_pnl` matches the official `/profit` endpoint within **0.2% MAPE** on top traders.

### Example

```
You: Compute precise PnL for the top 10 leaderboard addresses.

AI: Fetching leaderboard... (10 addresses)
    Processing 0x56687bf447... (15,993 trades)
    ...

    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      Benchmark: Precise PnL vs Leaderboard (official /profit)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      ✅ 0x56687bf447... precise=$22,032,643.17  official=$22,053,933.75  err=0.1%
      ✅ 0x1f2dd6d473... precise=$16,580,235.20  official=$16,619,506.63  err=0.2%
      ...

      MAPE: 0.2%  |  <10%: 10/10  |  <30%: 10/10
```

### Setup

```bash
# Claude Code
cp -R skills/polymarket-pnl ~/.claude/skills/
pip install httpx  # the only runtime dependency

# OpenClaw
cp -R skills/polymarket-pnl ~/.openclaw/skills/
pip install httpx
```

### CLI usage

```bash
# Single address
python3 compute_precise_pnl.py --address 0x63ce342161250d705dc0b16df89036c8e5f9ba9a

# Bulk over the leaderboard
python3 compute_precise_pnl.py --leaderboard 50 -o top50.jsonl

# Benchmark a local PnL dataset vs. recomputed precise PnL
python3 compute_precise_pnl.py --leaderboard 100 \
  --benchmark local_pnl.jsonl \
  -o benchmark.jsonl
```

Output is JSONL with one record per address. See `skills/polymarket-pnl/SKILL.md` for the full output schema.

### When to use `polymarket-profile` vs `polymarket-pnl`

- **`polymarket-profile`** — curl-only, qualitative profile (win rate, positions, categories). Best for "who is this address?"
- **`polymarket-pnl`** — Python + audit-grade cashflow reconstruction. Best for "what is their real PnL?" — writing research, benchmarking a model, or building a dataset.

New to Polymarket? [Create an account here](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit).

---

## Roadmap

**Analysis Tools**
- [x] PnL Calculator — Cashflow-reconstructed PnL, ~0.2% MAPE vs. official leaderboard
- [x] Brier Score Rating — Prediction quality scoring per address
- [ ] Trading Style Tags — Conservative / Aggressive / Event-driven / Market Maker labels

**Market Intelligence**
- [ ] Market Scanner — Discover markets by category, volume, spread, or liquidity
- [ ] Market Liquidity Gauge — Spread, depth, and maker concentration analysis
- [ ] LP Reward Scanner — Find active liquidity incentive programs and estimate APY

**Tracking & Alerts**
- [ ] Leaderboard Tracker — Daily snapshots, rank changes, streak detection
- [ ] Whale Alert — Large position changes from top traders
- [x] Redeem Watchdog — public redeemable-position status for agent dashboards

**API** (planned)
- [ ] REST API for all tools above — integrate Polymarket intelligence into your own apps

## About the author

*Leo ([@runes_leo](https://x.com/runes_leo)) — AI × Crypto independent builder. Trading on [Polymarket](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit), building data and trading systems with Claude Code and Codex.*

*[leolabs.me](https://leolabs.me) — writing · community · open-source tools · indie projects · all platforms.*

*[X Subscription](https://x.com/runes_leo/creator-subscriptions/subscribe) — paid content weekly, or just buy me a coffee 😁*

*Learn in public, Build in public.*
