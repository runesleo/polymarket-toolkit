---
name: polymarket-pnl
description: Reconstruct Polymarket PnL from Data API v2 cashflows (BUY/SELL/REDEEM/MERGE/SPLIT/MAKER_REBATE) plus current position value, with cursor pagination and explicit completeness flags. Bring-your-own Python (httpx).
allowed-tools: Bash(python3:*) Read Write Edit
metadata: {"version":"0.3.0","openclaw":{"skillKey":"polymarket-pnl","homepage":"https://leolabs.me","requires":{"anyBins":["python3"]}}}
---

# Polymarket Precise PnL

Reconstruct PnL from the activity and positions served by Data API v2. The original cashflow formulas remain unchanged:

```text
pnl = SELL + REDEEM + MERGE + MAKER_REBATE - BUY - SPLIT + current_position_value
pnl_inclusive = pnl + REWARD + REFERRAL_REWARD + CONVERSION
```

Activity cash amounts come from `usdc_size`, preserving the existing fee-inclusive cash basis; do not replace them with `size * price` or subtract position entry fees again. Position value remains `current_size * current_price`, not the API's `unrealized_pnl` or lifetime `total_size`.

`complete=true` means the API cursor walks finished and no supported check found missing data or unsupported economics. It is not proof of a complete on-chain ledger. Earlier v1 validation claims (~0.2% MAPE and top accounts within 1%) do not establish v2 accuracy. The v2 all-time leaderboard is realized-only, so it is a different metric from this formula that includes current holdings.

## Trigger

Invoke this skill when the user wants:

- Cashflow PnL with explicit data limitations for one or more Polymarket addresses
- Bulk PnL over a leaderboard or an address list
- Benchmark mode: compare a local PnL dataset with a fresh cashflow reconstruction

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

`${SKILL_DIR}` is the path where this skill lives (for example, `/path/to/your/agent/skills/polymarket-pnl/`).

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

The CLI exits with status 1 if any address fails or yields an incomplete result. A valid but incomplete record remains in JSONL with its flags; it is excluded from rankings and comparison statistics. Missing required amounts/prices or invalid response envelopes fail the address without emitting a misleading numeric record.

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
| `complete` | bool | `True` only when activity/position cursor walks finish and no known economic coverage flag is present; scoped to API-served data |
| `positions_truncated` | bool | Position pagination could not reach a verified terminal page |
| `pagination_incomplete` | bool | An activity cursor walk was stopped by a repeated cursor |
| `pagination_incomplete_types` | list\[str\] \| None | Affected streams, such as `"TRADE"`, `"REDEEM"`, `"MERGE"` |
| `data_incomplete_reasons` | list\[str\] \| None | Known economic coverage or resumed-snapshot limitations |

## Known limitations

- **API coverage**: `start=1` requests full served activity history rather than the default three-year window. Positions request `status=OPEN` (including unredeemed positions), `filter_type=TOKENS`, `filter_amount=0`, and `include_archived=true`. Upstream inactive-market exclusion, dust handling, indexer lag, or omitted events can still limit coverage; this script does not independently replay chain logs or value external token transfers.
- **New economic events**: the script probes `MIGRATION`, `YIELD`, `TAKER_REBATE`, `DIRECTIONAL_SPLIT`, `DIRECTIONAL_MERGE`, `THRESHOLD_COMPOSE`, `THRESHOLD_DECOMPOSE`, and `TIP`. Presence sets `complete=false` with `unsupported_activity:<TYPE>`; their cashflows are not silently added to the old formula. Future API event types require contract review. Deposits/withdrawals are capital flows, not trading income.
- **Combos and CONVERSION**: observed `is_combo=true`, any record from the separate `/v2/activity/combos` presence probe, or any CONVERSION marks the result incomplete because combo positions and neg-risk conversion collateral are not fully replayed. Existing amounts/formulas are retained for review, not promoted to an exact total.
- **Snapshot timing**: the separate activity streams and position marks are not one atomic snapshot. Resuming a TRADE checkpoint sets `resumed_trade_checkpoint_requires_fresh_snapshot`; run a fresh computation for a complete result. v1 or mismatched checkpoint identities restart from zero; malformed current-schema state is rejected.
- **`pnl` vs `pnl_inclusive`**: REWARD, REFERRAL_REWARD, and CONVERSION remain excluded from `pnl` and included in `pnl_inclusive`. The all-time leaderboard comparison reports relative differences, not an accuracy score. Compare with an independently reconciled ledger using the same time and accounting basis for accuracy validation.
- **Pagination**: v2 opaque cursors replace all offset caps and timestamp subtraction. Short/empty pages with a cursor are followed, identical fills are retained, and repeated cursors are flagged. An HTTP/schema failure fails the address instead of treating a partial prefix as zero or complete.
- **Requires `httpx`**: the only third-party dependency, for its robust TLS/HTTP/1.1 handling against the Data API.
- **No authentication**: uses public `data-api.polymarket.com` endpoints, with no API keys or private account data.

## Comparison with `polymarket-profile`

| Aspect | `polymarket-profile` | `polymarket-pnl` (this skill) |
|--------|---------------------|-------------------------------|
| Runtime | curl + jq / node | Python 3 + httpx |
| PnL method | Position-level cashPnL (approximate) | Activity cashflow plus current holdings, with completeness flags |
| Bulk mode | Single address per call | Single / leaderboard / address list |
| Win rate / categories | ✅ | ❌ (PnL only) |
| Benchmarking | ❌ | ✅ vs local dataset |
| Best for | "Who is this address?" | "What PnL can public cashflows support, and what is missing?" |

Use them together: `polymarket-profile` for the qualitative picture, `polymarket-pnl` when the PnL number has to hold up to scrutiny.

## Data sources

All public, no authentication required:

| API | What it provides |
|-----|-----------------|
| `data-api.polymarket.com/v2/activity` | TRADE (BUY/SELL), REDEEM, MERGE, SPLIT, MAKER_REBATE, REWARD, REFERRAL_REWARD, CONVERSION; separate unsupported-event probe |
| `data-api.polymarket.com/v2/activity/combos` | Detect combo lifecycle events not represented by the original formula |
| `data-api.polymarket.com/v2/positions` | Current held position sizes/prices, including unredeemed positions |
| `data-api.polymarket.com/v2/leaderboard` | Ranked addresses; all-time PnL is realized-only |

Contract references: [v2 migration](https://docs.polymarket.com/migrate/data-api-v1-to-v2), [activity](https://docs.polymarket.com/api-reference/feeds/list-account-activity), [positions](https://docs.polymarket.com/api-reference/wallet/list-positions-for-a-user-or-market), [leaderboard](https://docs.polymarket.com/api-reference/boards/get-the-trader-leaderboard).

## Setup

```bash
# Claude Code
export AGENT_SKILLS_DIR=/path/to/your/agent/skills
cp -R skills/polymarket-pnl "$AGENT_SKILLS_DIR/"
pip install httpx

# OpenClaw
cp -R skills/polymarket-pnl ~/.openclaw/skills/
pip install httpx
```

New to Polymarket? [Create an account here](https://polymarket.com/?r=githuball&via=runes-leo&utm_source=github&utm_content=polymarket-toolkit).

## License

MIT — see repository root LICENSE.
