// Scenario: inspect redeemable positions for a public wallet without private keys.
// Problem: after pUSD auto-redeem, agents still need a status lane for stuck or low-cash accounts.
// Run: npx tsx examples/15-redeem-watchdog.ts <proxy_wallet> [low_watermark]
// API: fetchRedeemablePositionsPage + summarizeRedeemablePositions + resolveRedeemMode.
// Notes: this example never signs or sends transactions.

import {
  fetchRedeemablePositionsPage,
  resolveRedeemMode,
  summarizeRedeemablePositions,
} from "../src/index.ts";

const user = process.argv[2];
if (!user) throw new Error("usage: npx tsx examples/15-redeem-watchdog.ts <proxy_wallet> [low_watermark]");

const lowWatermark = process.argv[3] ? Number(process.argv[3]) : undefined;
const rows = await fetchRedeemablePositionsPage(user, { limit: 100, offset: 0 });
const summary = summarizeRedeemablePositions(rows as Parameters<typeof summarizeRedeemablePositions>[0]);
const mode = resolveRedeemMode({ lowWatermark });

console.log(JSON.stringify({
  user,
  mode,
  lowWatermark: lowWatermark ?? null,
  ...summary,
  topConditions: summary.topConditions.slice(0, 5),
}, null, 2));
