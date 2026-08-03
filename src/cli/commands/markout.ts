import {
  computeMarkout,
  fetchMarketTrades,
  fetchUserTrades,
  resolveLbUsernameToProxyWallet,
  type TradeRow,
} from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

const DEFAULT_TAUS = [10, 30, 60];
const DEFAULT_FILLS = 200;
/** Below this share of fills priced, the mean is a statement about the sample, not the trader. */
const COVERAGE_FLOOR = 0.5;

async function resolveAddress(input: string): Promise<string> {
  const trimmed = input.trim();
  if (isEvmAddress(trimmed)) return normalizeAddress(trimmed);
  const resolved = await resolveLbUsernameToProxyWallet(trimmed);
  if (!resolved) throw new Error(`Could not resolve "${trimmed}" via leaderboard.`);
  return normalizeAddress(resolved);
}

function numFlag(argv: string[], name: string, fallback: number): number {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Flags that consume the following argv entry, so it is not mistaken for the address. */
const VALUE_FLAGS = new Set(["--fills", "--taus", "--window"]);

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

function fmt(cents: number | null): string {
  return cents === null ? "     —" : `${cents >= 0 ? "+" : ""}${cents.toFixed(2)}¢`;
}

export async function runMarkout(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = positional(argv);
  if (!input) {
    throw new Error(
      "usage: pm markout <address|username> [--fills N] [--taus 10,30,60] [--window S] [--json]",
    );
  }

  const address = await resolveAddress(input);
  const fillLimit = numFlag(argv, "--fills", DEFAULT_FILLS);
  const halfWindow = numFlag(argv, "--window", 5);
  const tausIdx = argv.indexOf("--taus");
  const taus =
    tausIdx === -1
      ? DEFAULT_TAUS
      : (argv[tausIdx + 1] ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
  if (taus.length === 0) throw new Error("--taus needs at least one positive number");

  const fills = await fetchUserTrades(address, { limit: fillLimit, takerOnly: false });
  if (fills.length === 0) {
    if (json) {
      printJson({ address, fills: 0, results: [], note: "no fills returned" });
      return;
    }
    console.log(`Markout · ${address}\n  No fills returned.`);
    return;
  }

  const conditionIds = [...new Set(fills.map((f) => f.conditionId))];
  const prints: TradeRow[] = [];
  for (const cid of conditionIds) {
    prints.push(...(await fetchMarketTrades(cid, { limit: 1000 })));
  }

  const results = computeMarkout(fills, prints, {
    taus,
    vwapHalfWindowSec: halfWindow,
    excludeAddress: address,
  });

  const from = Math.min(...fills.map((f) => f.timestamp));
  const to = Math.max(...fills.map((f) => f.timestamp));
  const iso = (t: number): string => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");

  if (json) {
    printJson({
      address,
      fills: fills.length,
      markets: conditionIds.length,
      prints: prints.length,
      spanUtc: { from: iso(from), to: iso(to) },
      vwapHalfWindowSec: halfWindow,
      results,
      note: "Negative excess = fills are adversely selected vs the rest of the market.",
    });
    return;
  }

  console.log(`Markout · ${address}`);
  console.log(
    `  ${fills.length} fills · ${conditionIds.length} markets · ${prints.length} prints · ${iso(from)} → ${iso(to)} UTC`,
  );
  console.log(`  Reference: size-weighted VWAP over t+tau ±${halfWindow}s`);
  console.log(`  Baseline:  every other wallet's fills on the same tokens\n`);

  console.log("     tau      n   coverage      mine   median  baseline    excess");
  console.log("  " + "-".repeat(64));
  for (const r of results) {
    const cov = `${(r.coverage * 100).toFixed(0)}%`;
    console.log(
      `  ${String(r.tau).padStart(6)}s ${String(r.mine.n).padStart(6)} ${cov.padStart(10)} ` +
        `${fmt(r.mine.meanCents).padStart(9)} ${fmt(r.mine.medianCents).padStart(8)} ` +
        `${fmt(r.baseline?.meanCents ?? null).padStart(9)} ${fmt(r.excessCents).padStart(9)}`,
    );
  }

  console.log("\n  By direction (excess over baseline):");
  for (const r of results) {
    const parts = (["BUY", "SELL"] as const).map((sd) => {
      const d = r.byDirection[sd];
      const ex = d.mine !== null && d.baseline !== null ? d.mine - d.baseline : null;
      return `${sd} ${fmt(ex)}`;
    });
    console.log(`    tau=${String(r.tau).padStart(3)}s   ${parts.join("   ")}`);
  }

  const worst = results.reduce((a, b) => (a.coverage <= b.coverage ? a : b));
  if (worst.coverage < COVERAGE_FLOOR) {
    console.log(
      `\n  ! Coverage ${(worst.coverage * 100).toFixed(0)}% at tau=${worst.tau}s — most fills have no` +
        ` print that far ahead.\n    Common in short-dated markets: tau must stay well inside the` +
        ` remaining window, or\n    the sample collapses to the few fills placed early.`,
    );
  }

  const headline = results.find((r) => r.excessCents !== null && r.coverage >= COVERAGE_FLOOR);
  if (headline?.excessCents != null) {
    console.log(
      headline.excessCents < -1
        ? `\n  Reading: ${fmt(headline.excessCents)}/share vs baseline at tau=${headline.tau}s —` +
            ` fills are adversely\n  selected. Passive makers run negative markout by design; what` +
            ` matters is that this\n  one is worse than the rest of the market.`
        : `\n  Reading: ${fmt(headline.excessCents)}/share vs baseline at tau=${headline.tau}s —` +
            ` no adverse selection\n  beyond what everyone else in these markets is eating.`,
    );
  }
  console.log(
    `\n  Read the excess column, not the levels. The baseline drifts positive in markets` +
      `\n  that converge to 0 or 1: the winning side trades more, and late fills have no` +
      `\n  print ahead of them to be priced against, so they drop out. Both effects hit` +
      `\n  your fills and the baseline alike, which is what the subtraction is for.`,
  );
  console.log(
    `\n  Markout is execution quality, not PnL. Rebates, spread capture and holding to` +
      `\n  resolution are all outside it — a negative markout can still be a profitable book.`,
  );
}
