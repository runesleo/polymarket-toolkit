import test from "node:test";
import assert from "node:assert/strict";
import { rankMarketsForScan } from "../src/scanner.ts";

test("rankMarketsForScan sorts by volume24hr desc and filters closed", () => {
  const ranked = rankMarketsForScan(
    [
      { slug: "a", question: "A", volume24hr: 100, closed: false, active: true },
      { slug: "b", question: "B", volume24hr: 5000, closed: false, active: true, spread: 0.02 },
      { slug: "c", question: "C", volume24hr: 99999, closed: true, active: true },
    ],
    { limit: 5, minVolume24hr: 0 },
  );
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].slug, "b");
  assert.equal(ranked[1].slug, "a");
});

test("rankMarketsForScan applies minVolume24hr", () => {
  const ranked = rankMarketsForScan(
    [{ slug: "low", question: "L", volume24hr: 50, active: true, closed: false }],
    { minVolume24hr: 100 },
  );
  assert.equal(ranked.length, 0);
});

test("scan rows carry the market's own tick and the spread in ticks", () => {
  // Tick is per-market, not a platform constant: measured 2026-08-18 over the
  // top 100 markets by 24h volume, 67 were 0.001 and 33 were 0.01. A raw
  // spread is not comparable across the two.
  const rows = rankMarketsForScan(
    [
      {
        slug: "fine-tick",
        question: "q1",
        volume24hr: 5000,
        spread: 0.001,
        orderPriceMinTickSize: 0.001,
      },
      {
        slug: "coarse-tick",
        question: "q2",
        volume24hr: 4000,
        spread: 0.01,
        orderPriceMinTickSize: 0.01,
      },
    ],
    { minVolume24hr: 0, limit: 10 },
  );

  const fine = rows.find((r) => r.slug === "fine-tick");
  const coarse = rows.find((r) => r.slug === "coarse-tick");
  assert.equal(fine?.tickSize, 0.001);
  assert.equal(coarse?.tickSize, 0.01);
  // Both books are at their floor even though one spread is 10x the other.
  assert.equal(fine?.spreadTicks, 1);
  assert.equal(coarse?.spreadTicks, 1);
});

test("a market without a tick field reports null rather than guessing one", () => {
  const [row] = rankMarketsForScan(
    [{ slug: "no-tick", question: "q", volume24hr: 5000, spread: 0.02 }],
    { minVolume24hr: 0, limit: 1 },
  );
  assert.equal(row?.tickSize, null);
  assert.equal(row?.spreadTicks, null);
});
