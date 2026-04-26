// 场景：对已结算仓位用 avgPrice 与输赢计算 Brier（评估预测质量而非 PnL）。
// Problem: Brier 公式简单，但需要先筛 redeemable 并处理字段类型。
// Run: npx tsx examples/13-brier-score-settled.ts
// API: computeBrierScoreFromSettledPositions + fetchPositionsPage 组合。
// Notes: 样本少时分数噪声大；与 polymarket-brier SKILL 口径一致（简化版）。

import { computeBrierScoreFromSettledPositions, fetchPositionsPage } from "../src/index.ts";

const DEMO_USER = "0x63ce342161250d705dc0b16df89036c8e5f9ba9a";
const rows = (await fetchPositionsPage(DEMO_USER, { limit: 100, offset: 0 })) as Array<{
  redeemable?: boolean;
  avgPrice?: number;
  currentValue?: number;
}>;

const { brier, n, wins } = computeBrierScoreFromSettledPositions(rows);
console.log({ settled: n, wins, brier: Number.isFinite(brier) ? brier.toFixed(4) : brier });
