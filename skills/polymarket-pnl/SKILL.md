---
name: polymarket-pnl
description: Precise PnL calculator for any Polymarket address — reconstructs profit/loss from Data API cashflow (BUY/SELL/REDEEM/MERGE/SPLIT/REBATE) plus unrealized position value. Matches official /profit within ~0.2% MAPE on leaderboard validation. Bring-your-own Python (httpx).
allowed-tools: Bash(python3:*) Read Write Edit
metadata: {"version":"0.3.0","openclaw":{"skillKey":"polymarket-pnl","homepage":"https://leolabs.me","requires":{"anyBins":["python3"]}}}
---

# Polymarket Precise PnL

Compute precise, audit-grade PnL for any Polymarket address via the Data API cashflow method. Unlike position-level approximations used by most profilers, this reconstructs every BUY / SELL / REDEEM / MERGE / SPLIT / REBATE event and reconciles against current unrealized position value.

Validated against Polymarket's official `/profit` endpoint on the public leaderboard: **MAPE ~0.2%**, all top accounts within 1% error.

## Trigger

Invoke this skill when the user wants:

- Audit-grade PnL for one or more Polymarket addresses
- Bulk PnL over a leaderboard or an address list
- Benchmark mode: compare a local PnL dataset vs. the official /profit values

If the user just wants a quick profile (win rate, positions, category breakdown), use the `polymarket-profile` skill instead — it's lighter and runs on curl alone.

## Requirements

- `python3` (3.9+)
- One Python package: `httpx`

Install once:

```bash
pip install -r ${SKILL_DIR}/requirements.txt
# or
pip install httpx
```

`${SKILL_DIR}` is the path where this skill lives (e.g. `~/.claude/skills/polymarket-pnl/`).

## Core CLI

All invocations run from the skill directory (or with `python3 <skill_dir>/compute_precise_pnl.py`):

```bash
# Single address
python3 compute_precise_pnl.py --address 0x63ce342161250d705dc0b16df89036c8e5f9ba9a

# Bulk: top N on the leaderboard (auto-fetched)
python3 compute_precise_pnl.py --leaderboard 50

# Address list from a text file (one 0x per line, `#` for comments)
python3 compute_precise_pnl.py --addresses-file targets.txt

# Benchmark: compare your local PnL JSONL against the recomputed precise PnL
python3 compute_precise_pnl.py --leaderboard 100 \
  --benchmark local_pnl.jsonl \
  -o precise_vs_local.jsonl
```

Output is JSONL streamed to `--output` (default: `./precise_pnl.jsonl`).

## Output schema

Each line is one address record:

| Field | Type | Meaning |
|-------|------|---------|
| `address` | str | The lowercase 0x proxy wallet |
| `pnl` | float | Trading cashflow PnL (BUY/SELL/REDEEM/MERGE/SPLIT/REBATE + unrealized). **Primary metric.** |
| `pnl_inclusive` | float | `pnl` + REWARD + REFERRAL_REWARD + CONVERSION (platform credits) |
| `total_buy`, `total_sell`, `total_redeem`, `total_merge`, `total_split`, `total_rebate`, `total_reward`, `total_referral`, `total_conversion` | float | Sum of each activity type |
| `unrealized` | float | Current mark-to-market value of open positions |
| `open_positions` | int | Number of open positions |
| `trade_count` | int | Total BUY + SELL events |
| `computed_at` | int | Unix seconds when record was produced |
| `complete` | bool | `True` if every paginated activity call returned fully |
| `pagination_incomplete` | bool | `True` if the Data API's ~10k offset ceiling was hit for at least one activity type |
| `pagination_incomplete_types` | list\[str\] \| None | Which activity types hit the ceiling (`"BUY"`, `"SELL"`, ...) |

## Known limitations

- **Data API offset ceiling (~10k)**: extremely high-frequency accounts may hit it on one activity type. The record is still emitted with `pagination_incomplete=True` and the field list so you can flag or re-fetch via timestamp-chunked backfill.
- **Same-second full-page boundary**: the timestamp-based pagination uses `end = oldest - 1` with a heuristic backfill pass that only triggers when the boundary timestamp already appears more than once in the current page. If a full page ends with exactly one row at timestamp `T` and additional same-second rows continue onto the next page, those rows may be skipped without `pagination_incomplete` being set. This affects a small subset of very-high-frequency accounts; most addresses stay within 1% of the official `/profit`. A stricter backfill is on the roadmap.
- **`pnl` vs `pnl_inclusive` choice**: Polymarket's official `/profit` endpoint inconsistently includes platform credits across addresses. The primary `pnl` field deliberately excludes them so the number is reproducible from public trade data alone.
- **Requires `httpx`**: the only third-party dependency, for its robust TLS/HTTP/1.1 handling against the Data API.
- **No authentication**: uses only public endpoints (`data-api.polymarket.com`, `gamma-api.polymarket.com`), so there are no API keys to manage but also no access to private endpoints.

## Comparison with `polymarket-profile`

| Aspect | `polymarket-profile` | `polymarket-pnl` (this skill) |
|--------|---------------------|-------------------------------|
| Runtime | curl + jq / node | Python 3 + httpx |
| PnL accuracy | Position-level cashPnL (approximate) | Cashflow reconstruction (~0.2% MAPE) |
| Bulk mode | Single address per call | Single / leaderboard / address list |
| Win rate / categories | ✅ | ❌ (PnL only) |
| Benchmarking | ❌ | ✅ vs local dataset |
| Best for | "Who is this address?" | "What is their audit-grade PnL?" |

Use them together: `polymarket-profile` for the qualitative picture, `polymarket-pnl` when the PnL number has to hold up to scrutiny.

## Data sources

All public, no authentication required:

| API | What it provides |
|-----|-----------------|
| `data-api.polymarket.com/activity` | BUY / SELL / REDEEM / MERGE / SPLIT / REBATE / REWARD / REFERRAL_REWARD / CONVERSION events |
| `data-api.polymarket.com/positions` | Current open positions, for unrealized value |
| `data-api.polymarket.com/v1/leaderboard` | Ranked addresses with official `/profit` values |

## Setup

```bash
# Claude Code
cp -R skills/polymarket-pnl ~/.claude/skills/
pip install httpx

# OpenClaw
cp -R skills/polymarket-pnl ~/.openclaw/skills/
pip install httpx
```

New to Polymarket? [Create an account here](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit).

## License

MIT — see repository root LICENSE.
