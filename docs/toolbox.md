# Toolbox · Drawer Index

**Audience:** anyone researching Polymarket — run CLI yourself, or use AI skills (Claude / Cursor / OpenClaw). No API keys. No signing.

## Quick start (CLI)

```bash
# From repo root (Node 22+)
./bin/pm help
./bin/pm profile 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
./bin/pm redeem 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
./bin/pm brier Theo4 --json
./bin/pm markets --limit 5 --active
```

Use `./bin/pm` from the repo root for all examples here. Or: `npm link` then `pm profile …` globally.

---

## Drawer A · Research an address

| Tool | How to run |
|------|------------|
| **pm profile** | `./bin/pm profile <addr\|username>` |
| **pm activity** | `./bin/pm activity <addr> [--type TRADE]` · cap warnings |
| **polymarket-pnl** (audit PnL) | `python3 skills/polymarket-pnl/compute_precise_pnl.py --address …` |
| **polymarket-profile** skill | `skills/polymarket-profile/SKILL.md` |
| **polymarket-brier** skill | `skills/polymarket-brier/SKILL.md` |
| LB profit | `npx tsx examples/05-lb-profit-by-address.ts` |
| Activity cap probe | `npx tsx examples/16-activity-cap-probe.ts` |

## Drawer B · Markets & prices

| Tool | How to run |
|------|------------|
| **pm scan** | `./bin/pm scan --limit 20 --min-volume 1000` |
| **pm updown** | `./bin/pm updown <event-slug>` · [crypto-updown doc](./crypto-updown-price-source.md) |
| **pm markets** | `./bin/pm markets --limit 10 --active` |
| Gamma markets / events | `examples/01`, `09`, `10`, `18` |
| CLOB book / midpoint / WS | `examples/02`, `11`, `12` |

## Drawer C · Data plumbing

| Tool | How to run |
|------|------------|
| Cookbook recipes | [`cookbook.md`](./cookbook.md) |
| **pm limits** | `./bin/pm limits` · [rate-limits JSON](./data/polymarket-api-rate-limits.json) |
| TS helpers | [`src/index.ts`](../src/index.ts) |

## Drawer D · Validation templates

| Template | Path |
|----------|------|
| AI handoff | [handoff-template.md](./templates/handoff-template.md) |
| Backtest report | [backtest-report-template.md](./templates/backtest-report-template.md) |
| Paper checklist | [paper-checklist.md](./templates/paper-checklist.md) |
| Live gate 12 steps | [live-gate-checklist.md](./templates/live-gate-checklist.md) |
| Platform runbook | [platform-change-runbook.md](./templates/platform-change-runbook.md) |
| Fee-inclusive PnL | [fee-inclusive-pnl.md](./fee-inclusive-pnl.md) |

## Drawer E · Track & monitor

| Tool | How to run |
|------|------------|
| **pm lb** | `./bin/pm lb --category crypto --period day --top 10 --save` |
| **pm lb --diff** | `./bin/pm lb --diff --category overall` |
| **pm pnl-check** | `./bin/pm pnl-check 0x…` — LB snapshot + hints; not audit-grade PnL |
| **pm redeem** | `./bin/pm redeem <addr>` |
| Leaderboard pages | `examples/06`, `07`, `08`, `20` |

## Drawer G · V2 / CTF ops (read-only)

| Tool | How to run |
|------|------------|
| V2 split/merge FAQ | [v2-ctf-ops-faq.md](./v2-ctf-ops-faq.md) |
| **pm v2-check** | `./bin/pm v2-check` · `./bin/pm v2-check 0x…` |
| Example | `examples/17-v2-ctf-readiness-checklist.ts` |

## Drawer F · AI agents

| Skill | Install |
|-------|---------|
| polymarket-profile | `cp -R skills/polymarket-profile ~/.claude/skills/` |
| polymarket-pnl | `cp -R skills/polymarket-pnl ~/.claude/skills/` + `pip install httpx` |
| polymarket-brier | `cp -R skills/polymarket-brier ~/.claude/skills/` |

---

## Examples index

All numbered scripts: [`examples/`](../examples/) — one file per public API pattern.
