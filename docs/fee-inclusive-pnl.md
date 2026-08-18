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

## The main reason your number won't match the profile

> **Polymarket's own PnL — profile, `lb-api`, and the `user-pnl` curve — is *pre-fee*.
> A cashflow replay is inherently *post-fee*.
> `gap ≈ lifetime taker fees − maker rebates`**

This is not an estimate. Both halves are visible in their API:

**1. `/activity` `usdcSize` already contains the fee.** It is not `size * price`:

| side | size | price | usdcSize | size×price | delta |
|------|------|-------|----------|------------|-------|
| BUY | 78.3784 | 0.3700 | 29.9135 | 29.0000 | +0.9135 |
| BUY | 940.1429 | 0.4900 | 472.4171 | 460.6700 | +11.7471 |

The deltas fit the documented `rate × shares × p × (1−p)`, solving to rate = 0.0500
on both rows. Fee is *added* on BUY and *subtracted* on SELL, so replaying
cashflows nets out fees whether you intended it or not.

**2. `/positions` excludes it.** A single row:

```json
{ "initialValue": 2343.3774, "grossInitialValue": 2412.395121,
  "entryFeesUsdc": 69.01766, "cashPnl": -2343.3774 }
```

`grossInitialValue = initialValue + entryFeesUsdc`, and `cashPnl` is computed
against `initialValue` — the fee-free one.

**Measured, predicting the gap before comparing** (2026-08-18):

| wallet profile | replay | official | actual gap | predicted gap | residual |
|---|---|---|---|---|---|
| pure maker | −162.70 | −162.30 | 0.40 | 0.23 | **0.17** |
| heavy taker | −3,893.04 | −2,583.33 | 1,309.71 | 1,308.87 | **0.84** |
| taker, 6.4k trades | −18,125.18 | −10,990.62 | 7,134.56 | 7,177.14 | −42.58 |
| taker + rebates, 44k trades | 220,013.83 | 238,829.73 | 18,815.90 | 18,774.63 | +41.27 |

That last wallet is the one that shows rebates matter too: subtracting fees alone
*overshoots* by $5,747, and it only reconciles once the $5,788.44 of maker
rebates comes out as well.

⚠️ **This is why the disagreement looks inconsistent across wallets.** It scales
with how much of the wallet's flow was taker flow, so a maker matches to the
cent and a heavy taker can be off by tens of thousands. If you are reconciling,
the question to ask first is not "is the tool wrong" but "how much did this
wallet pay in fees".

⚠️ **Fees are recent.** The earliest taker fee on record here is late June 2026,
with the rate stepping 0.03 → 0.05 → 0.07 since. Reconciliations that passed
before then are not evidence that they still pass.

## ⚠️ `MERGE` and `SPLIT` need `sortDirection=ASC`

Measured 2026-08-18, same wallet, same query, only the ordering changed:

| type | default (DESC) | `sortDirection=ASC` |
|---|---|---|
| `MERGE` | **0 rows** | 2562 rows |
| `SPLIT` | **0 rows** | 132 rows |
| `REDEEM` | 10697 rows | 10697 rows |
| `TRADE` | 69161 rows | 69161 rows |

Under DESC those two types return an empty list — with or without `end` — which
is indistinguishable from "this wallet never merged". On the wallet above that
silently removes an eight-figure cashflow. `polymarket-pnl` always sends ASC for
offset paging; if you are writing your own replay, send it too.

## The other big divergence: neg-risk `CONVERSION`

If a wallet's gap is *far* larger than its fee total, check `type=CONVERSION`
before assuming fees. `convertPositions` turns *m* NO tokens into the
complementary YES tokens plus *(m−1)* collateral, and that collateral gain is
not fully represented in `/activity` — so a cashflow replay of a neg-risk
structural-arb wallet under-counts regardless of fees. One measured example: a
wallet with a recent fee ratio of 0.000% still showed a six-figure gap, driven
by five `CONVERSION` records.

## Quick check (free toolkit)

```bash
./bin/pm pnl-check 0xYourProxy
python3 skills/polymarket-pnl/compute_precise_pnl.py --address 0xYourProxy
```

`pm pnl-check` = LB snapshot + activity type hints + when to run Python audit.

## When numbers disagree

| Symptom | Likely cause |
|---------|----------------|
| **LB > precise, gap ≈ lifetime taker fees** | **The main one — LB is pre-fee, replay is post-fee** |
| LB > precise, gap ≫ fees | neg-risk `CONVERSION` income missing from `/activity` |
| LB > precise, gap ≈ fees − rebates | Same as the first, on a wallet that also earns maker rebates |
| LB > precise, none of the above | Incomplete activity pagination · timing |
| LB < precise | Unsettled positions · LB window empty |
| Profile win rate ≠ audit | Position-level vs settled-market logic |
| >4000 activity rows | Use `pm activity` warnings · `pagination_incomplete` in pnl skill |
| >5000 rows of one activity type | `/activity` caps `offset` at 5000; the skill falls back to timestamp paging |

## Audit threshold

`verify_precise_pnl.py` treats **≤$10** abs delta vs LB all-time as pass for complete rows.

⚠️ **A flat $10 threshold only holds for maker-heavy wallets**, and only became
wrong once fees existed. Comparing a replay against LB is comparing two
different bases, so on a taker wallet the "failure" is the threshold, not the
maths. Reconcile against `replay + lifetime taker fees − maker rebates` instead,
and keep $10 as the tolerance on *that*.
