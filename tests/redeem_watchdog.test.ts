import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_API_BASE,
  fetchRedeemablePositionsPage,
  resolveRedeemMode,
  summarizeRedeemablePositions,
} from "../src/index.ts";

test("summarizeRedeemablePositions uses currentValue (winning rows count, losing rows are 0)", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xaaa", slug: "market-a", currentValue: 7.5, size: 10 },
    { redeemable: true, conditionId: "0xaaa", slug: "market-a", currentValue: "2.5", size: 10 },
    { redeemable: false, conditionId: "0xbbb", slug: "market-b", currentValue: 100 },
  ]);

  assert.equal(summary.redeemableCount, 2);
  assert.equal(summary.conditionCount, 1);
  assert.equal(summary.estimatedRedeemableValue, 10);
  assert.deepEqual(summary.topConditions[0], {
    conditionId: "0xaaa",
    slug: "market-a",
    count: 2,
    estimatedCurrentValue: 10,
  });
});

test("losing redeemable rows (currentValue:0) are NOT counted as payable", () => {
  // Real Data API shape for losing tokens after resolution: redeemable=true,
  // size>0, currentValue=0. They redeem to $0 — the old `||` fallback to size
  // would falsely report ~1.84 here. Now must report 0.
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xc1", slug: "btc-down", size: 0.7628, currentValue: 0 },
    { redeemable: true, conditionId: "0xc2", slug: "eth-down", size: 0.6899, currentValue: 0 },
    { redeemable: true, conditionId: "0xc3", slug: "btc-down-2", size: 0.3904, currentValue: 0 },
  ]);

  assert.equal(summary.redeemableCount, 3);
  assert.equal(summary.conditionCount, 3);
  assert.equal(summary.estimatedRedeemableValue, 0);
  for (const row of summary.topConditions) assert.equal(row.estimatedCurrentValue, 0);
});

test("missing currentValue falls back to size (best-effort estimate)", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xd1", slug: "x", size: 5 },
    { redeemable: true, conditionId: "0xd1", slug: "x", size: 3, currentValue: null },
  ]);
  assert.equal(summary.estimatedRedeemableValue, 8);
});

test("resolveRedeemMode only returns watchdog or low_watermark — no active label", () => {
  assert.equal(resolveRedeemMode(), "watchdog");
  assert.equal(resolveRedeemMode({ lowWatermark: 25 }), "low_watermark");
  assert.equal(resolveRedeemMode({ mode: "watch" }), "watchdog");
  assert.equal(resolveRedeemMode({ mode: "watermark" }), "low_watermark");
  assert.equal(resolveRedeemMode({ mode: "active" }), "watchdog");
  assert.equal(resolveRedeemMode({ mode: "auto" }), "watchdog");
  assert.equal(resolveRedeemMode({ mode: "always", lowWatermark: 10 }), "low_watermark");
});

test("fetchRedeemablePositionsPage builds the correct Data API URL with redeemable=true", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = (async (input: string | URL) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await fetchRedeemablePositionsPage("0xabc", { limit: 50, offset: 100 });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const u = new URL(capturedUrl);
  assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_BASE}/positions`);
  assert.equal(u.searchParams.get("user"), "0xabc");
  assert.equal(u.searchParams.get("redeemable"), "true");
  assert.equal(u.searchParams.get("sizeThreshold"), "0");
  assert.equal(u.searchParams.get("limit"), "50");
  assert.equal(u.searchParams.get("offset"), "100");
});
