---
name: polymarket-profile
description: Polymarket address profiler — input any 0x address, get a complete trading profile with PnL, win rate, positions, category breakdown, and top trades. All data from public APIs, no local database needed.
allowed-tools: Bash(curl:*) Bash(node:*) Read Write Edit
metadata: {"version":"1.0.0","openclaw":{"skillKey":"polymarket-profile","homepage":"https://leolabs.me","requires":{"anyBins":["curl","node"]}}}
---

# Polymarket Address Profile

Generate a complete trading profile for any Polymarket address. All data comes from public APIs in real-time — no local database or API key required.

## Trigger

User provides a Polymarket address (0x...) and wants analysis, profile, or trading overview.

## API Endpoints

All endpoints are public, no authentication needed.

| Endpoint | Base URL | Purpose |
|----------|----------|---------|
| LB API | `https://lb-api.polymarket.com` | PnL, volume, rankings |
| Data API | `https://data-api.polymarket.com` | Positions, activity, trades |
| CLOB API | `https://clob.polymarket.com` | Orderbook, market prices |
| Gamma API | `https://gamma-api.polymarket.com` | Market metadata, events, categories |

## Execution Steps

Run steps 1-4 in parallel where possible to minimize latency.

### Step 1: PnL Snapshot

```bash
curl -s "https://lb-api.polymarket.com/profit?window=all&address={ADDRESS}"
```

Response is an array. Extract `[0].amount` for total PnL, `[0].name` for username.

NOTE: lb-api only returns `amount` (total PnL). It does NOT return invested/numTrades/numWins. Those must be computed from positions (Step 2) and activity (Step 3).

Also fetch time-windowed PnL for trend:
```bash
curl -s "https://lb-api.polymarket.com/profit?window=7d&address={ADDRESS}"
curl -s "https://lb-api.polymarket.com/profit?window=30d&address={ADDRESS}"
```

### Step 2: Current Positions

```bash
curl -s "https://data-api.polymarket.com/positions?user={ADDRESS}&sizeThreshold=0&limit=100"
```

Each position object contains:

| Field | Description |
|-------|------------|
| `title` | Market question |
| `outcome` | "Yes" or "No" |
| `size` | Number of shares held |
| `avgPrice` | Average entry price |
| `curPrice` | Current market price |
| `initialValue` | Total cost (size × avgPrice) |
| `currentValue` | Current value (size × curPrice) |
| `cashPnl` | Realized + unrealized PnL |
| `percentPnl` | PnL as percentage |
| `totalBought` | Total shares ever bought |
| `realizedPnl` | PnL from closed portions |
| `redeemable` | Can claim settlement winnings |
| `endDate` | Market expiry date |
| `eventSlug` | Event identifier for Gamma API |

Extract:
- Number of active positions (where `currentValue > 0` or `redeemable`)
- Largest position by `initialValue`
- Total portfolio value: sum of `currentValue`
- Win/loss count: compute from settled positions (`curPrice == 0` or `curPrice == 1`)
- Win rate: positions where outcome was correct / total settled

### Step 3: Activity History

```bash
curl -s "https://data-api.polymarket.com/activity?user={ADDRESS}&limit=500"
```

IMPORTANT: Pagination uses `end` timestamp parameter, NOT offset. To get more data:
```bash
curl -s "https://data-api.polymarket.com/activity?user={ADDRESS}&limit=500&end={last_timestamp}"
```

Each activity object contains: `type`, `size`, `usdcSize`, `price`, `side`, `title`, `slug`, `timestamp`, `outcome`.

Classify by `type` field:

| Type | What it means |
|------|--------------|
| BUY | Bought shares on the market |
| SELL | Sold shares on the market |
| SPLIT | Created YES+NO pairs from USDC (market-neutral entry) |
| MERGE | Combined YES+NO back to USDC (exit / arbitrage capture) |
| REDEEM | Claimed winnings after market settlement |
| CONVERSION | Converted between YES/NO (special market operation) |
| REBATE | Fee rebate from maker orders |

