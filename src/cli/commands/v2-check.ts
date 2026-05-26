import { fetchActivityPages } from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

const CHECKLIST = [
  "CTF contract unchanged (0x4D97…6045) — split/merge target",
  "Exchange contract = V2 (not legacy V1 address in your config)",
  "CLOB client: @polymarket/clob-client-v2 for V2 order path",
  "Relayer host: relayer-v2.polymarket.com (if using gasless)",
  "Collateral: pUSD / wrap path matches your env (post cutover)",
  "Per-market negRisk flag → correct adapter (merge/split path)",
  "CTF setApprovalForAll(adapter + exchange) after wallet migration",
  "Order body: no stale nonce field (V2 SDK)",
  "Separate CLOB auth errors from on-chain merge reverts",
];

export async function runV2Check(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = argv.find((a) => !a.startsWith("--") && a !== "v2-check");

  const payload: Record<string, unknown> = {
    checklist: CHECKLIST,
    docs: "docs/v2-ctf-ops-faq.md",
    note: "Read-only checklist. On-chain execution is out of scope for this repo.",
  };

  if (input) {
    const address = isEvmAddress(input) ? normalizeAddress(input) : null;
    if (!address) {
      throw new Error("Optional address must be 0x… proxy wallet");
    }
    const [merges, splits, conversions] = await Promise.all([
      fetchActivityPages(address, { limit: 200, maxPages: 3, type: "MERGE" }),
      fetchActivityPages(address, { limit: 200, maxPages: 3, type: "SPLIT" }),
      fetchActivityPages(address, { limit: 200, maxPages: 3, type: "CONVERSION" }),
    ]);
    const lastTs = (rows: unknown[]) => {
      const arr = rows as Array<{ timestamp?: number }>;
      return arr.length ? arr[arr.length - 1]?.timestamp ?? null : null;
    };
    payload.address = address;
    payload.recentActivity = {
      merge: { count: merges.rows.length, lastTimestamp: lastTs(merges.rows), warnings: merges.warnings },
      split: { count: splits.rows.length, lastTimestamp: lastTs(splits.rows), warnings: splits.warnings },
      conversion: {
        count: conversions.rows.length,
        lastTimestamp: lastTs(conversions.rows),
        warnings: conversions.warnings,
      },
    };
  }

  if (json) {
    printJson(payload);
    return;
  }

  console.log("V2 / CTF readiness checklist (builder · read-only)\n");
  CHECKLIST.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
  console.log(`\nFull FAQ: docs/v2-ctf-ops-faq.md`);
  if (payload.recentActivity) {
    console.log(`\nRecent on-chain activity sample · ${payload.address}`);
    const ra = payload.recentActivity as Record<string, { count: number; lastTimestamp: number | null }>;
    for (const [k, v] of Object.entries(ra)) {
      console.log(`  ${k.toUpperCase()}: ${v.count} rows (sample) · last ts=${v.lastTimestamp ?? "n/a"}`);
    }
    console.log("  → If MERGE count=0 after cutover but SPLIT>0, suspect infra drift (see FAQ).");
  } else {
    console.log("\nTip: ./bin/pm v2-check 0xYourProxy — attach MERGE/SPLIT activity sample");
  }
}
