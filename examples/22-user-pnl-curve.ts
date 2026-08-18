// 场景：拉官方资金曲线（Polymarket profile 上那条线的数据源），并和 lb-api 的单值快照对齐。
// Problem: lb-api /profit 每次只给一个数字，画不出趋势；想复现曲线就得找到时间序列端点。
// Run: npx tsx examples/22-user-pnl-curve.ts [address]
// API: fetchUserPnlSeries — GET user-pnl-api /user-pnl?user_address=&interval=&fidelity=
// Notes: interval 枚举 max|all|1m|1w|1d|12h（没有 1y）；fidelity 是枚举 1d|18h|12h|3h|1h，
//        不是分钟数 —— 传 60 会返回 200 + 对象（不是 4xx，也不会取最近的合法值），
//        所以解析前必须判形状，helper 已代为抛错。
//        ⚠️ 曲线和 lb-api 都是【税前】口径：不扣 taker 手续费、也不计 maker 返佣。
//        用现金流回放去对它，会随累计手续费单调向下偏离 —— 这正是区分「手续费漂移」
//        与「持仓估值漂移」的判据：前者只增不减，后者随开平仓来回摆。见 `pm fees`。

import { fetchLbProfitForAddress, fetchUserPnlSeries } from "../src/index.ts";

const address = (process.argv[2] ?? "0x43011bc04df353c8092662d13b4aaacb4b62ac39").toLowerCase();

const daily = await fetchUserPnlSeries(address, { interval: "all", fidelity: "1d" });
if (daily.length === 0) {
  console.log(`no curve points for ${address}`);
  process.exit(0);
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const first = daily[0]!;
const last = daily[daily.length - 1]!;

console.log(`user-pnl · ${address}`);
console.log(`  points:  ${daily.length}  (${iso(first.t)} → ${iso(last.t)})`);
console.log(`  first:   $${first.p.toFixed(2)}`);
console.log(`  last:    $${last.p.toFixed(2)}`);

// 两次调用即可覆盖前端所有窗口：1m+1h = 720 个小时点（1D/1W/1M 都从它切片）。
const hourly = await fetchUserPnlSeries(address, { interval: "1m", fidelity: "1h" });
console.log(`  hourly:  ${hourly.length} points over the last month`);

// 和 lb-api 的实时单值对照。曲线按 fidelity 分桶、lb-api 实时，
// 所以「差几百刀」是口径差不是 bug —— 但对一个已经没有持仓的钱包，两者会收敛到同一个数。
const lb = (await fetchLbProfitForAddress(address, "all")) as Array<{ amount?: number }>;
const snapshot = lb[0]?.amount;
if (typeof snapshot === "number") {
  console.log(`\n  lb-api /profit?window=all: $${snapshot.toFixed(2)}`);
  console.log(`  curve last point:          $${last.p.toFixed(2)}`);
  console.log(`  delta:                     $${(snapshot - last.p).toFixed(2)}`);
  console.log("  (bucketed vs realtime — a gap here is the two sources' cadence, not an error)");
}
