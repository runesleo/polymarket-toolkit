// 场景：读取用户当前/历史仓位一页，用于展示持仓或计算 Brier 的原始输入。
// Problem: positions 接口需分页；本例只展示第一页。
// Run: npx tsx examples/04-fetch-positions-page.ts
// API: fetchPositionsPage — GET /v2/positions?user=&limit=&filter_type=TOKENS&filter_amount=
// Notes: v2 只认游标；offset 参数由库在本地跳过实现（v2 收到 offset 会 400）。

import { fetchPositionsPage } from "../src/index.ts";

const DEMO_USER = "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const rows = (await fetchPositionsPage(DEMO_USER, { limit: 5, offset: 0 })) as Array<{
  title?: string;
  outcome?: string;
  size?: number;
  curPrice?: number;
  redeemable?: boolean;
}>;

for (const p of rows) {
  console.log(p.outcome, "redeemable=", p.redeemable, (p.title ?? "").slice(0, 56), "size", p.size);
}
