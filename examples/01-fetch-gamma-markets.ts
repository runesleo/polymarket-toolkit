// 场景：快速浏览 Gamma 上当前可交易的市场列表（标题、流动性、conditionId）。
// Problem: You want a structured list of active markets from Gamma without scraping HTML.
// Run: npx tsx examples/01-fetch-gamma-markets.ts
// API: fetchGammaMarkets — wraps GET /markets with query params.
// Notes: Tight limit keeps the demo fast; increase `limit` for more rows.

import { fetchGammaMarkets } from "../src/index.ts";

const rows = (await fetchGammaMarkets({ limit: 3, active: true })) as Array<{
  question?: string;
  slug?: string;
  liquidity?: string;
  conditionId?: string;
}>;

for (const m of rows) {
  console.log("-", m.question?.slice(0, 72));
  console.log("  slug:", m.slug, "| liq:", m.liquidity);
}
