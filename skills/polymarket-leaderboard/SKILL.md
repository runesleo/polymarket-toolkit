---
name: polymarket-leaderboard
description: Scan Polymarket leaderboards — profile top traders by category in one command. Pairs with polymarket-profile for deep dives.
allowed-tools: Bash(curl:*) Read Write Edit
metadata: {"version":"0.2.0","openclaw":{"skillKey":"polymarket-leaderboard","homepage":"https://leolabs.me","requires":{"anyBins":["curl"]}}}
---

# Polymarket Leaderboard Scanner

Scan any Polymarket leaderboard and get a quick strategy overview of the top traders. One command, batch profile.

## Trigger

User asks to scan leaderboard, find top traders, compare top performers, or discover trading patterns across categories.

## Input

| Parameter | Default | Example |
|-----------|---------|---------|
| Window | `all` | `7d`, `30d`, `all` |
| Limit | `5` | Any number 1-20 |
| Category | all categories | `crypto`, `politics`, `sports` |

## Execution

### Step 1: Fetch Leaderboard

```bash
curl -s "https://lb-api.polymarket.com/profit?window={WINDOW}&limit={LIMIT}&offset=0"
```

Response: array of `{ name, pseudonym, proxyWallet, amount, bio, profileImage }`.

`amount` = total PnL for the selected window.

### Step 2: For Each Address — Quick Profile

For each trader in the leaderboard, fetch a lightweight profile (NOT full pagination — that's too slow for batch).

**2a. Position count + portfolio value:**
```bash
curl -s "https://data-api.polymarket.com/positions?user={ADDRESS}&sizeThreshold=0&limit=100"
```
Count positions, sum `currentValue`, compute win rate from `redeemable` positions.

**2b. Activity sample (first 500 only for speed):**
```bash
curl -s "https://data-api.polymarket.com/activity?user={ADDRESS}&limit=500"
```
Classify by `type` (TRADE/SPLIT/MERGE/REDEEM). Count unique `slug` values for market diversity.

**2c. Strategy pattern (simplified):**

| Pattern | Signal |
|---------|--------|
| SPLIT Arbitrage | split_count > trade_count × 0.1 |
| Market Maker | trade_count > 200 AND unique_markets < 10 |
| Diversified | unique_markets > 30 |
| Concentrated | unique_markets < 5 AND total_volume > $10k |
| Mixed | None of above |

### Step 3: Output Comparison Table

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Polymarket Leaderboard: Top {N} ({WINDOW})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| # | Name | PnL | Win Rate | Markets | Strategy |
|---|------|-----|----------|---------|----------|
| 1 | xxx  | +$xx | xx% (x/x) | xx | SPLIT Arb |
| 2 | xxx  | +$xx | xx% (x/x) | xx | Diversified |
...

🔍 Deep dive: "Profile {name}" for full analysis (uses polymarket-profile skill)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Generated: {timestamp} | Data: Polymarket Public APIs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Notes

- This is a **quick scan** — uses only 500 activity records per trader for speed. For complete analysis, use `polymarket-profile`.
- Rate limiting: add 500ms delay between API calls. Don't hammer the endpoints.
- PnL from `lb-api` is authoritative. Position-level data is supplementary.
- Some traders may have empty positions (all settled). Win rate shows "N/A" in that case.
