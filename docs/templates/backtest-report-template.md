# Backtest report template (MIT · strategy validation)

> Fill one per backtest run.

## Hypothesis (must be falsifiable)

> When **{condition X}**, do **{action Y}**, expect **{metric Z} > 0**; else abandon.

## Sample

| Field | Value |
|-------|-------|
| Window | YYYY-MM-DD → YYYY-MM-DD |
| Markets | category / slug pattern |
| Opportunities (M) | |
| Min sample | M < 30 → no conclusion |

## Metrics (order matters)

1. Sample count M
2. Win rate / hit rate
3. Max drawdown
4. Net PnL (after fees if modeled)
5. Abandon recommendation

## Entry / exit rules

Write as code-friendly bullets, not prose.

## Abandon line

If **{condition}** → stop, do not tune parameters to pass.
