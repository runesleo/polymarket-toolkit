# Polymarket Toolkit

**For builders who run code** — CLI, TypeScript helpers, and AI skills over Polymarket public APIs. No API keys. No signing.

[中文说明](./README.zh.md)

## Toolbox · pick a drawer

| I want to… | Start here |
|------------|------------|
| **Research an address** | `pm profile <addr>` · skills `polymarket-profile` / `polymarket-pnl` / `polymarket-brier` |
| **Scan markets & prices** | `pm markets` · [`examples/01,09,11`](./examples/) · [`docs/cookbook.md`](./docs/cookbook.md) |
| **Wire my own data pipeline** | [`src/index.ts`](./src/index.ts) · cookbook · `examples/14` |
| **Validation checklists** | [`docs/templates/`](./docs/templates/) — handoff · backtest · paper · live-gate · runbook |
| **PnL cross-check (LB snapshot)** | `pm pnl-check` · [`docs/fee-inclusive-pnl.md`](./docs/fee-inclusive-pnl.md) |
| **Track leaderboard / redeem / activity** | `pm lb` · `pm redeem` · `pm activity` · [`examples/05–08,15–20`](./examples/) |
| **Give an AI agent tools** | [`skills/`](./skills/) — copy into Claude / OpenClaw / Cursor |

Full index: [**docs/toolbox.md**](./docs/toolbox.md)

### 30-second try

```bash
git clone https://github.com/runesleo/polymarket-toolkit.git && cd polymarket-toolkit
./bin/pm profile 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
```

**What you get:** LB PnL snapshot + first-page positions. For audit-grade PnL, use the `polymarket-pnl` skill.

**V2 merge/split broken?** → [`docs/v2-ctf-ops-faq.md`](./docs/v2-ctf-ops-faq.md) + `./bin/pm v2-check 0x…`

## CLI (`pm`)

Node **22+** (uses `--experimental-strip-types`). From repo root:

```bash
./bin/pm help
./bin/pm profile 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
./bin/pm profile Theo4 --json
./bin/pm brier 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
./bin/pm redeem 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
./bin/pm markets --limit 5 --active
./bin/pm activity 0x63ce342161250d705dc0b16df89036c8e5f9ba9a --type TRADE --max-pages 5
```

Prefer `./bin/pm` from repo root (no install step). Or: `npm run pm -- profile …` · optional `npm link` for global `pm`.

| Command | What it does |
|---------|--------------|
| `pm profile` | LB PnL + open positions sample + Brier hint |
| `pm activity` | Activity pagination + **~4000 row cap warnings** |
| `pm scan` | Top markets by 24h volume + spread |
| `pm updown` | Crypto updown event fields / resolution source |
| `pm v2-check` | V2 CTF split/merge checklist + activity sample |
| `pm lb` | Leaderboard snapshot + day-over-day diff |
| `pm pnl-check` | LB snapshot + hints — not audit-grade PnL |
| `pm limits` | Official API rate limit pacing |
| `pm brier` | Brier score from settled positions (sample) |
| `pm redeem` | Read-only redeem watchdog JSON |
| `pm markets` | Quick Gamma market list |

Audit-grade PnL (Python): `python3 skills/polymarket-pnl/compute_precise_pnl.py --address …`

## TypeScript library

Zero-dependency helpers in [`src/index.ts`](./src/index.ts). Run demos with Node 22+:

```bash
npx tsx examples/01-fetch-gamma-markets.ts
node --experimental-strip-types examples/01-fetch-gamma-markets.ts
```

- **Examples:** [`examples/`](./examples/) — one numbered script per API pattern
- **Cookbook:** [`docs/cookbook.md`](./docs/cookbook.md) — bilingual recipes

## Skills (AI agents)

| Skill | What it does |
|-------|-------------|
| `polymarket-profile` | Deep profile — PnL, win rate, positions, categories, strategy detection |
| `polymarket-brier` | Prediction accuracy scoring, calibration analysis |
| `polymarket-pnl` | Audit-grade PnL via cashflow reconstruction (~0.2% MAPE vs. official) |

