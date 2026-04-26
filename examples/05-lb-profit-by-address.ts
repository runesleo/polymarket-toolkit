// 场景：用 LB API 按地址查总盈亏（与 leaderboard 同源口径的快照）。
// Problem: 想对比「官方排行榜展示的 PnL」与单地址查询是否一致。
// Run: npx tsx examples/05-lb-profit-by-address.ts
// API: fetchLbProfitForAddress — GET lb-api /profit?address=&window=
// Notes: 返回数组；通常取 [0]；7d/30d 窗口可能对不活跃地址为空。

import { fetchLbProfitForAddress } from "../src/index.ts";

const DEMO_USER = "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const rows = (await fetchLbProfitForAddress(DEMO_USER, "all")) as Array<{ amount?: number; name?: string }>;

const head = rows[0] ?? null;
console.log(JSON.stringify(head ?? rows, null, 2));
if (head && head.amount != null) console.log("amount:", Number(head.amount).toFixed(2));
