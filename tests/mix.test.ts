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

test("a wallet that stopped crossing the spread stays measured to the present", () => {
  // The failure this guards: closing the window at the taker page's newest row treats
  // "no taker fills since January" as missing data, when it is the finding itself. Every
  // passive fill after that point would be discarded — and for a pure market maker, that
  // is nearly all of them.
  const lastTakerFill = trade({ timestamp: 1_000 });
  const passiveSince = [
    trade({ timestamp: 5_000 }),
    trade({ timestamp: 6_000 }),
    trade({ timestamp: 7_000 }),
  ];
  const all = [lastTakerFill, ...passiveSince];
  const taker = [lastTakerFill];

  const mix = computeExecutionMix(all, taker);
  assert.equal(mix.window?.to, 7_000, "window must run to the newest fill, not the newest taker fill");
  assert.equal(mix.total, 4);
  assert.equal(mix.taker, 1);
  assert.equal(mix.maker, 3);
  assert.equal(mix.makerRatio, 0.75);
  // Clipping at the taker page would have given total=1, taker=1, makerRatio=0 —
  // reporting the most passive wallet in the set as fully aggressive.
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
  // Starts where both pages are complete (900), runs to the newest fill (1000).
  assert.deepEqual(mix.window, { from: 900, to: 1000, seconds: 100 });
  // The two old taker fills sit before the start and are excluded — counting the pages
  // whole would have divided a 900-second taker span by a 100-second unfiltered one.
  assert.equal(mix.total, 3);
  assert.equal(mix.taker, 1);
  assert.equal(mix.maker, 2);
  assert.ok(Math.abs((mix.makerRatio ?? 0) - 2 / 3) < 1e-9);
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
