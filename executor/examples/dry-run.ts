// Dry-run demo: build a limit order and print exactly what would be sent —
// including resolved builder attribution — without any network call or credentials.
//
//   cd executor && npm run dry-run
//
// Override:  POLY_BUILDER_CODE=0x<64hex> npm run dry-run
// Opt out:   POLYMARKET_DISABLE_BUILDER_ATTRIBUTION=1 npm run dry-run

import { buildLimitOrder, describeDryRun } from "../src/orders.ts";

const order = buildLimitOrder({
  tokenID: "71321045679252212594626385532706912750332728571942532289631379312455583992563",
  price: 0.42,
  side: "BUY",
  size: 5,
});

const payload = describeDryRun(order);
console.log(JSON.stringify(payload, null, 2));
