# Platform change runbook (MIT · strategy validation)

1. **Detect** — official changelog / Discord / X (@PolymarketDevs)
2. **Blast radius** — which strategies / endpoints / contracts touched
3. **Compat layer** — feature flag or dual-read period
4. **Canary** — paper or ≤$50 wallet · one strategy
5. **Cutover window** — scheduled · communicate downtime
6. **Monitor 24h** — fills · positions · activity · redeem
7. **Rollback trigger** — predefined (e.g. fill rate −50%, auth errors spike)

See also: `docs/v2-ctf-ops-faq.md` for V2 split/merge/collateral alignment.
