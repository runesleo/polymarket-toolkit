// 场景：从 Gamma 市场记录解析 CLOB outcome token id，供 midpoint/book/WS 使用。
// Problem: clobTokenIds 存成 JSON 字符串；手写 JSON.parse 易踩类型坑。
// Run: npx tsx examples/10-parse-gamma-token-ids.ts
// API: parseGammaMarketTokenIds — 安全解析 clobTokenIds 字段。
// Notes: 二元市场通常两个 id（Yes/No 各一）；按业务选其中一边。

import { fetchGammaMarkets, parseGammaMarketTokenIds } from "../src/index.ts";

const markets = (await fetchGammaMarkets({ limit: 1, active: true })) as Array<{ clobTokenIds?: string }>;
const ids = parseGammaMarketTokenIds(markets[0] ?? {});
console.log("token ids:", ids);
