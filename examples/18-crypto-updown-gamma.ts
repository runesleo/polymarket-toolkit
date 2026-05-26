// Scenario: inspect crypto updown Gamma event fields for resolution / price source debugging.
// Problem: 5m/15m buckets need correct reference price — community "priceToBeat" is not one stable API field.
// Run: npx tsx examples/18-crypto-updown-gamma.ts <event-slug>
// Docs: docs/crypto-updown-price-source.md

import { fetchGammaEventsBySlug } from "../src/index.ts";

const slug = process.argv[2];
if (!slug) {
  throw new Error("usage: npx tsx examples/18-crypto-updown-gamma.ts <event-slug>");
}

const events = await fetchGammaEventsBySlug(slug);
console.log(JSON.stringify(events, null, 2));
