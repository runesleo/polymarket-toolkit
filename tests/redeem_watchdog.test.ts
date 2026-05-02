import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRedeemMode,
  summarizeRedeemablePositions,
} from "../src/index.ts";

test("summarizeRedeemablePositions groups redeemable positions without private keys", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xaaa", slug: "market-a", currentValue: 7.5 },
    { redeemable: true, conditionId: "0xaaa", slug: "market-a", currentValue: "2.5" },
    { redeemable: false, conditionId: "0xbbb", slug: "market-b", currentValue: 100 },
  ]);

  assert.equal(summary.redeemableCount, 2);
  assert.equal(summary.conditionCount, 1);
  assert.equal(summary.estimatedRedeemableValue, 10);
  assert.deepEqual(summary.topConditions[0], {
    conditionId: "0xaaa",
    slug: "market-a",
    count: 2,
    estimatedValue: 10,
  });
});

test("resolveRedeemMode defaults to public watchdog and uses low-watermark when needed", () => {
  assert.equal(resolveRedeemMode(), "watchdog");
  assert.equal(resolveRedeemMode({ lowWatermark: 25 }), "low_watermark");
  assert.equal(resolveRedeemMode({ mode: "active" }), "active");
  assert.equal(resolveRedeemMode({ mode: "watch" }), "watchdog");
});
