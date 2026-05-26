# Crypto updown · Gamma fields · price / resolution source

**Problem:** 5m/15m crypto updown markets need a **reference price** (often called *price to beat* in community). Wrong source or lag → wrong side.

**This example is read-only** — it loads a Gamma **event by slug** and prints fields useful for debugging resolution inputs. It does **not** execute trades.

## Run

```bash
# Pass an event slug (find active slugs on polymarket.com or from your scanner)
npx tsx examples/18-crypto-updown-gamma.ts btc-updown-15m-1779796800
./bin/pm updown btc-updown-15m-1779796800
```

## What to look at

| Field | Why |
|-------|-----|
| `resolutionSource` | Oracle / URL / rules text — **read before trading** |
| `markets[].outcomePrices` | Implied probabilities |
| `markets[].bestBid` / `bestAsk` / `spread` | Liquidity sanity |
| `markets[].groupItemTitle` | Strike bucket label on multi-strike events |
| Event `endDate` | Window boundary vs your clock |

**There is no stable public field literally named `priceToBeat` in all Gamma payloads.** Community tools derive target price from:

- market question / `groupItemTitle` text,
- resolution rules + external oracle (Chainlink / exchange index — verify in `resolutionSource`),
- or CLOB mid at window open (your own recording — not official).

Always cross-check **official resolution criteria** on the market page.

## Common pitfalls

1. **Source lag** — index updated slower than your signal feed.
2. **Wrong window** — 5m vs 15m slug / end timestamp off by one bucket.
3. **Using CLOB mid as “official target”** — mid ≠ resolution oracle.
4. **Stale Gamma cache** — re-fetch event near window open.

## Next

- Audit-grade window logging → your own pipeline.
