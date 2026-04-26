// 场景：读取用户当前/历史仓位一页，用于展示持仓或计算 Brier 的原始输入。
// Problem: positions 接口需分页；本例只展示 offset=0 的第一页。
// Run: npx tsx examples/04-fetch-positions-page.ts
// API: fetchPositionsPage — GET /positions?user=&limit=&offset=&sizeThreshold=
// Notes: 若返回满页 100 条，继续增大 offset 直到不足一页。

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
