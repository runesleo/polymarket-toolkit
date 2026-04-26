// 场景：用 REST 读取 CLOB midpoint（单一数字价），适合仪表盘或轻量轮询。
// Problem: 从 Gamma 拿 token_id 后，最快读到「中间价」字段。
// Run: npx tsx examples/12-clob-midpoint-rest.ts
// API: fetchClobMidpoint — GET /midpoint?token_id=
// Notes: mid 为字符串小数；高频场景可改用 WebSocket best_bid_ask。

import { fetchClobMidpoint, fetchGammaMarkets, parseGammaMarketTokenIds } from "../src/index.ts";

const markets = (await fetchGammaMarkets({ limit: 1, active: true })) as Array<{ clobTokenIds?: string }>;
const tid = parseGammaMarketTokenIds(markets[0] ?? {})[0];
if (!tid) throw new Error("no token");

const mid = await fetchClobMidpoint(tid);
console.log("midpoint", mid);
