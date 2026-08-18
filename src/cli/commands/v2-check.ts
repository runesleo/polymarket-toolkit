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
      // MERGE/SPLIT can only be read in ASC, which returns oldest-first, so a
      // three-page sample would report a 2021 timestamp as the latest merge.
      // Ten pages of 500 covers the API's whole 5000-row offset cap, which puts
      // the real newest row in reach for every wallet below it.
      fetchActivityPages(address, { limit: 500, maxPages: 10, type: "MERGE" }),
      fetchActivityPages(address, { limit: 500, maxPages: 10, type: "SPLIT" }),
      fetchActivityPages(address, { limit: 200, maxPages: 3, type: "CONVERSION" }),
    ]);
    // Ordering-independent: DESC pages end on the oldest row, ASC pages end on
    // the newest, so taking the last element means different things per type.
    const newestTs = (rows: unknown[]) => {
      const arr = rows as Array<{ timestamp?: number }>;
      const ts = arr.map((r) => r.timestamp).filter((t): t is number => typeof t === "number");
      return ts.length ? Math.max(...ts) : null;
    };
    payload.address = address;
    payload.recentActivity = {
      merge: {
        count: merges.rows.length,
        newestTimestamp: newestTs(merges.rows),
        capped: merges.rows.length >= 5000,
        warnings: merges.warnings,
      },
      split: {
        count: splits.rows.length,
        newestTimestamp: newestTs(splits.rows),
        capped: splits.rows.length >= 5000,
        warnings: splits.warnings,
      },
      conversion: {
        count: conversions.rows.length,
        newestTimestamp: newestTs(conversions.rows),
        capped: false,
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
    const ra = payload.recentActivity as Record<
      string,
      { count: number; newestTimestamp: number | null; capped: boolean }
    >;
    for (const [k, v] of Object.entries(ra)) {
      const cap = v.capped ? " · hit the 5000-row API cap, newest may be later" : "";
      console.log(
        `  ${k.toUpperCase()}: ${v.count} rows (sample) · newest ts=${v.newestTimestamp ?? "n/a"}${cap}`,
      );
    }
    console.log("  → If MERGE count=0 after cutover but SPLIT>0, suspect infra drift (see FAQ).");
    console.log(
      "  → MERGE/SPLIT are read with sortDirection=ASC on purpose: the default DESC returns an",
    );
    console.log(
      "    empty array for those two types, which reads as 'never merged' and is not a drift signal.",
    );
  } else {
    console.log("\nTip: ./bin/pm v2-check 0xYourProxy — attach MERGE/SPLIT activity sample");
  }
}
