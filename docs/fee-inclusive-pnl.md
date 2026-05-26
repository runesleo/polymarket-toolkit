# Fee-inclusive PnL · why profile ≠ wallet truth

**Problem:** Polymarket UI / LB leaderboard PnL can look better than cashflow reality because fees, rebates, and position-level rounding differ from event-level replay.

## Three PnL layers (use the right one)

| Layer | Source | Good for |
|-------|--------|----------|
| **LB `/profit`** | `lb-api.polymarket.com` | Quick snapshot · leaderboard rank |
| **Position `cashPnL`** | data-api `/positions` | Profile overview · approximate |
| **Cashflow replay** | data-api `/activity` all types | Audit · research · benchmarking |

## Activity types that move cash (polymarket-pnl replays all)

- `TRADE` (BUY/SELL)
- `REDEEM`, `MERGE`, `SPLIT`
- `MAKER_REBATE`, `REWARD`, `REFERRAL_REWARD`, `CONVERSION`

**Taker fees** affect net PnL but may not show up in a simple LB poll. **Maker rebates** can make wallet-level PnL *better* than naive position marks.

## Quick check (free toolkit)

```bash
./bin/pm pnl-check 0xYourProxy
python3 skills/polymarket-pnl/compute_precise_pnl.py --address 0xYourProxy
```

`pm pnl-check` = LB snapshot + activity type hints + when to run Python audit.

## When numbers disagree

| Symptom | Likely cause |
|---------|----------------|
| LB > precise | Rebates / timing · incomplete activity pagination |
| LB < precise | Unsettled positions · LB window empty |
| Profile win rate ≠ audit | Position-level vs settled-market logic |
| >4000 activity rows | Use `pm activity` warnings · `pagination_incomplete` in pnl skill |

## Audit threshold

`verify_precise_pnl.py` (polymarket-data origin) treats **≤$10** abs delta vs LB all-time as pass for complete rows.
