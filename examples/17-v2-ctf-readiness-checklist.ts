// Scenario: print V2 / CTF readiness checklist for builders (no signing).
// Problem: after V2 upgrade, merge/split scripts fail — usually infra drift, not API removal.
// Run: npx tsx examples/17-v2-ctf-readiness-checklist.ts [0x_proxy_wallet]
// See: docs/v2-ctf-ops-faq.md

import { fetchActivityPages } from "../src/index.ts";

const CHECKLIST = [
  "CTF 0x4D97…6045 unchanged",
  "Exchange contract = V2 in your config",
  "@polymarket/clob-client-v2 for orders",
  "relayer-v2.polymarket.com if gasless",
  "pUSD / collateral env aligned",
  "negRisk vs regular adapter path per market",
  "CTF approvals after Safe migration",
  "No stale nonce in V2 order body",
];

console.log("V2 / CTF readiness checklist\n");
CHECKLIST.forEach((line, i) => console.log(`${i + 1}. ${line}`));
console.log("\nFAQ: docs/v2-ctf-ops-faq.md");

const addr = process.argv[2];
if (addr) {
  console.log(`\nActivity sample · ${addr}`);
  for (const type of ["MERGE", "SPLIT"] as const) {
    const r = await fetchActivityPages(addr, { limit: 100, maxPages: 2, type });
    console.log(`  ${type}: ${r.rows.length} rows (sample) incomplete=${r.likelyIncomplete}`);
  }
}
