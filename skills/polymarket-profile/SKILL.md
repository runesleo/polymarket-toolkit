---
name: polymarket-profile
description: Polymarket address profiler — input any 0x address, get a complete trading profile with PnL, win rate, positions, category breakdown, and top trades. All data from public APIs, no local database needed.
allowed-tools: Bash(curl:*) Bash(node:*) Read Write Edit
metadata: {"version":"0.2.0","openclaw":{"skillKey":"polymarket-profile","homepage":"https://leolabs.me","requires":{"anyBins":["curl","node"]}}}
---

# Polymarket Address Profile

Generate a complete trading profile for any Polymarket address. All data comes from public APIs in real-time — no local database or API key required.

## Trigger

User provides a Polymarket identity and wants analysis, profile, or trading overview.

## Input Resolution

The skill requires a **0x proxy wallet address**. Users may provide:

| Input Type | Example | How to handle |
|-----------|---------|---------------|
| **0x address** | `0x63ce3421...` | Use directly |
| **Profile URL** | `polymarket.com/profile/Theo4` | Extract username from URL, then resolve via leaderboard lookup (see below) |
| **Username** | `Theo4` | Resolve via leaderboard lookup (see below) |

### When user provides a username or URL (not 0x address)

**Step 1: Try leaderboard lookup** — Page through the all-time PnL leaderboard (`/v2/leaderboard`) to resolve username → address.

```bash
# Paginate through the leaderboard searching for the username.
# First page, then repeat with &cursor=<pagination.next_cursor> until found or next_cursor is null.
curl -s "https://data-api.polymarket.com/v2/leaderboard?time_period=all&sort_by=PNL&limit=500"
```

Response is `{ "data": [...], "pagination": { "next_cursor": ... } }`; each row has `user_name` and `user_id` (the proxy wallet). Search for a case-insensitive match on `user_name`.

- **Found** → use the `user_id` as the 0x address, continue to Step 1 of execution
- **Not found after 3 pages (1500 users)** → the account is likely unranked, fall back to Step 2

**Step 2: Manual fallback** (only if leaderboard lookup fails)

> "This username isn't in the Polymarket leaderboard (only ranked users can be auto-resolved). You can find the 0x address by:
> 1. Open the profile page on Polymarket
> 2. Click the address/wallet icon near the username — it copies the 0x address
> 3. Or check the browser URL — some profile pages show the address"

NOTE: Leaderboard lookup covers all users with a PnL ranking (tens of thousands). Only very new or inactive accounts with zero trading history won't be found.

## API Endpoints

All endpoints are public, no authentication needed.

| Endpoint | Base URL | Purpose |
|----------|----------|---------|
| Data API v2 | `https://data-api.polymarket.com/v2` | PnL, volume, rankings (`/leaderboard`), positions, activity, trades |
| CLOB API | `https://clob.polymarket.com` | Orderbook, market prices |
| Gamma API | `https://gamma-api.polymarket.com` | Market metadata, events, categories |

Data API v1 (bare `/positions`, `/activity`, `/v1/leaderboard`) and `lb-api.polymarket.com` answer HTTP 410 since November 2026. Every v2 list response is wrapped as `{ "data": [...], "pagination": { "next_cursor": ... } }`; page by passing `cursor=<next_cursor>` together with the original parameters, never `offset` (a 400 on v2). v2 fields are snake_case. The rest of this skill names fields by their v1 spelling — read them from v2 as:

| Name used below | v2 field |
|---|---|
| `amount` (PnL), `name` | `pnl`, `user_name` (leaderboard) |
| `size`, `avgPrice`, `curPrice` | `current_size`, `avg_price`, `current_price` |
| `initialValue`, `currentValue`, `cashPnl`, `percentPnl` | `entry_cost_usdc`, `current_value`, `unrealized_pnl`, `percent_pnl` |
| `totalBought`, `realizedPnl`, `endDate`, `eventSlug` | `total_size`, `realized_pnl`, `end_date`, `event_slug` |
| `usdcSize`, `conditionId`, `asset` | `usdc_size`, `condition_id`, `token_id` (activity / trades) |

