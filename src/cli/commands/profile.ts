import {
  computeBrierScoreFromSettledPositions,
  fetchLbProfitForAddress,
  fetchPositionsPage,
  resolveLbUsernameToProxyWallet,
} from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

type LbRow = { amount?: number | string; name?: string; pseudonym?: string };
type PositionRow = {
  title?: string;
  slug?: string;
  currentValue?: number | string;
  cashPnl?: number | string;
  redeemable?: boolean;
  avgPrice?: number | string;
};

async function resolveIdentity(input: string): Promise<{ address: string; displayName: string | null }> {
  const trimmed = input.trim();
  if (isEvmAddress(trimmed)) {
    return { address: normalizeAddress(trimmed), displayName: null };
  }
  const resolved = await resolveLbUsernameToProxyWallet(trimmed);
  if (!resolved) {
    throw new Error(
      `Could not resolve "${trimmed}" via leaderboard. Pass a 0x proxy wallet or a ranked username.`,
    );
  }
  return { address: normalizeAddress(resolved), displayName: trimmed };
}

async function lbAmount(address: string, window: "all" | "7d" | "30d"): Promise<number | null> {
  const rows = (await fetchLbProfitForAddress(address, window)) as LbRow[];
  const head = rows[0];
  if (!head || head.amount == null) return null;
  const n = Number(head.amount);
  return Number.isFinite(n) ? n : null;
}

function fmtUsd(n: number | null): string {
  if (n == null) return "n/a";
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export async function runProfile(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const input = positional[0];
  if (!input) throw new Error("usage: pm profile <address|username> [--json]");

  const { address, displayName } = await resolveIdentity(input);

  const [pnlAll, pnl7d, pnl30d, positionsRaw, lbMeta] = await Promise.all([
    lbAmount(address, "all"),
    lbAmount(address, "7d"),
    lbAmount(address, "30d"),
    fetchPositionsPage(address, { limit: 100 }),
    fetchLbProfitForAddress(address, "all") as Promise<LbRow[]>,
  ]);

  const positions = positionsRaw as PositionRow[];
  const open = positions.filter((p) => p.redeemable !== true);
  const settledForBrier = positions.filter((p) => p.redeemable === true);
  const brier = computeBrierScoreFromSettledPositions(settledForBrier);

  const unrealized = open.reduce((sum, p) => sum + Number(p.currentValue ?? 0), 0);
  const topOpen = [...open]
    .sort((a, b) => Math.abs(Number(b.currentValue ?? 0)) - Math.abs(Number(a.currentValue ?? 0)))
    .slice(0, 5);

  const name = displayName ?? lbMeta[0]?.name ?? lbMeta[0]?.pseudonym ?? address.slice(0, 10);

  const payload = {
    address,
    displayName: name,
    pnl: { all: pnlAll, d7: pnl7d, d30: pnl30d, source: "lb-api.polymarket.com/profit" },
    positions: {
      openCount: open.length,
      settledSampleCount: settledForBrier.length,
      unrealizedValue: unrealized,
      topOpen: topOpen.map((p) => ({
        title: p.title ?? p.slug ?? "unknown",
        currentValue: Number(p.currentValue ?? 0),
        cashPnl: Number(p.cashPnl ?? 0),
      })),
    },
    brier: {
      score: Number.isFinite(brier.brier) ? brier.brier : null,
      settledMarkets: brier.n,
      wins: brier.wins,
      note: "First 100 positions page only; use polymarket-pnl skill for audit-grade PnL.",
    },
    limitations: [
      "LB PnL only; 7d/30d may be empty for inactive accounts.",
      "Positions capped at first API page (100 rows).",
      "For full profile + categories use skills/polymarket-profile.",
    ],
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Polymarket Profile · ${name}`);
  console.log(`  ${address}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\n📊 PnL (LB API)`);
  console.log(`  All-time:  ${fmtUsd(pnlAll)}`);
  console.log(`  7d:        ${fmtUsd(pnl7d)}`);
  console.log(`  30d:       ${fmtUsd(pnl30d)}`);
  console.log(`\n📂 Positions (first page)`);
  console.log(`  Open: ${open.length} · Unrealized ≈ ${fmtUsd(unrealized)}`);
  for (const p of payload.positions.topOpen) {
    console.log(`  · ${p.title.slice(0, 48)} — ${fmtUsd(p.currentValue)}`);
  }
  if (brier.n > 0) {
    console.log(`\n🎯 Brier (settled in sample)`);
    console.log(`  Score: ${brier.brier.toFixed(3)} · ${brier.wins}/${brier.n} winning markets`);
  }
  console.log(`\n⚠️  ${payload.limitations[2]}`);
  console.log(`    Audit PnL: skills/polymarket-pnl`);
}
