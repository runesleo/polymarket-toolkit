---
name: polymarket-profile
description: Polymarket address profiler — input any 0x address, get a complete trading profile with PnL, win rate, positions, category breakdown, and top trades. All data from public APIs, no local database needed.
allowed-tools: Bash(curl:*) Bash(node:*) Read Write Edit
metadata: {"version":"0.1.0","openclaw":{"skillKey":"polymarket-profile","homepage":"https://leolabs.me","requires":{"anyBins":["curl","node"]}}}
---

# Polymarket Address Profile

Generate a complete trading profile for any Polymarket address. All data comes from public APIs in real-time — no local database or API key required.

## Trigger

User provides a Polymarket identity and wants analysis, profile, or trading overview.

## Input Resolution

The skill requires a **0x proxy wallet address**. Users may provide:

| Input Type | Example | How to handle |
|-----------|---------|---------------|
| **0x address** | `0x13e1f69d...` | Use directly |
| **Profile URL** | `polymarket.com/profile/runes-leo` | Ask user for the 0x address (see below) |
| **Username** | `runes-leo` | Ask user for the 0x address (see below) |

### When user provides a username or URL (not 0x address)

There is no public API to resolve usernames to addresses. Guide the user:

> "I need the wallet address to run the profile. You can find it by:
> 1. Open the profile page on Polymarket
> 2. Click the address/wallet icon near the username — it copies the 0x address
> 3. Or check the browser URL — some profile pages show the address"

NOTE: lb-api `profit` endpoint returns a leaderboard with `name` and `proxyWallet` fields, but only the top ~50 accounts. If the target user is in the top 50, you can match by name. For all others, the 0x address is required.

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
curl -s "https://data-api.polymarket.com/positions?user={ADDRESS}&sizeThreshold=0&limit=100&offset=0"
```

Paginate with `offset` parameter: if response returns exactly 100 records, fetch next page with `offset=100`, `offset=200`, etc. until fewer than 100 returned.

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
- Number of open positions: `redeemable == false` AND `currentValue > 0`
- Largest position by `currentValue`
- Total portfolio value: sum of `currentValue` for open positions

### Win Rate Calculation

Classify positions into three buckets:

| Bucket | Condition | Meaning |
|--------|-----------|---------|
| **Won** | `redeemable == true` AND `currentValue > 0` | Market settled in user's favor, awaiting redemption |
| **Lost** | `redeemable == true` AND `currentValue == 0` | Market settled against user |
| **Open** | `redeemable == false` AND `currentValue > 0` | Market not yet settled |

Win Rate = Won / (Won + Lost)

IMPORTANT: Do NOT use `cashPnl > 0` to determine wins. Winning positions have `currentValue > 0` (shares worth $1) even if `cashPnl` appears negative due to partial sells. The `redeemable` flag is the definitive settlement indicator.

### Step 3: Activity History

```bash
curl -s "https://data-api.polymarket.com/activity?user={ADDRESS}&limit=500"
```

IMPORTANT: You MUST paginate to get complete data. Large accounts have 10,000+ records. 500 records is NOT enough for an accurate profile.

### Activity Pagination (REQUIRED)

```
Loop:
  1. First request: /activity?user={ADDRESS}&limit=500
  2. Get `timestamp` of the LAST record in the response
  3. Next request: /activity?user={ADDRESS}&limit=500&end={last_timestamp}
  4. Repeat until response returns fewer than 500 records (= last page)
  5. Merge all results
```

Inform user of progress for large accounts: "Fetching activity... page X (Y records so far)"

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

For each position, fetch market metadata via Gamma API using the `eventSlug` from positions:

```bash
curl -s "https://gamma-api.polymarket.com/events?slug={eventSlug}"
```

Or batch multiple slugs. Each event has a `category` field and a `tags` array (each tag has a `label` field).

#### Category Mapping

Gamma API categories are legacy naming. Map to Polymarket's frontend categories:

| Gamma category / tag label | Display Category |
|---------------------------|-----------------|
| `Sports`, `NBA Playoffs`, `Chess`, `Esports`, any sports team name | **Sports** |
| `Crypto`, `NFTs`, `Bitcoin`, `Ethereum` | **Crypto** |
| `US-current-affairs`, `Elections`, any president/congress/party keyword | **Politics** |
| `Ukraine & Russia`, `Iran`, any war/military/invasion keyword | **Geopolitics** |
| `Business`, any GDP/oil/fed/rate keyword | **Finance** |
| `Pop-Culture`, `Art`, `Coronavirus` | **Culture** |
| temperature/weather/celsius keyword in title | **Weather** |
| AI/tech/SpaceX keyword in title | **Tech** |
| Musk/tweet keyword in title | **Musk/Tweets** |
| No match | **Other** |

**Priority**: Use Gamma `category` field first. If it's missing or too generic (`All`), fall back to tag labels. If still unclear, infer from market title keywords.

**Optimization**: Collect all unique `eventSlug` values from positions first, then batch fetch from Gamma (avoid one API call per position). Group by slug to avoid duplicates.

Compute the percentage distribution by volume invested.

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
