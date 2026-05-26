/** Shared CLI helpers — no side effects at import time. */

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

export function isEvmAddress(value: string): boolean {
  return EVM_RE.test(value.trim());
}

export function normalizeAddress(value: string): string {
  const v = value.trim();
  if (!isEvmAddress(v)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }
  return v.toLowerCase();
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function usage(): void {
  console.log(`pm — Polymarket Toolkit CLI (builders · public APIs only)

Usage:
  pm profile <address|username> [--json]   Address snapshot (PnL, positions, Brier)
  pm activity <address> [--type TRADE]     Activity pagination + cap warnings
  pm scan [--limit N] [--min-volume N]     Market scanner (24h volume · spread)
  pm updown <event-slug> [--json]          Crypto updown Gamma fields / resolution
  pm v2-check [address]                    V2 split/merge infra checklist (+ activity)
  pm lb [--category overall] [--save]      Leaderboard snapshot + diff
  pm lb --diff [--category overall]        Diff vs yesterday snapshot
  pm pnl-check <address>                   LB snapshot + hints; not audit-grade PnL
  pm limits [gamma|data|clob|all]          API rate limit pacing table
  pm redeem <address> [low_watermark]      Redeem watchdog (read-only)
  pm brier <address|username> [--json]     Brier score from settled positions
  pm markets [--limit N] [--active]        List Gamma markets (quick scan)
  pm help                                  Show this message

Examples:
  pm profile 0x63ce342161250d705dc0b16df89036c8e5f9ba9a
  pm redeem 0x63ce342161250d705dc0b16df89036c8e5f9ba9a 25
  pm markets --limit 5 --active

Skills (for AI agents): skills/polymarket-profile · polymarket-pnl · polymarket-brier
Cookbook: docs/cookbook.md · Examples: examples/

No API keys. No signing. Read-only public APIs only.
`);
}