## Execution Steps

Run steps 1-4 in parallel where possible to minimize latency.

### Step 1: PnL Snapshot

```bash
curl -s "https://data-api.polymarket.com/v2/leaderboard?user={ADDRESS}&time_period=all"
```

Response is `{ "data": { ... } }` (`data: null` for an unknown wallet). Extract `data.pnl` for total PnL, `data.user_name` for username.

NOTE: the leaderboard only returns `pnl` and `volume` (plus ranks). It does NOT return invested/numTrades/numWins. Those must be computed from positions (Step 2) and activity (Step 3). A `pnl` of exactly 0 next to a non-zero `volume` is a not-yet-computed value, not a break-even wallet — show it as N/A.

Also fetch time-windowed PnL for trend:
```bash
curl -s "https://data-api.polymarket.com/v2/leaderboard?user={ADDRESS}&time_period=week"
curl -s "https://data-api.polymarket.com/v2/leaderboard?user={ADDRESS}&time_period=month"
```

### Step 2: Current Positions

```bash
curl -s "https://data-api.polymarket.com/v2/positions?user={ADDRESS}&limit=100"
```

Paginate with the cursor: while `pagination.next_cursor` is not null, fetch the same URL plus `&cursor={next_cursor}`. The default status (`OPEN`) includes settled-but-unredeemed rows, which the win-rate buckets below rely on.

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

#### Fallback: When Positions Are Empty or Incomplete

For inactive accounts, the positions API may return very few records (settled positions get cleaned up). If `Won + Lost < 3`, fall back to activity-based estimation:

1. From activity, group all REDEEM records by `slug` (market)
2. From activity, group all TRADE records by `slug`
3. Markets with REDEEM volume > 0 → **Won**
4. Markets with TRADE volume > 0 but no REDEEM → **Lost** (invested but no payout)
5. Label Win Rate as "estimated from activity" when using this fallback

### Step 3: Activity History

```bash
curl -s "https://data-api.polymarket.com/v2/activity?user={ADDRESS}&limit=500&start=1"
```

`start=1` asks for the whole history; without it v2 only reaches three years back.

IMPORTANT: You MUST paginate to get complete data. Large accounts have 10,000+ records. 500 records is NOT enough for an accurate profile.

### Activity Pagination (REQUIRED)

```
Loop:
  1. First request: /v2/activity?user={ADDRESS}&limit=500&start=1
  2. Read `pagination.next_cursor` from the response
  3. Next request: the same URL plus &cursor={next_cursor} (keep user/limit/start — a cursor alone is a 400)
  4. Repeat until next_cursor is null (= last page)
  5. Merge all results
```

Inform user of progress for large accounts: "Fetching activity... page X (Y records so far)"

Each activity object contains: `type`, `size`, `usdcSize`, `price`, `side`, `title`, `slug`, `timestamp`, `outcome`.

Classify by `type` field:

| Type | What it means |
|------|--------------|
| TRADE | Bought or sold shares (check `side` field: "BUY" or "SELL") |
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

**NOTE**: Gamma API may return empty `[]` for old/settled markets. This is expected — fall back to keyword inference from market titles in activity data.

**Optimization**: Collect all unique `eventSlug` values from positions first, then batch fetch from Gamma (avoid one API call per position). Group by slug to avoid duplicates.

Compute the percentage distribution by volume invested.

### Step 5: Strategy Pattern Detection

Analyze data from Steps 1-4 to classify the address into a trading pattern. Use multiple dimensions — no single metric is sufficient.

#### Dimensions to compute

From **activity** data:
- `trade_count`: total TRADE records
- `split_count` / `split_volume`: SPLIT records and USDC volume
- `merge_count` / `merge_volume`: MERGE records and USDC volume
- `redeem_volume`: total REDEEM volume
- `unique_markets`: number of distinct `slug` values
- `avg_trade_size`: total trade volume / trade count
- `trade_frequency`: trade count / active days (first to last timestamp)

From **positions** data:
- `open_count`: open positions (not redeemable)
- `settled_count`: won + lost
- `concentration`: top 3 positions as % of total invested

#### Pattern Classification