Install: `cp -R skills/polymarket-profile ~/.claude/skills/` (same for OpenClaw).  
`polymarket-pnl` also needs: `pip install httpx`

Skill details: [`skills/*/SKILL.md`](./skills/) · long-form docs in sections below.

---

## What's in this repo

| Included | Not included |
|----------|--------------|
| Read-only APIs, CLI, skills, docs, templates | Private keys, signing, or trade execution |
| V2 FAQ + `pm v2-check` diagnostics | Runnable merge/split/redeem modules |
| `polymarket-pnl` audit script | Custodial wallets or one-click trading |

This repo never holds keys or sends transactions. For normal redemption, use the official Polymarket app.

New to [Polymarket](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit)? Sign up via the link above (**affiliate disclosure:** the author may earn referral rewards; no extra cost to you).

Building your own order executor? Optional [builder attribution](./docs/builder-attribution.md) applies only when **you** submit CLOB orders — this read-only toolkit does not attach a builder code by itself.

---

## Release notes

### v0.5 — Toolbox CLI + roadmap flagships

- **`pm` CLI** — profile · activity · scan · updown · v2-check · brier · redeem · markets
- **Activity cap detection** — duplicate-page warnings near ~4000 rows
- **V2 CTF FAQ** — [`docs/v2-ctf-ops-faq.md`](./docs/v2-ctf-ops-faq.md) (split/merge/convert · infra alignment)
- **Market scanner** · **crypto updown fields** · **handoff template** — [toolbox.md](./docs/toolbox.md)

### v0.4 — Redeem watchdog

**New public helper: redeem watchdog** — inspect redeemable positions without private keys.

Polymarket's pUSD-era redemption flow handles normal user redemption inside the official app. This release does **not** replace or work around that flow. It adds a read-only status lane for agents and dashboards: which wallet still has rows surfaced as `redeemable=true` by the public Data API, what their `currentValue` is (winning rows pay out, losing rows pay $0), and whether a strategy account is below a configured cash watermark. v0.4 adds `fetchRedeemablePositionsPage`, `summarizeRedeemablePositions`, and `resolveRedeemMode` for that workflow. It never signs or sends transactions.

```ts
import {
  fetchRedeemablePositionsPage,
  summarizeRedeemablePositions,
} from "./src/index.ts";

const positions = await fetchRedeemablePositionsPage("0x...");
console.log(summarizeRedeemablePositions(positions as never[]));
```

Also: **`pm` CLI** (toolbox drawers) — see [docs/toolbox.md](./docs/toolbox.md).

### v0.3 — polymarket-pnl skill

**New Skill: `polymarket-pnl`** — Audit-grade PnL via Data API cashflow reconstruction.

Most profilers (including `polymarket-profile`) use position-level `cashPnL` which is an approximation. `polymarket-pnl` replays every BUY / SELL / REDEEM / MERGE / SPLIT / REBATE event and reconciles against current unrealized position value. Validated against Polymarket's official `/profit` endpoint on the public leaderboard: **MAPE ~0.2%**, all top accounts within 1% error. Use this when the number has to hold up to scrutiny.

---

## Redeem Watchdog Helpers

Inspect redeemable positions for a public proxy wallet without touching keys, allowances, relayers, or transactions.

### What you get

- **Redeemable scan** — `fetchRedeemablePositionsPage(user)` calls Data API `/positions?redeemable=true`
- **Condition rollup** — `summarizeRedeemablePositions(rows)` groups rows by `conditionId` and sums `currentValue` (losing rows contribute `$0`, which is the correct payable amount — not their `size`)
- **Policy label** — `resolveRedeemMode({ lowWatermark })` returns `"watchdog"` or `"low_watermark"`. There is intentionally no `"active"` value: this toolkit never executes a redeem, so an active label belongs in your own wallet system, not here.

### Example

```bash
npx tsx examples/15-redeem-watchdog.ts 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
```

```json
{
  "mode": "low_watermark",
  "redeemableCount": 3,
  "conditionCount": 3,
  "estimatedRedeemableValue": 0,
  "topConditions": [
    { "conditionId": "0x...", "slug": "btc-updown-5m-1771773600", "count": 1, "estimatedCurrentValue": 0 }
  ]
}
```

