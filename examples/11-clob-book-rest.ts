// 场景：用 REST 拉某 outcome token 的完整订单簿快照（bids/asks 档位）。
// Problem: 不想接 WebSocket 时，用 book 端点做一次性深度检查或回测采样。
// Run: npx tsx examples/11-clob-book-rest.ts
// API: fetchClobBook — GET clob /book?token_id=
// Notes: 返回体量可能较大；示例只打印最优买卖档摘要。

import { fetchClobBook, fetchGammaMarkets, parseGammaMarketTokenIds } from "../src/index.ts";

const markets = (await fetchGammaMarkets({ limit: 1, active: true })) as Array<{ clobTokenIds?: string }>;
const tid = parseGammaMarketTokenIds(markets[0] ?? {})[0];
if (!tid) throw new Error("no token");

const book = (await fetchClobBook(tid)) as { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };
console.log("best bid", book.bids?.[0], "best ask", book.asks?.[0]);
