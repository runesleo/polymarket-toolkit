import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_API_V2_BASE,
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

test("string '0' currentValue is treated as payable 0, not fallback to size", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xe1", slug: "x", size: 9.99, currentValue: "0" },
  ]);
  assert.equal(summary.estimatedRedeemableValue, 0);
});

test("NaN-coercing currentValue (e.g. junk string) reduces to 0, no NaN leak", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xe2", slug: "x", size: 4, currentValue: "not-a-number" },
  ]);
  assert.equal(summary.estimatedRedeemableValue, 0);
  assert.equal(Number.isNaN(summary.estimatedRedeemableValue), false);
});

test("negative currentValue is clamped to 0 (payable value cannot be negative)", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xe3", slug: "x", size: 10, currentValue: -2 },
    { redeemable: true, conditionId: "0xe3", slug: "x", size: 10, currentValue: 5 },
  ]);
  assert.equal(summary.estimatedRedeemableValue, 5);
  assert.ok(summary.topConditions[0].estimatedCurrentValue >= 0);
});

test("both currentValue and size missing → row counted but contributes 0", () => {
  const summary = summarizeRedeemablePositions([
    { redeemable: true, conditionId: "0xe4", slug: "x" },
  ]);
  assert.equal(summary.redeemableCount, 1);
  assert.equal(summary.estimatedRedeemableValue, 0);
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

test("fetchRedeemablePositionsPage asks /v2/positions for status=REDEEMABLE and returns v1-named rows", async (t) => {
  // Use node:test built-in mock.method so the original is auto-restored at
  // test exit (no manual finally), and parallel tests in the same file
  // cannot race on globalThis.fetch.
  const v2Row = (i: number) => ({
    proxy_wallet: "0xabc",
    token_id: `tok${i}`,
    condition_id: `0xc${i}`,
    current_size: 10,
    avg_price: 0.4,
    current_value: i % 2 ? 0 : 10,
    status: "REDEEMABLE",
    redeemable: true,
    slug: `market-${i}`,
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    const data = Array.from({ length: 150 }, (_, i) => v2Row(i));
    return new Response(JSON.stringify({ data, pagination: { has_more: false, next_cursor: null } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  // v2 has no offset: rows 100..149 are read past, not requested by offset.
  const rows = (await fetchRedeemablePositionsPage("0xabc", { limit: 50, offset: 100 })) as Array<
    Record<string, unknown>
  >;

  assert.equal(fetchMock.mock.callCount(), 1);
  const calledWith = fetchMock.mock.calls[0].arguments[0];
  const u = new URL(String(calledWith));
  assert.equal(`${u.origin}${u.pathname}`, `${DATA_API_V2_BASE}/positions`);
  assert.equal(u.searchParams.get("user"), "0xabc");
  assert.equal(u.searchParams.get("status"), "REDEEMABLE");
  assert.equal(u.searchParams.get("filter_type"), "TOKENS");
  assert.equal(u.searchParams.get("filter_amount"), "0");
  assert.equal(u.searchParams.get("limit"), "150");
  assert.equal(u.searchParams.get("offset"), null, "v2 rejects offset, even offset=0");

  assert.equal(rows.length, 50);
  assert.equal(rows[0]!.conditionId, "0xc100");
  assert.equal(rows[0]!.currentValue, 10);
  assert.equal(rows[1]!.currentValue, 0);
  assert.equal(rows[0]!.redeemable, true);
  assert.equal(rows[0]!.size, 10);
  // The summary still works on the converted rows.
  const summary = summarizeRedeemablePositions(rows as Parameters<typeof summarizeRedeemablePositions>[0]);
  assert.equal(summary.redeemableCount, 50);
  assert.equal(summary.estimatedRedeemableValue, 250);
});
