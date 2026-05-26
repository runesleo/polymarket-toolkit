# Tiny-live gate · 12 steps (MIT · strategy validation)

> **All steps required.**

## Part A · Technical (1–7)

1. [ ] Paper ≥ 7 days · fill rate sane · questionnaire done
2. [ ] **New** wallet · ≤ $50 · keys never in AI/git
3. [ ] Epoch init in DB · old paper epoch closed
4. [ ] `DRY_RUN=false` explicit in `.env` · verified in process env
5. [ ] Risk caps written: max loss / trade · daily stop · kill switch tested
6. [ ] One strategy per wallet (no shared state)
7. [ ] Monitoring: freshness + PnL sanity + process heartbeat

## Part B · Ops (8–12)

8. [ ] Runbook for rollback (git tag + env snapshot)
9. [ ] Alert routing P0 vs P1 vs P2
10. [ ] First week: no param tuning · no size up
11. [ ] Platform change checklist ready (V2 / API moves)
12. [ ] Post-mortem slot booked at day 7

## Absolute limits

- Tiny-live **≤ $50** is a cap, not a suggestion
- No copy-trade / signal selling / geo bypass in scope
