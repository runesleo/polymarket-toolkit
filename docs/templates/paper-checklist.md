# Honest paper checklist (MIT · strategy validation)

> Before any live capital.

## Gate (all must pass)

- [ ] Backtest report passed (≥30 samples, abandon line documented)
- [ ] Entry/exit rules are functions, not comments
- [ ] `simulate_fill(order, book, latency)` exists — **no `Math.random()` fills**
- [ ] Epoch recorded (strategy_id, version, started_at)

## Paper run quality

- [ ] Each decision logs: `ts`, `signal`, `quote`, `book_snapshot_id`, `fill_status` + reason
- [ ] Latency modeled (≥200ms signal→order typical)
- [ ] Partial fill / cancel / reject reasons tracked
- [ ] Review **fill rate before PnL** after 7+ days

## Red flags → stop

| Signal | Meaning |
|--------|---------|
| fill rate > 90% | Likely fake paper |
| fill rate < 10% | Rules too tight or prices wrong |
| Only 1–3 days of paper | Sample bias |