> Three rows surfaced as `redeemable=true` but every `currentValue` is `0` — they are losing tokens that redeem to `$0`. The Data API still surfaces them after resolution; the helper reports them honestly without inflating payable value.

### Safety boundary

This toolkit only reads public APIs. It does not redeem tokens, sign Safe transactions, call relayers, move funds, or require private keys. The official Polymarket app remains the right place for normal user redemption. Treat this helper as a dashboard/agent primitive; execution stays in your own wallet system.

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
- **Activity API ~4000 row cap:** continuing pagination may return identical JSON — use `pm activity` / `fetchActivityPages` or `polymarket-pnl` with `pagination_incomplete`

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

## Validation templates

Strategy validation docs from hypothesis → tiny-live (MIT templates):

| Template | Purpose | Path |
|----------|---------|------|
| AI handoff | Cross-session task handoff (7 fields) | [handoff-template.md](./docs/templates/handoff-template.md) |
| Backtest report | Conclusions + abandon line | [backtest-report-template.md](./docs/templates/backtest-report-template.md) |
| Paper checklist | Anti-fake-paper · fill rules + logging | [paper-checklist.md](./docs/templates/paper-checklist.md) |
| Live gate (12 steps) | Tiny-live technical + ops gates | [live-gate-checklist.md](./docs/templates/live-gate-checklist.md) |
| Platform change runbook | V2 / API migration response | [platform-change-runbook.md](./docs/templates/platform-change-runbook.md) |

Also: [fee-inclusive-pnl.md](./docs/fee-inclusive-pnl.md) · full index: [toolbox.md](./docs/toolbox.md)

> Templates are document skeletons; runnable paper/live execution code lives in your own repo.

---

## Roadmap

**Analysis Tools**
- [x] PnL Calculator — Cashflow-reconstructed PnL, ~0.2% MAPE vs. official leaderboard
- [x] Brier Score Rating — Prediction quality scoring per address
- [x] `pm profile` CLI — Quick address snapshot
- [ ] Trading Style Tags — Conservative / Aggressive / Event-driven / Market Maker labels

**Market Intelligence**
- [x] Market Scanner Lite — `pm scan` (24h volume + spread)
- [x] Crypto updown fields — `pm updown` + docs/crypto-updown-price-source.md
- [ ] Market Liquidity Gauge — Depth / maker concentration (deeper)
- [ ] LP Reward Scanner — Incentive programs / APY estimate

**Platform / V2**
- [x] V2 CTF split/merge FAQ + `pm v2-check` (read-only)
- [x] Activity API cap warnings

**Validation templates**
- [x] Strategy handoff — docs/templates/handoff-template.md
- [x] Backtest report — docs/templates/backtest-report-template.md
- [x] Paper checklist — docs/templates/paper-checklist.md
- [x] Live gate 12 steps — docs/templates/live-gate-checklist.md
- [x] Platform change runbook — docs/templates/platform-change-runbook.md

**Tracking & Alerts**
- [x] Leaderboard Tracker Lite — `pm lb` + snapshot diff
- [x] fee-inclusive PnL guide — docs/fee-inclusive-pnl.md + `pm pnl-check`
- [ ] Whale Alert — Large position changes from top traders
- [x] Redeem Watchdog — public redeemable-position status for agent dashboards

**API** (planned)
- [ ] REST API for all tools above — integrate Polymarket intelligence into your own apps

## About the author

*Leo ([@runes_leo](https://x.com/runes_leo)) — AI × Crypto independent builder. Trading on [Polymarket](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit), building data and trading systems with Claude Code and Codex.*

*[leolabs.me](https://leolabs.me) — writing · community · open-source tools · indie projects · all platforms.*

*[X Subscription](https://x.com/runes_leo/creator-subscriptions/subscribe) — paid content weekly, or just buy me a coffee 😁*

*Learn in public, Build in public.*

*Affiliate disclosure: Polymarket signup links in this repo may earn referral rewards; unrelated to MIT toolkit functionality.*
