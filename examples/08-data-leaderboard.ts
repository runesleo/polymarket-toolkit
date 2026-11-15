// 场景：读取 Data API v2 排行榜（含 rank、volume、user_name），映射兼容字段用于交叉校验。
// Problem: v2 使用 snake_case；本 demo 通过 helper 获取 rank、pnl、userName 等兼容字段。
// Run: npx tsx examples/08-data-leaderboard.ts
// API: fetchDataLeaderboardPnL — GET /v2/leaderboard
// Notes: helper 将 offset 兼容参数转为 v2 cursor 翻页；不要在原始 v2 请求中传 offset。

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
