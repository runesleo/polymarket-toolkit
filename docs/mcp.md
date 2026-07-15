# MCP server (v0.7) — toolkit tools for AI agents

The [`mcp/`](../mcp) sub-package exposes the toolkit's **read-only** CLI as
[Model Context Protocol](https://modelcontextprotocol.io) tools, so Claude, Codex, Cursor, or any
MCP client can query Polymarket data directly. Same isolation model as `executor/`: own
dependencies, never imported by the zero-dependency core.

**The CLI is the contract**: every tool shells out to `pm` — the server can do exactly what the
read-only CLI can do, nothing more. No keys, no orders, no local writes (`pm lb --save` is not
exposed). Inputs are validated (charset allowlist, no leading dashes) before they ever reach argv.

## Setup

```bash
cd mcp && npm install
```

Claude Code:

```bash
claude mcp add polymarket-toolkit -- node --experimental-strip-types /path/to/polymarket-toolkit/mcp/src/server.ts
```

Generic MCP client config:

```json
{
  "mcpServers": {
    "polymarket-toolkit": {
      "command": "node",
      "args": ["--experimental-strip-types", "/path/to/polymarket-toolkit/mcp/src/server.ts"]
    }
  }
}
```

## Tools

| Tool | Args | Backing CLI |
|---|---|---|
| `pm_profile` | address/username | `pm profile <x> --json` |
| `pm_activity` | address/username, limit? | `pm activity <x> --json` |
| `pm_brier` | address/username | `pm brier <x> --json` |
| `pm_pnl_check` | 0x address | `pm pnl-check <x> --json` |
| `pm_scan` | — | `pm scan` |
| `pm_updown` | event slug | `pm updown <slug> --json` |
| `pm_leaderboard` | — | `pm lb` |
| `pm_redeem_watchdog` | 0x address | `pm redeem <x>` |
| `pm_v2_check` | — | `pm v2-check` |
| `pm_rate_limits` | — | `pm limits` (offline) |

## Non-goals

- No order placement through MCP. The executor is a separate opt-in package and is intentionally
  **not** exposed as an MCP tool — agent-driven trading needs deliberate human wiring, not a
  chat-tool call.
- No credentials of any kind: the server runs with whatever env it inherits but never reads keys.
