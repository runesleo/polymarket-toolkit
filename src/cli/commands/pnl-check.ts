import { fetchActivityPage, fetchLbProfitForAddress } from "../../index.ts";
import { isEvmAddress, normalizeAddress, printJson } from "../util.ts";

export async function runPnlCheck(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const input = argv.find((a) => !a.startsWith("--"));
  if (!input) throw new Error("usage: pm pnl-check <0x-address> [--json]");

  const address = normalizeAddress(input);
  if (!isEvmAddress(address)) throw new Error("Invalid address");

  const [lbRows, tradePage, rebatePage] = await Promise.all([
    fetchLbProfitForAddress(address, "all") as Promise<Array<{ amount?: number; name?: string }>>,
    fetchActivityPage(address, { limit: 500, type: "TRADE" }),
    fetchActivityPage(address, { limit: 200, type: "MAKER_REBATE" }),
  ]);

  const lbPnl = lbRows[0]?.amount != null ? Number(lbRows[0].amount) : null;
  const name = lbRows[0]?.name ?? address.slice(0, 10);

  const payload = {
    address,
    name,
    lbPnlAllTime: lbPnl,
    lbSource: "lb-api.polymarket.com/profit?window=all",
    activitySample: {
      tradeRowsFirstPage: (tradePage as unknown[]).length,
      makerRebateRowsFirstPage: (rebatePage as unknown[]).length,
    },
    interpretation: [
      "LB PnL is a quick official snapshot and hint surface; it is not audit-grade PnL.",
      "Position-level profile PnL is approximate.",
      "For cashflow replay run: python3 skills/polymarket-pnl/compute_precise_pnl.py --address …",
    ],
    docs: "docs/fee-inclusive-pnl.md",
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`PnL check · ${name} · ${address}\n`);
  console.log(`  LB all-time: ${lbPnl != null ? `$${lbPnl.toLocaleString()}` : "n/a"}`);
  console.log(`  Activity sample: ${payload.activitySample.tradeRowsFirstPage} TRADE rows (page 1)`);
  console.log(`  Rebates sample: ${payload.activitySample.makerRebateRowsFirstPage} MAKER_REBATE rows (page 1)`);
  console.log("  Scope: LB snapshot + hints; not audit-grade PnL.");
  console.log("\n  → Audit: python3 skills/polymarket-pnl/compute_precise_pnl.py --address " + address);
  console.log("  → Read: docs/fee-inclusive-pnl.md");
}
