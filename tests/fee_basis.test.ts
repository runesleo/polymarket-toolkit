import test from "node:test";
import assert from "node:assert/strict";
import { computeFeeBasis, impliedFeeForFill, netAfterFees } from "../src/index.ts";

/**
 * Real rows, measured 2026-08-18. `usdcSize` is not `size * price`; the
 * residual is the fee, and on this wallet it fits `rate x shares x p x (1-p)`
 * at rate = 0.0500 to four decimals.
 */
const REAL_BUYS = [
  { side: "BUY", size: 78.3784, price: 0.37, usdcSize: 29.9135, timestamp: 100 },
  { side: "BUY", size: 940.1429, price: 0.49, usdcSize: 472.4171, timestamp: 200 },
  { side: "BUY", size: 359.375, price: 0.0056, usdcSize: 2.0994, timestamp: 300 },
];

test("fee is the residual, and the sign follows the side", () => {
  assert.ok(Math.abs((impliedFeeForFill(REAL_BUYS[0]!) ?? 0) - 0.9135) < 1e-4);
  // SELL pays the fee out of the proceeds, so the raw residual is negative and
  // the implied fee is its negation.
  const sell = { side: "SELL", size: 100, price: 0.5, usdcSize: 49.125 };
  assert.ok(Math.abs((impliedFeeForFill(sell) ?? 0) - 0.875) < 1e-9);
  assert.equal(impliedFeeForFill({ size: 1, price: 0.5, usdcSize: 0.5 }), null, "unknown side");
});

test("implied rate recovers the documented 0.05 from real rows", () => {
  const basis = computeFeeBasis(REAL_BUYS);
  assert.equal(basis.chargedFills, 3);
  assert.equal(basis.zeroFeeFills, 0);
  assert.ok(basis.impliedRate.median != null);
  assert.ok(
    Math.abs((basis.impliedRate.median as number) - 0.05) < 0.001,
    `expected ~0.05, got ${basis.impliedRate.median}`,
  );
  assert.equal(basis.unmodeledFills, 0);
  assert.deepEqual(basis.window, { from: 100, to: 300 });
});

test("zero-fee fills are never reported as a maker count", () => {
  const rows = [
    { side: "BUY", size: 100, price: 0.5, usdcSize: 50 }, // no fee
    ...REAL_BUYS,
  ];
  const basis = computeFeeBasis(rows);
  assert.equal(basis.zeroFeeFills, 1);
  assert.equal(basis.chargedFills, 3);
  // The type has no `makerFills` — "fee==0" is maker OR fee-exempt, and the
  // API cannot separate them. If this ever fails because such a field was
  // added, the claim it makes is not supported by the data.
  assert.ok(!("makerFills" in basis));
});

test("a per-share floor at extreme prices is counted, not averaged in", () => {
  // Measured shape: 200 shares at p=0.9990 charged ~$2.01, about 1 cent per
  // share. The rate model predicts 0.05 * 200 * 0.999 * 0.001 = $0.01, so the
  // quotient comes out near 10 — two orders of magnitude off.
  const rows = [
    ...REAL_BUYS,
    { side: "BUY", size: 200, price: 0.999, usdcSize: 201.812 },
  ];
  const basis = computeFeeBasis(rows);
  assert.equal(basis.unmodeledFills, 1, "the extreme-price fill must be flagged, not averaged");
  assert.ok(
    Math.abs((basis.impliedRate.median as number) - 0.05) < 0.001,
    "the rate must stay clean once the unmodeled fill is excluded",
  );
  // It is still charged and still counted in the money, because the total is
  // measured rather than modelled.
  assert.equal(basis.chargedFills, 4);
  assert.ok(basis.totalFees > 2);
});

test("a wrong-signed residual is not counted as a fee", () => {
  // A BUY that paid less than quoted cannot be explained by a fee.
  const rows = [...REAL_BUYS, { side: "BUY", size: 100, price: 0.99, usdcSize: 98.0 }];
  const basis = computeFeeBasis(rows);
  assert.equal(basis.wrongSignFills, 1);
  assert.equal(basis.chargedFills, 3, "the anomaly must not inflate the taker count");
  const clean = computeFeeBasis(REAL_BUYS);
  assert.equal(basis.totalFees, clean.totalFees, "nor the money");
});

test("empty input is empty, not a divide-by-zero", () => {
  const basis = computeFeeBasis([]);
  assert.equal(basis.fills, 0);
  assert.equal(basis.chargedRatio, null);
  assert.equal(basis.feeRatio, null);
  assert.equal(basis.window, null);
});

test("netAfterFees inverts the pre-fee basis", () => {
  // Measured wallet: official -2583.33, lifetime fees 1308.87, no rebates.
  // An independent cashflow replay of the same wallet came out at -3893.04.
  const net = netAfterFees(-2583.33, 1308.87, 0);
  assert.ok(Math.abs(net - -3893.04) < 1.0, `expected ~-3893, got ${net}`);
  // Rebates push the other way.
  assert.equal(netAfterFees(100, 10, 4), 94);
});
