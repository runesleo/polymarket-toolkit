import {
  computeExecutionMix,
  computeFeeBasis,
  fetchActivityPages,
  fetchUserTrades,
  labelExecutionMix,
  resolveLbUsernameToProxyWallet,
  type ActivityTradeRow,
} from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

const DEFAULT_LIMIT = 500;
const VALUE_FLAGS = new Set(["--limit"]);

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

export async function runMix(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = positional(argv);
  if (!input) throw new Error("usage: pm mix <address|username> [--limit N] [--json]");

  const address = await resolveAddress(input);
  const limitIdx = argv.indexOf("--limit");
  const parsed = limitIdx === -1 ? NaN : Number(argv[limitIdx + 1]);
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : DEFAULT_LIMIT;

  const [all, taker, activity] = await Promise.all([
    fetchUserTrades(address, { limit, takerOnly: false }),
    fetchUserTrades(address, { limit, takerOnly: true }),
    // Independent second opinion. A charged fill is a taker fill — makers are
    // never charged — and the fee is already sitting in /activity as the
    // residual of usdcSize - size*price.
    fetchActivityPages(address, { type: "TRADE", limit, maxPages: 1 }),
  ]);

  const mix = computeExecutionMix(all, taker, { rowLimit: limit });
  const label = labelExecutionMix(mix.makerRatio);

  const basis = computeFeeBasis(activity.rows as ActivityTradeRow[]);
  // fee>0 is proof of taker; fee==0 is "maker OR fee-exempt", so this is an
  // upper bound on the passive share rather than a maker count.
  const feeMakerRatioUpperBound =
    basis.fills > 0 ? basis.zeroFeeFills / basis.fills : null;

  // The two methods answer the same question from unrelated data. When they
  // disagree by more than a rounding wobble, at least one is wrong, and saying
  // which would require evidence the tool does not have.
  const DISAGREEMENT_THRESHOLD = 0.2;
  const disagreement =
    mix.makerRatio != null && feeMakerRatioUpperBound != null
      ? Math.abs(mix.makerRatio - feeMakerRatioUpperBound)
      : null;
  const conflicted = disagreement != null && disagreement > DISAGREEMENT_THRESHOLD;
  const iso = (t: number): string => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");

  if (json) {
    printJson({
      address,
      ...mix,
      label: conflicted ? "unknown (methods disagree)" : label,
      feeEvidence: {
        fills: basis.fills,
        chargedFills: basis.chargedFills,
        zeroFeeFills: basis.zeroFeeFills,
        totalFees: basis.totalFees,
        feeRatio: basis.feeRatio,
        makerRatioUpperBound: feeMakerRatioUpperBound,
      },
      methodsDisagreeBy: disagreement,
      conflicted,
      windowUtc: mix.window ? { from: iso(mix.window.from), to: iso(mix.window.to) } : null,
      note: "Counted over the overlap of the two calls only; the endpoints reach back different distances.",
    });
    return;
  }

  console.log(`Execution mix · ${address}`);
  if (mix.total === 0) {
    console.log("  No fills in the comparable window.");
    return;
  }

  console.log(
    `  Window: ${iso(mix.window?.from ?? 0)} → ${iso(mix.window?.to ?? 0)} UTC` +
      ` (${(((mix.window?.seconds ?? 0) / 3600)).toFixed(1)}h)`,
  );
  console.log(`  Fills:  ${mix.total} in window · ${mix.maker} maker · ${mix.taker} taker\n`);
  console.log(
    `  Maker ratio: ${((mix.makerRatio ?? 0) * 100).toFixed(1)}%   → ${label}` +
      "   [from /trades takerOnly]",
  );
  if (feeMakerRatioUpperBound != null) {
    console.log(
      `  Fee evidence: ${basis.chargedFills}/${basis.fills} fills were charged` +
        ` (${(basis.feeRatio ?? 0) * 100 < 0.001 ? "~0" : ((basis.feeRatio ?? 0) * 100).toFixed(4)}%` +
        ` of notional) → maker ratio at most ${(feeMakerRatioUpperBound * 100).toFixed(1)}%`,
    );
  }

  if (conflicted) {
    console.log(
      `\n  !! The two methods disagree by ${((disagreement ?? 0) * 100).toFixed(1)} points.` +
        "\n     takerOnly is a filter on the trade record, which describes the whole match" +
        "\n     rather than your leg; a charged fee is direct proof you were the taker." +
        "\n     Treat the execution style as UNKNOWN here and check `pm fees` before" +
        "\n     concluding anything about this wallet.",
    );
  }

  if (mix.orphanTakerFills > 0) {
    console.log(
      `\n  ! ${mix.orphanTakerFills} taker fills are absent from the unfiltered call over the` +
        `\n    same span. The taker set should be a subset of it — the ratio is not reliable here.`,
    );
  }
  if (mix.truncated) {
    console.log(
      `\n  ! The window is flush against the ${limit}-row limit, so it was cut by the row cap` +
        `\n    rather than by the wallet going quiet. This is the recent tail, not a lifetime mix.`,
    );
  }
  console.log(
    `\n  Both calls hit the same endpoint; only the takerOnly flag differs. Counting them` +
      `\n  against each other whole would compare two different spans — a maker's taker-only` +
      `\n  page reaches much further back, having fewer rows to fill it with. Only the overlap` +
      `\n  is comparable, and only the overlap is counted.`,
  );
}
