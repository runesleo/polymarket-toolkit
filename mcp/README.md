# polymarket-toolkit-mcp

MCP server exposing [polymarket-toolkit](https://github.com/runesleo/polymarket-toolkit)'s
**read-only** Polymarket data CLI as [Model Context Protocol](https://modelcontextprotocol.io)
tools for AI agents. No keys, no orders — data only.

## Quick start

```bash
claude mcp add polymarket-toolkit -- npx -y polymarket-toolkit-mcp
```

Generic MCP client config:

```json
{
  "mcpServers": {
    "polymarket-toolkit": {
      "command": "npx",
      "args": ["-y", "polymarket-toolkit-mcp"]
    }
  }
}
```

## Tools (10, all read-only)

| Tool | What it answers |
|---|---|
| `pm_profile` | PnL + open positions snapshot for an address/username |
| `pm_activity` | Recent trades for an address/username |
| `pm_brier` | Prediction-quality (Brier) score from settled positions |
| `pm_pnl_check` | Fee-inclusive PnL cross-check vs leaderboard |
| `pm_scan` | Active markets ranked by 24h volume + spread |
| `pm_updown` | Crypto up/down market fields for an event slug |
| `pm_leaderboard` | Profit leaderboard snapshot |
| `pm_redeem_watchdog` | Redeemable positions for an address (no signing) |
| `pm_v2_check` | V2 CTF readiness diagnostics |
| `pm_rate_limits` | Known Polymarket API rate limits (offline) |

## Security model

- Every tool shells out to the toolkit's `pm` CLI (argv array, no shell) — the server can do
  exactly what the read-only CLI can do, nothing more.
- Inputs are allowlist-validated twice (MCP SDK layer + independent handler re-validation).
- Subprocess guards: 60s timeout, 2MB output cap, concurrency limit.
- **No trading over MCP** — order placement lives in the toolkit's separate opt-in
  [`executor/`](https://github.com/runesleo/polymarket-toolkit/tree/main/executor) package,
  human-wired only.

Full docs: [docs/mcp.md](https://github.com/runesleo/polymarket-toolkit/blob/main/docs/mcp.md)
