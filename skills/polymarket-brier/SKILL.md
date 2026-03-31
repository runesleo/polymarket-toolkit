---
name: polymarket-brier
description: Brier Score calculator for Polymarket addresses — measures prediction accuracy independent of PnL. Separates skilled predictors from market makers and arbitrageurs.
allowed-tools: Bash(curl:*) Read Write Edit
metadata: {"version":"0.2.0","openclaw":{"skillKey":"polymarket-brier","homepage":"https://leolabs.me","requires":{"anyBins":["curl"]}}}
---

# Polymarket Brier Score

Calculate prediction accuracy for any Polymarket address. Brier Score measures how close a trader's positions were to the actual outcomes — independent of PnL, position size, or trading strategy.

## Why Brier Score?

PnL tells you who made money. Brier Score tells you who **predicted correctly**.

- High PnL + Poor Brier → Market maker or arbitrageur (earns spread, not predictions)
- Low PnL + Good Brier → Accurate predictor with small positions or conservative sizing
- High PnL + Good Brier → Skilled predictor who also sizes well — the real signal

## Trigger

User asks about prediction accuracy, Brier score, prediction quality, forecasting skill, or "how accurate is this trader".

## Background

The Brier Score is a standard metric in forecasting (used by Metaculus, Good Judgment Project, etc.).

Formula: `BS = (1/N) × Σ(forecast_probability - actual_outcome)²`

- **0.0** = perfect prediction (always right with 100% confidence)
- **0.25** = no skill (equivalent to random 50/50 guessing)
- **0.5+** = worse than random

Lower is better.

## Input

Same as polymarket-profile — accepts 0x address, username, or profile URL.

## Execution

### Step 1: Fetch Settled Positions

```bash
curl -s "https://data-api.polymarket.com/positions?user={ADDRESS}&sizeThreshold=0&limit=100&offset=0"
```

Paginate until all positions are fetched (same as polymarket-profile).

Filter to **settled positions only**: `redeemable == true`.

For each settled position, extract:
- `outcome`: "Yes" or "No" — the side the trader held
- `avgPrice`: the trader's average entry price = their implied probability forecast
- `currentValue > 0`: whether the market resolved in their favor (won) or not (lost)

### Step 2: Determine Actual Outcome

For each settled position:
- If `currentValue > 0` (won): the outcome the trader bet on **did happen** → `actual = 1`
- If `currentValue == 0` (lost): the outcome the trader bet on **did not happen** → `actual = 0`

### Step 3: Calculate Brier Score

For each settled position:
```
forecast = avgPrice  (what they paid = their implied probability)
squared_error = (forecast - actual)²
```

Then:
```
brier_score = sum(squared_error) / count(settled_positions)
```

### Step 4: Calculate Calibration Breakdown (Optional, if ≥20 settled positions)

Group positions into probability buckets by `avgPrice`:

| Bucket | Range | Meaning |
|--------|-------|---------|
| High confidence | 0.80-0.99 | "Very likely to happen" |
| Moderate | 0.60-0.79 | "Probably happens" |
| Coin flip | 0.40-0.59 | "Could go either way" |
| Contrarian | 0.01-0.39 | "Betting against the crowd" |

For each bucket:
- Count positions
- Average forecast probability
- Actual win rate (% that resolved in their favor)
- A well-calibrated trader's win rate should be close to their average forecast

### Step 5: Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Brier Score: {ADDRESS_SHORT}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Prediction Accuracy
  Brier Score:      {score} ({rating})
  Settled Markets:  {count}
  Correct:          {wins}/{total} ({win_rate}%)

📐 Calibration
  | Confidence | Positions | Avg Forecast | Actual Win% | Gap |
  |------------|-----------|-------------|-------------|-----|
  | High       | 12        | 87%         | 83%         | -4% |
  | Moderate   | 8         | 68%         | 62%         | -6% |
  | Coin flip  | 5         | 52%         | 60%         | +8% |
  | Contrarian | 3         | 28%         | 33%         | +5% |

💡 Interpretation
  {1-2 sentence plain language summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Generated: {timestamp} | Data: Polymarket Public APIs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Rating Scale

| Brier Score | Rating | Meaning |
|-------------|--------|---------|
| 0.00-0.10 | Excellent | Top-tier forecaster |
| 0.10-0.15 | Good | Consistently better than chance |
| 0.15-0.20 | Average | Some skill, room to improve |
| 0.20-0.25 | Poor | Barely better than guessing |
| 0.25+ | No skill | Worse than a coin flip |

## Notes

- Brier Score requires **settled** positions. Accounts with mostly open positions will have a small sample size — flag this: "Based on N settled markets. Score reliability increases with more data."
- If fewer than 5 settled positions, output: "Not enough settled data for a meaningful Brier Score."
- `avgPrice` is used as the probability forecast. This is a simplification — traders who DCA (buy at multiple prices) will have a blended avgPrice. Acceptable for v0.2.
- SPLIT positions should be **excluded** from Brier calculation. SPLIT is a market-neutral operation (buy both sides), not a directional prediction. Identify via polymarket-profile's activity data if available, otherwise include all positions with a note.
- This score is **independent of position size**. A $10 bet and a $10,000 bet on the same market at the same price contribute equally. This is intentional — we're measuring prediction skill, not bankroll management.
