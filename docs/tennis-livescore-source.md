# Tennis event · Gamma fields · independent live-score cross-check

**Problem:** a tennis event market can lag what already happened on court — a set won, a break point converted, a mid-match retirement. Reading the Gamma fields alone can be **stale**; an independent live-score source exposes the gap before you trade on a stale price.

**This example is read-only** — it loads a Gamma **event by slug**, prints the fields useful for debugging resolution inputs, then overlays an **independent** live score. It does **not** execute trades, and the live feed is not an oracle or resolution source.

**Vendor note:** the live score comes from the Live Tennis API (https://livetennisapi.com), which I run — so this is a vendor-authored example; judge accordingly. The overlay is optional and off unless you set a key.

## Run

```bash
# Pass a tennis event slug (find active slugs on polymarket.com or from your scanner)
npx tsx examples/22-tennis-event-livescore.ts <event-slug>

# Optional independent overlay — free key: https://livetennisapi.com/subscribe/free
export LIVETENNIS_API_KEY="your-free-key"
npx tsx examples/22-tennis-event-livescore.ts <event-slug>
```

## What to look at

| Field | Why |
|-------|-----|
| `markets[].resolutionSource` | Oracle / URL / rules text — **read before trading** |
| `markets[].outcomePrices` | Implied probabilities |
| `markets[].bestBid` / `bestAsk` | Liquidity sanity |
| Event `endDate` | Window boundary vs the actual match clock |
| Live `sets` / `points` / `server` | Independent state — is the price consistent with the court? |
| Live break point | A break point about to convert can move a set before the price does |
| Live `event_status` | `Retired` / `Walk Over` / `Interrupted` — a match can end without a clean final |

The live side is derived from the Live Tennis API **free** tier (`GET /matches?status=live`): live match list + score, at 30 req/min and 100 req/day — enough for a develop-and-test or ~15-minute-cadence check, **not** continuous fast polling. History, market prices and win-probability are paid tiers.

**Break point** is derived the way the feed defines it: the *receiver* is at AD, or the receiver is at 40 while the server is at 0/15/30 — never in a tiebreak, and never when server or points are null.

Always cross-check **official resolution criteria** on the market page.

## Common pitfalls

1. **Score lag** — the market price hasn't caught up to a break/set already decided on court.
2. **Name matching** — the example matches a live match to the event by both player surnames; ambiguous names (same surname) can mis-match, so confirm the players.
3. **Retirement / walkover** — `event_status` can settle a match without a "normal" final; a naive price read misses it.
4. **Free-tier cadence** — 100 req/day is not a fast poller; don't build a tight loop on the free key.

## Next

- Wire the live overlay into your own scanner's window logging (your pipeline, not this repo).