Count and sum `usdcSize` for each type. Also track unique markets (`slug`) for diversity analysis.

### Step 4: Market Categories

For each active position from Step 2, fetch market metadata:

```bash
curl -s "https://gamma-api.polymarket.com/events?slug={market_slug}"
```

Or batch via condition IDs from positions:
```bash
curl -s "https://gamma-api.polymarket.com/markets?condition_id={CONDITION_ID}"
```

Categorize into: Politics | Crypto | Sports | Weather | Finance | Geopolitics | Entertainment | Science | Other

Compute the percentage distribution.

### Step 5: Top Trades

From the activity data (Step 3), identify:
- **Top 3 Wins**: Largest positive PnL trades (BUY→REDEEM or BUY→SELL with profit)
- **Top 3 Losses**: Largest negative PnL trades

For each, include: market name, direction, entry price, exit/settlement price, PnL amount.

NOTE: Calculating per-trade PnL requires matching BUY entries with corresponding SELL/REDEEM. Group by market, compute avg entry price vs exit price × size.

### Step 6: Assemble Profile

Output the complete profile in this format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Polymarket Profile: {ADDRESS_SHORT}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Overview
  Address:    {ADDRESS}
  Total PnL:  ${totalProfit} (invested ${invested})
  Win Rate:   {wins}/{total} ({winRate})
  7d PnL:     ${pnl_7d}
  30d PnL:    ${pnl_30d}

📈 Current Positions ({count})
  Largest:    {market_name} — {direction} ${size} @ ${avg_price}
  Portfolio:  ${total_value}

  | # | Market | Direction | Size | Avg Price | Current | PnL |
  |---|--------|-----------|------|-----------|---------|-----|
  | 1 | ...    | YES/NO    | $xx  | $0.xx     | $0.xx   | +$x |
  ...

📂 Category Distribution
  | Category | Positions | Volume | % |
  |----------|-----------|--------|---|
  | Crypto   | 12        | $5,000 | 45% |
  | Politics | 5         | $2,000 | 22% |
  ...

📋 Activity Summary
  | Type   | Count | Volume |
  |--------|-------|--------|
  | BUY    | xxx   | $xxx   |
  | SELL   | xxx   | $xxx   |
  | SPLIT  | xxx   | $xxx   |
  | MERGE  | xxx   | $xxx   |
  | REDEEM | xxx   | $xxx   |

🏆 Top Wins
  1. {market} — {direction} +${pnl} (entry ${price} → ${exit})
  2. ...
  3. ...

💀 Top Losses
  1. {market} — {direction} -${pnl} (entry ${price} → ${exit})
  2. ...
  3. ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Generated: {timestamp} | Data: Polymarket Public APIs
  Powered by Leo Labs — leolabs.me
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Important Notes

- **PnL from lb-api is the ground truth**. Use it as the primary source. Position-level `cashPnl` may differ due to SPLIT/MERGE accounting.
- **Activity pagination**: use `end` timestamp, never `offset`. Do NOT deduplicate — same txHash with multiple records means multiple fills in one transaction.
- **Start with 500 activity records**. Only fetch more if the user asks for full history.
- **Category mapping**: use `eventSlug` from positions to query Gamma API. Category comes from the event's `tags` or `category` field. If Gamma is slow, infer from market title keywords (BTC/ETH/crypto → Crypto, Trump/election → Politics, NBA/FIFA → Sports, temperature/weather → Weather).
- **All monetary values in USD**, round to 2 decimal places.
- **Address format**: APIs accept both checksummed and lowercase. Normalize to lowercase.
- **lb-api may require proxy** in some regions. data-api and gamma-api work globally.
- **Rate limits**: No documented limits, but keep requests reasonable (<10 concurrent). Add 200ms delay between sequential calls if fetching many pages.
