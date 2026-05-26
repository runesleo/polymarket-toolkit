// Scenario: LB all-time vs audit path — when to trust each PnL layer.
// Run: npx tsx examples/19-pnl-lb-crosscheck.ts <0x_proxy>
// Docs: docs/fee-inclusive-pnl.md · audit: skills/polymarket-pnl/compute_precise_pnl.py

import { fetchLbProfitForAddress } from "../src/index.ts";

const address = process.argv[2];
if (!address) throw new Error("usage: npx tsx examples/19-pnl-lb-crosscheck.ts <0x>");

const lb = (await fetchLbProfitForAddress(address, "all")) as Array<{ amount?: number; name?: string }>;
console.log(
  JSON.stringify(
    {
      address,
      lbAllTime: lb[0]?.amount ?? null,
      name: lb[0]?.name ?? null,
      next: "python3 skills/polymarket-pnl/compute_precise_pnl.py --address " + address,
      docs: "docs/fee-inclusive-pnl.md",
    },
    null,
    2,
  ),
);
