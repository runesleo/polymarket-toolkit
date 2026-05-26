import {
  computeBrierScoreFromSettledPositions,
  fetchPositionsPage,
  resolveLbUsernameToProxyWallet,
} from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

async function resolveAddress(input: string): Promise<string> {
  const trimmed = input.trim();
  if (isEvmAddress(trimmed)) return normalizeAddress(trimmed);
  const resolved = await resolveLbUsernameToProxyWallet(trimmed);
  if (!resolved) throw new Error(`Could not resolve "${trimmed}" via leaderboard.`);
  return normalizeAddress(resolved);
}

export async function runBrier(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = argv.find((a) => !a.startsWith("--"));
  if (!input) throw new Error("usage: pm brier <address|username> [--json]");

  const address = await resolveAddress(input);
  const positions = (await fetchPositionsPage(address, { limit: 200 })) as Array<{
    redeemable?: boolean;
    avgPrice?: number | string;
    currentValue?: number | string;
  }>;

  const settled = positions.filter((p) => p.redeemable === true);
  const result = computeBrierScoreFromSettledPositions(settled);

  const payload = {
    address,
    brier: Number.isFinite(result.brier) ? result.brier : null,
    settledMarkets: result.n,
    wins: result.wins,
    rating:
      !Number.isFinite(result.brier)
        ? "insufficient_sample"
        : result.brier <= 0.15
          ? "good"
          : result.brier <= 0.25
            ? "moderate"
            : "poor",
    note: "First 200 positions page; full calibration use skills/polymarket-brier.",
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`Brier · ${address}`);
  if (!Number.isFinite(result.brier)) {
    console.log("  No settled positions in sample.");
    return;
  }
  console.log(`  Score: ${result.brier.toFixed(3)} (${payload.rating})`);
  console.log(`  Settled: ${result.n} · Wins: ${result.wins}`);
}
