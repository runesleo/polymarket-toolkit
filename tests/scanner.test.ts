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
