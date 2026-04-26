// 场景：抓取 LB 利润榜某一页，用于扫描排名或自定义排序前的原始数据。
// Problem: 需要 limit/offset 分页参数拼装与 JSON 解析。
// Run: npx tsx examples/06-lb-profit-leaderboard-page.ts
// API: fetchLbProfitLeaderboardPage — GET /profit?window=&limit=&offset=
// Notes: 默认 window=all；offset 步长建议与 limit 对齐避免漏行。

import { fetchLbProfitLeaderboardPage } from "../src/index.ts";

const rows = (await fetchLbProfitLeaderboardPage({ limit: 5, offset: 0 })) as Array<{
  name?: string;
  proxyWallet?: string;
  amount?: number;
}>;

for (const r of rows) {
  console.log((r.amount ?? 0).toFixed(2), r.name, r.proxyWallet?.slice(0, 10));
}
