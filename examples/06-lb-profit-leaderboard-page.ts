// 场景：抓取 LB 利润榜某一页，用于扫描排名或自定义排序前的原始数据。
// Problem: 需要分页参数拼装与 JSON 解析。
// Run: npx tsx examples/06-lb-profit-leaderboard-page.ts
// API: fetchLbProfitLeaderboardPage — GET /v2/leaderboard?time_period=&sort_by=PNL&limit=（lb-api 已停用，行仍是 lb-api 形状）
// Notes: 默认 window=all（7d/30d 对应 v2 的 week/month）；offset 由库沿游标跳过实现。

import { fetchLbProfitLeaderboardPage } from "../src/index.ts";

const rows = (await fetchLbProfitLeaderboardPage({ limit: 5, offset: 0 })) as Array<{
  name?: string;
  proxyWallet?: string;
  amount?: number;
}>;

for (const r of rows) {
  console.log((r.amount ?? 0).toFixed(2), r.name, r.proxyWallet?.slice(0, 10));
}