Evaluate in this order (first match wins):

| Pattern | Conditions | Description |
|---------|-----------|-------------|
| **SPLIT Arbitrage** | `split_volume > trade_volume × 0.2` AND `merge_volume > 0` | Enters via SPLIT (creates YES+NO pairs), sells one side or MERGEs back. Capital-efficient, market-neutral entry. |
| **Market Maker** | `trade_count > 500` AND `unique_markets < 15` AND `avg_trade_size < $20` | High-frequency small trades concentrated in few markets. Provides liquidity, earns spread. |
| **Whale / Concentrated** | `concentration > 60%` AND `unique_markets < 10` | Heavy capital in a few markets. High-conviction directional bets. |
| **Diversified** | `unique_markets > 50` | Spread across many markets. Portfolio approach, lower per-market risk. |
| **Small Trader** | `trade_count < 50` AND `total_invested < $500` | Limited activity. New or casual user. |
| **Mixed** | None of the above | Combination of strategies, no dominant pattern. |

#### Output format

```
🎯 Strategy Pattern: {pattern_name}
   {1-2 sentence explanation based on actual numbers}
   Key metrics: {trade_count} trades across {unique_markets} markets, avg ${avg_trade_size}/trade
```

Do NOT reveal specific thresholds used for classification. Just state the pattern name and explain it in plain language using the trader's actual data.

### Step 6: Top Trades

From **positions** data (not activity), use `cashPnl` field for settled positions:
- **Top 5 Wins**: Settled positions with highest positive `cashPnl`
- **Top 5 Losses**: Settled positions with most negative `cashPnl`

For each: market title, outcome (Yes/No), entry price (`avgPrice`), PnL amount.

NOTE: `cashPnl` from positions is approximate (affected by partial sells). This is acceptable for v0.1. Do NOT attempt to match individual BUY→SELL/REDEEM from activity — that requires complex logic and is not worth the accuracy gain for a profile overview.

#### Fallback: When Positions Data Is Sparse

If positions API returns very few settled records, estimate Top Trades from activity:
1. Group TRADE records by `slug`, sum `usdcSize` per market (= total invested)
2. Group REDEEM records by `slug`, sum `usdcSize` per market (= total payout)
3. PnL per market ≈ REDEEM volume - TRADE BUY volume
4. Sort by PnL for top wins/losses. Label as "estimated from activity".

### Step 7: Assemble Profile

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
  | Type       | Count | Volume |
  |------------|-------|--------|
  | TRADE BUY  | xxx   | $xxx   |
  | TRADE SELL | xxx   | $xxx   |
  | SPLIT      | xxx   | $xxx   |
  | MERGE      | xxx   | $xxx   |
  | REDEEM     | xxx   | $xxx   |

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

- **PnL from the v2 leaderboard is the ground truth**. Use it as the primary source. Position-level `cashPnl` may differ due to SPLIT/MERGE accounting.
- **Activity pagination**: follow `next_cursor`, never `offset` (a 400 on v2). Do NOT deduplicate — same txHash with multiple records means multiple fills in one transaction.
- **Always paginate ALL activity records**. Partial data produces inaccurate profiles. Show pagination progress to the user (e.g. "Fetching activity... page 5, 2500 records so far").
- **Category mapping**: use `eventSlug` from positions to query Gamma API. Category comes from the event's `tags` or `category` field. If Gamma is slow, infer from market title keywords (BTC/ETH/crypto → Crypto, Trump/election → Politics, NBA/FIFA → Sports, temperature/weather → Weather).
- **All monetary values in USD**, round to 2 decimal places.
- **Address format**: APIs accept both checksummed and lowercase. Normalize to lowercase.
- **Region**: data-api and gamma-api are public; if a request answers HTTP 451 (geo-blocked), retry from another region rather than reading it as "no data".
- **Rate limits**: No documented limits, but keep requests reasonable (<10 concurrent). Add **500ms delay** between sequential pagination calls. If a request returns empty or non-JSON, retry once after 2 seconds.
- **week / month PnL**: may come back as `data: null` or `pnl: 0` for inactive accounts. Display as "N/A" instead of $0.
