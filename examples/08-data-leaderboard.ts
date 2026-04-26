// 场景：读取 Data API v1 排行榜（含 rank、vol、userName），与 LB 榜可做交叉校验。
// Problem: 两个 leaderboard 端点字段不同；本 demo 展示 data-api 形态。
// Run: npx tsx examples/08-data-leaderboard.ts
// API: fetchDataLeaderboardPnL — GET /v1/leaderboard
// Notes: orderBy=PNL & category=overall 为常用组合；可调 limit 拉更长名单。

import { fetchDataLeaderboardPnL } from "../src/index.ts";

const rows = (await fetchDataLeaderboardPnL({ limit: 5, offset: 0 })) as Array<{
  rank?: string;
  userName?: string;
  pnl?: number;
  proxyWallet?: string;
}>;

for (const r of rows) {
  console.log("#" + r.rank, r.userName, "pnl", r.pnl, r.proxyWallet?.slice(0, 10));
}
