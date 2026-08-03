import test from "node:test";
import assert from "node:assert/strict";
import { computeMarkout, type TradeRow } from "../src/index.ts";

const TOKEN = "111";
const COND = "0xcond";

function trade(over: Partial<TradeRow>): TradeRow {
  return {
    proxyWallet: "0xother",
    side: "BUY",
    asset: TOKEN,
    conditionId: COND,
    size: 1,
    price: 0.5,
    timestamp: 0,
    ...over,
  };
}

test("markout is negative when price moves against a BUY", () => {
  const fills = [trade({ proxyWallet: "0xme", side: "BUY", price: 0.6, timestamp: 100 })];
  // reference window is t+10 ±5 -> [105, 115]
  const prints = [trade({ price: 0.5, timestamp: 110 })];
  const [r] = computeMarkout(fills, prints, { taus: [10] });
  assert.ok(r);
  assert.equal(r.mine.n, 1);
  assert.ok(Math.abs(r.mine.meanCents - -10) < 1e-9, `got ${r.mine.meanCents}`);
});

test("a SELL is scored with the opposite sign", () => {
  const fills = [trade({ proxyWallet: "0xme", side: "SELL", price: 0.6, timestamp: 100 })];
  const prints = [trade({ price: 0.5, timestamp: 110 })];
  const [r] = computeMarkout(fills, prints, { taus: [10] });
  assert.ok(r);
  assert.ok(Math.abs(r.mine.meanCents - 10) < 1e-9, `got ${r.mine.meanCents}`);
});

test("reference price is size-weighted across the window, not the next print", () => {
  const fills = [trade({ proxyWallet: "0xme", side: "BUY", price: 0.5, timestamp: 100 })];
  // Bid/ask bounce inside the window: 0.40 on size 1, 0.60 on size 3 -> VWAP 0.55.
  // Taking only the first print would give 0.40 and a markout of -10c.
  const prints = [
    trade({ price: 0.4, size: 1, timestamp: 106 }),
    trade({ price: 0.6, size: 3, timestamp: 108 }),
  ];
  const [r] = computeMarkout(fills, prints, { taus: [10] });
  assert.ok(r);
  assert.ok(Math.abs(r.mine.meanCents - 5) < 1e-9, `got ${r.mine.meanCents}`);
});

test("baseline excludes the address under test", () => {
  const me = "0xme";
  const fills = [trade({ proxyWallet: me, side: "BUY", price: 0.6, timestamp: 100 })];
  const prints = [
    trade({ proxyWallet: me, side: "BUY", price: 0.6, timestamp: 100 }),
    trade({ proxyWallet: "0xrival", side: "BUY", price: 0.5, timestamp: 100 }),
    trade({ price: 0.5, timestamp: 110 }),
  ];
  const [r] = computeMarkout(fills, prints, { taus: [10], excludeAddress: me });
  assert.ok(r);
  assert.ok(r.baseline);
  // Rival bought at 0.50 and the reference is 0.50 -> flat; the 110 print prices itself
  // at tau=10 only if a later print exists, which it does not, so n=1.
  assert.equal(r.baseline.n, 1);
  assert.ok(Math.abs(r.baseline.meanCents - 0) < 1e-9, `got ${r.baseline.meanCents}`);
  assert.ok(Math.abs((r.excessCents ?? 0) - -10) < 1e-9, `got ${r.excessCents}`);
});

test("coverage reports fills that had no reference price", () => {
  const fills = [
    trade({ proxyWallet: "0xme", timestamp: 100 }),
    trade({ proxyWallet: "0xme", timestamp: 9_000 }), // nothing follows it
  ];
  const prints = [trade({ price: 0.5, timestamp: 110 })];
  const [r] = computeMarkout(fills, prints, { taus: [10] });
  assert.ok(r);
  assert.equal(r.mine.n, 1);
  assert.equal(r.coverage, 0.5);
});

test("a token with no prints at all yields zero coverage rather than throwing", () => {
  const fills = [trade({ proxyWallet: "0xme", asset: "999", timestamp: 100 })];
  const prints = [trade({ price: 0.5, timestamp: 110 })];
  const [r] = computeMarkout(fills, prints, { taus: [10] });
  assert.ok(r);
  assert.equal(r.mine.n, 0);
  assert.equal(r.coverage, 0);
  assert.equal(r.excessCents, null);
});

test("tokens are kept separate — a YES print never prices a NO fill", () => {
  const fills = [trade({ proxyWallet: "0xme", asset: "YES", price: 0.6, timestamp: 100 })];
  const prints = [
    trade({ asset: "NO", price: 0.1, timestamp: 110 }),
    trade({ asset: "YES", price: 0.7, timestamp: 110 }),
  ];
  const [r] = computeMarkout(fills, prints, { taus: [10] });
  assert.ok(r);
  assert.ok(Math.abs(r.mine.meanCents - 10) < 1e-9, `got ${r.mine.meanCents}`);
});
