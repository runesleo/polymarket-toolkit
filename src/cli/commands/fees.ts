import {
  computeFeeBasis,
  fetchActivityPages,
  fetchLbProfitForAddress,
  netAfterFees,
  resolveLbUsernameToProxyWallet,
  type ActivityTradeRow,
} from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

const VALUE_FLAGS = new Set(["--pages", "--limit"]);

async function resolveAddress(input: string): Promise<string> {
  const trimmed = input.trim();
  if (isEvmAddress(trimmed)) return normalizeAddress(trimmed);
  const resolved = await resolveLbUsernameToProxyWallet(trimmed);
  if (!resolved) throw new Error(`Could not resolve "${trimmed}" via leaderboard.`);
  return normalizeAddress(resolved);
}

function positional(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (VALUE_FLAGS.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith("--")) continue;
    return a;
  }
  return undefined;
}

function numFlag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number | null): string {
  return n == null ? "n/a" : `${(n * 100).toFixed(4)}%`;
}

export async function runFees(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = positional(argv);
  if (!input) {
    throw new Error("usage: pm fees <address|username> [--pages N] [--limit N] [--json]");
  }

  const address = await resolveAddress(input);
  const maxPages = numFlag(argv, "--pages", 20);
  const limit = numFlag(argv, "--limit", 500);

  const [trades, rebateRows, lbRows] = await Promise.all([
    fetchActivityPages(address, { type: "TRADE", limit, maxPages }),
    fetchActivityPages(address, { type: "MAKER_REBATE", limit, maxPages }),
    fetchLbProfitForAddress(address, "all").catch(() => [] as unknown[]),
  ]);

  const basis = computeFeeBasis(trades.rows as ActivityTradeRow[]);
  const makerRebates = (rebateRows.rows as Array<{ usdcSize?: number | string }>).reduce(
    (sum, r) => sum + (Number(r.usdcSize ?? 0) || 0),
    0,
  );
  const lb = (lbRows as Array<{ amount?: number }>)[0];
  const officialPnl = typeof lb?.amount === "number" ? lb.amount : null;

  const payload = {
    address,
    fills: basis.fills,
    chargedFills: basis.chargedFills,
    zeroFeeFills: basis.zeroFeeFills,
    chargedRatio: basis.chargedRatio,
    buyFees: basis.buyFees,
    sellFees: basis.sellFees,
    totalFees: basis.totalFees,
    notional: basis.notional,
    feeRatio: basis.feeRatio,
    feePerShare: basis.feePerShare,
    impliedRate: basis.impliedRate,
    unmodeledFills: basis.unmodeledFills,
    wrongSignFills: basis.wrongSignFills,
    makerRebates,
    officialPnl,
    netAfterFees:
      officialPnl == null ? null : netAfterFees(officialPnl, basis.totalFees, makerRebates),
    window: basis.window,
    activityIncomplete: trades.likelyIncomplete,
    note:
      "Fee is the residual of usdcSize - size*price. fee>0 proves a taker fill; " +
      "fee==0 means maker OR fee-exempt category and is not a maker count.",
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`Fee basis · ${address}\n`);
  console.log(`  fills                ${basis.fills}${trades.likelyIncomplete ? "  ⚠️ INCOMPLETE" : ""}`);
  console.log(`  notional (fee-free)  ${money(basis.notional)}`);
  console.log(`  fees paid            ${money(basis.totalFees)}  (buy ${money(basis.buyFees)} · sell ${money(basis.sellFees)})`);
  console.log(`  fee / notional       ${pct(basis.feeRatio)}`);
  console.log(
    `  charged fills        ${basis.chargedFills} / ${basis.fills}` +
      `  (${pct(basis.chargedRatio)} — these are taker fills, makers are never charged)`,
  );
  console.log(
    `  zero-fee fills       ${basis.zeroFeeFills}` +
      `  ⚠️ maker OR fee-exempt category — the API cannot tell those apart`,
  );

  const ps = basis.feePerShare;
  if (ps.median != null) {
    console.log(
      `  fee per share        $${ps.median.toFixed(5)}  (p10 $${ps.p10?.toFixed(5)} · p90 $${ps.p90?.toFixed(5)} · n=${ps.samples})`,
    );
  }

  const r = basis.impliedRate;
  if (r.median != null) {
    console.log(
      `  implied rate         ${r.median.toFixed(4)}  (p10 ${r.p10?.toFixed(4)} · p90 ${r.p90?.toFixed(4)} · n=${r.samples})`,
    );
    console.log("                       from fee = rate x shares x p x (1-p); read it, never hardcode it");
  } else {
    console.log("  implied rate         n/a — no charged fill fits the rate model here");
  }
  if (basis.unmodeledFills > 0) {
    console.log(
      `  ⚠️ unmodeled fills    ${basis.unmodeledFills} charged fill(s) the rate model does not explain`,
    );
    console.log(
      "                       (near p=0 or p=1 some wallets pay ~1c/share — a floor, not a rate)",
    );
    console.log("                       totalFees above is measured, so it is unaffected");
  }
  if (basis.wrongSignFills > 0) {
    console.log(
      `  🔴 wrong-sign fills   ${basis.wrongSignFills} — residual is not purely fee; do not read these totals as fees`,
    );
  }

  console.log(`\n  maker rebates        ${money(makerRebates)}`);
  if (officialPnl != null) {
    console.log(`  official PnL (LB)    ${money(officialPnl)}   ← pre-fee, pre-rebate`);
    console.log(
      `  net after fees       ${money(netAfterFees(officialPnl, basis.totalFees, makerRebates))}` +
        `   = official - fees + rebates`,
    );
  }

  console.log("\n  Reconciling against a cashflow replay:");
  console.log("    official = replay + lifetime taker fees - maker rebates");
  console.log("    A gap close to the fee total is this. A gap far larger is not —");
  console.log("    check CONVERSION (neg-risk) and MERGE/SPLIT before trusting either number.");
  if (trades.likelyIncomplete) {
    console.log("\n  ⚠️ Activity pagination reported INCOMPLETE — these totals are a floor, not a total.");
  }
}
