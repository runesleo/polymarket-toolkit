// 场景：拉取某个地址最近一页 activity（成交/赎回等），做流水或风控初筛。
// Problem: Data API activity 分页入口不直观；本 demo 只取第一页验证连通与字段。
// Run: npx tsx examples/03-fetch-activity-page.ts
// API: fetchActivityPage — GET /activity?user=&limit=&type?&end?
// Notes: 大账户需按 SKILL 文档用 end 游标翻页直到页不满。

import { fetchActivityPage } from "../src/index.ts";

const DEMO_USER = "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const page = (await fetchActivityPage(DEMO_USER, { limit: 5 })) as Array<{
  type?: string;
  title?: string;
  usdcSize?: number;
  timestamp?: number;
}>;

console.log("rows:", page.length);
for (const row of page) {
  console.log(row.type, row.timestamp, (row.title ?? "").slice(0, 60), row.usdcSize);
}
