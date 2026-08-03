import { fetchCashflow } from "../../cashflow.ts";
import { resolveLbUsernameToProxyWallet } from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

const DEFAULT_DAYS = 7;

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
const VALUE_FLAGS = new Set(["--days", "--rpc"]);

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

function strFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function utc(ts: number | undefined): string {
  return ts === undefined ? "     —     " : new Date(ts * 1000).toISOString().slice(5, 16).replace("T", " ");
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function runCashflow(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = positional(argv);
  if (!input) {
    throw new Error("usage: pm cashflow <address|username> [--days N] [--rpc URL] [--json]");
  }

  const address = await resolveAddress(input);
  const days = numFlag(argv, "--days", DEFAULT_DAYS);
  const rpcUrl = strFlag(argv, "--rpc");

  const report = await fetchCashflow(address, {
    days,
    ...(rpcUrl ? { rpcUrl } : {}),
  });

  if (json) {
    printJson({
      ...report,
      note: "cashOuts = pUSD unwrapped back to USDC. Settlement transfers are trade flow, not withdrawals.",
    });
    return;
  }

  console.log(`Cashflow · ${address}`);
  console.log(`  ${days}d window · blocks ${report.fromBlock} → ${report.toBlock}`);
  if (report.balance !== undefined) {
    console.log(`  pUSD balance: ${usd(report.balance)}`);
  }
  if (report.partial) {
    console.log("  ⚠️  Some block ranges failed — totals are a lower bound.");
  }
  console.log();

  if (report.cashOuts.length === 0) {
    console.log("  Cash-outs: none in window.");
  } else {
    console.log("  Cash-outs (pUSD unwrapped to USDC)");
    console.log("     when (UTC)        amount           tx");
    console.log("  " + "-".repeat(58));
    for (const c of report.cashOuts) {
      console.log(`     ${utc(c.timestamp)}  ${usd(c.amount).padStart(12)}   ${c.transactionHash.slice(0, 18)}…`);
    }
    console.log("  " + "-".repeat(58));
    const perDay = report.totalCashOut / days;
    console.log(
      `     ${report.cashOuts.length} events${" ".repeat(6)}${usd(report.totalCashOut).padStart(12)}   (${usd(perDay)}/day)`,
    );
  }

  console.log();
  console.log("  Settlement (trade flow — NOT cash-out)");
  console.log(
    `     ${report.settlementTransfers.toLocaleString("en-US")} transfers · ${usd(report.settlementVolume)}`,
  );
  console.log();
  console.log("  Recipient == the pUSD contract means a cash-out; anything else is settlement.");
  console.log("  Reading USDC/USDC.e instead of pUSD returns $0 for every Polymarket account.");
}
