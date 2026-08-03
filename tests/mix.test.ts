import test from "node:test";
import assert from "node:assert/strict";
import { computeExecutionMix, labelExecutionMix, type TradeRow } from "../src/index.ts";

let seq = 0;
function trade(over: Partial<TradeRow> = {}): TradeRow {
  seq += 1;
  return {
    proxyWallet: "0xme",
    side: "BUY",
    asset: "tok",
    conditionId: "0xcond",
    size: 1,
    price: 0.5,
    timestamp: 1000,
    transactionHash: `0xtx${seq}`,
    ...over,
  };
}

test("maker ratio counts fills absent from the taker-only call", () => {
  const t1 = trade({ timestamp: 100 });
  const t2 = trade({ timestamp: 200 });
  const m1 = trade({ timestamp: 150 });
  const mix = computeExecutionMix([t1, m1, t2], [t1, t2]);
  assert.equal(mix.total, 3);
  assert.equal(mix.taker, 2);
  assert.equal(mix.maker, 1);
  assert.ok(Math.abs((mix.makerRatio ?? 0) - 1 / 3) < 1e-9);
});

test("only the overlap is counted — the taker call reaches further back", () => {
  // A maker's taker-only page spans a much wider window because it has fewer rows to
  // fill. Counting both pages whole would divide two different spans.
  const old1 = trade({ timestamp: 100 });
  const old2 = trade({ timestamp: 200 });
  const recentTaker = trade({ timestamp: 900 });
  const recentMaker1 = trade({ timestamp: 950 });
  const recentMaker2 = trade({ timestamp: 1000 });

  const all = [recentTaker, recentMaker1, recentMaker2]; // window 900..1000
  const taker = [old1, old2, recentTaker]; // window 100..900

  const mix = computeExecutionMix(all, taker);
  assert.deepEqual(mix.window, { from: 900, to: 900, seconds: 0 });
  // Only recentTaker sits inside the overlap; the two old taker fills are out of range.
  assert.equal(mix.total, 1);
  assert.equal(mix.taker, 1);
  assert.equal(mix.maker, 0);
  assert.equal(mix.makerRatio, 0);
  // Counting the pages whole would have said 3 fills, 1 taker -> 67% maker. It does not.
});

test("a taker fill missing from the unfiltered call is flagged, not absorbed", () => {
  const shared = trade({ timestamp: 100 });
  const ghost = trade({ timestamp: 150 }); // in taker set only, inside the window
  const later = trade({ timestamp: 200 });
  const mix = computeExecutionMix([shared, later], [shared, ghost, later]);
  assert.equal(mix.orphanTakerFills, 1);
});

test("truncation is reported when the window is flush against the row limit", () => {
  const rows = Array.from({ length: 100 }, (_, i) => trade({ timestamp: 1000 + i }));
  // Taker fills at both ends so the overlap spans every row — otherwise the overlap
  // itself shrinks and there is nothing flush against the limit to detect.
  const taker = [rows[0] as TradeRow, rows[99] as TradeRow];
  const mix = computeExecutionMix(rows, taker, { rowLimit: 100 });
  assert.equal(mix.total, 100);
  assert.equal(mix.truncated, true);
  const roomy = computeExecutionMix(rows, taker, { rowLimit: 500 });
  assert.equal(roomy.total, 100);
  assert.equal(roomy.truncated, false);
});

test("a wallet with no taker fills at all is fully passive, not unknown", () => {
  const rows = [trade({ timestamp: 100 }), trade({ timestamp: 200 })];
  const mix = computeExecutionMix(rows, []);
  assert.equal(mix.total, 2);
  assert.equal(mix.maker, 2);
  assert.equal(mix.makerRatio, 1);
});

test("no fills yields null rather than a ratio of zero", () => {
  const mix = computeExecutionMix([], []);
  assert.equal(mix.total, 0);
  assert.equal(mix.makerRatio, null);
  assert.equal(mix.window, null);
});

test("labels span the range", () => {
  assert.equal(labelExecutionMix(null), "unknown");
  assert.equal(labelExecutionMix(0.95), "passive (market maker)");
  assert.equal(labelExecutionMix(0.7), "mostly passive");
  assert.equal(labelExecutionMix(0.5), "mixed");
  assert.equal(labelExecutionMix(0.2), "mostly aggressive");
  assert.equal(labelExecutionMix(0.05), "aggressive (taker)");
});
