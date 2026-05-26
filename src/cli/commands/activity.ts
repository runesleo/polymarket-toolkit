import { fetchActivityPages, resolveLbUsernameToProxyWallet } from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

async function resolveAddress(input: string): Promise<string> {
  const trimmed = input.trim();
  if (isEvmAddress(trimmed)) return normalizeAddress(trimmed);
  const resolved = await resolveLbUsernameToProxyWallet(trimmed);
  if (!resolved) throw new Error(`Could not resolve "${trimmed}" via leaderboard.`);
  return normalizeAddress(resolved);
}

export async function runActivity(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const typeIdx = argv.indexOf("--type");
  const activityType = typeIdx >= 0 ? argv[typeIdx + 1] : undefined;
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1] ?? 500) : 500;
  const maxPagesIdx = argv.indexOf("--max-pages");
  const maxPages = maxPagesIdx >= 0 ? Number(argv[maxPagesIdx + 1] ?? 10) : 10;

  const skipNext = new Set(["--type", "--limit", "--max-pages"]);
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") continue;
    if (skipNext.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    positional.push(a);
  }

  const input = positional[0];
  if (!input) {
    throw new Error("usage: pm activity <address|username> [--type TRADE] [--limit N] [--max-pages N] [--json]");
  }

  const address = await resolveAddress(input);
  const result = await fetchActivityPages(address, {
    limit,
    maxPages,
    type: activityType,
  });

  const payload = {
    address,
    type: activityType ?? null,
    rowCount: result.rows.length,
    pagesFetched: result.pagesFetched,
    likelyIncomplete: result.likelyIncomplete,
    warnings: result.warnings,
    sample: (result.rows as Array<{ type?: string; timestamp?: number; title?: string; usdcSize?: number }>).slice(0, 5).map((r) => ({
      type: r.type,
      timestamp: r.timestamp,
      title: r.title?.slice(0, 60),
      usdcSize: r.usdcSize,
    })),
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`Activity · ${address}`);
  console.log(`  Rows: ${result.rows.length} (${result.pagesFetched} pages)`);
  if (result.warnings.length) {
    for (const w of result.warnings) {
      console.log(`  ⚠️  [${w.code}] ${w.message}`);
    }
  }
  if (result.likelyIncomplete) {
    console.log("  Status: INCOMPLETE — do not trust totals beyond this point.");
  }
  for (const row of payload.sample) {
    console.log(`  · ${row.type} ts=${row.timestamp} ${row.title ?? ""} $${row.usdcSize ?? "?"}`);
  }
}
