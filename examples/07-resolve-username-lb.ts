// 场景：把用户在站内显示名解析成 proxy 钱包（仅覆盖「在利润榜有分页记录」的账户）。
// Problem: 用户只丢一个 handle，脚本需自动翻页匹配 name / pseudonym。
// Run: npx tsx examples/07-resolve-username-lb.ts
// API: resolveLbUsernameToProxyWallet — 基于 fetchLbProfitLeaderboardPage 扫描。
// Notes: 未上榜新号无法解析；需让用户直接粘贴 0x 地址。

import { resolveLbUsernameToProxyWallet } from "../src/index.ts";

const name = process.argv[2] ?? "Theo4";
const addr = await resolveLbUsernameToProxyWallet(name, 3);
console.log(name, "=>", addr ?? "(not found in first pages)");
