import test from "node:test";
import assert from "node:assert/strict";
import { diffLeaderboardSnapshots, type LeaderboardSnapshot } from "../src/leaderboard.ts";
import { suggestedDelaySeconds, loadRateLimitRegistry } from "../src/rate-limits.ts";

test("diffLeaderboardSnapshots finds new faces and rank changes", () => {
  const prev: LeaderboardSnapshot = {
    date: "2026-05-25",
    category: "overall",
    timePeriod: "day",
    rows: [
      { rank: 1, userName: "alice", proxyWallet: "0xaaa" },
      { rank: 2, userName: "bob", proxyWallet: "0xbbb" },
    ],
  };
  const curr: LeaderboardSnapshot = {
    date: "2026-05-26",
    category: "overall",
    timePeriod: "day",
    rows: [
      { rank: 1, userName: "bob", proxyWallet: "0xbbb", pnl: 100 },
      { rank: 2, userName: "carol", proxyWallet: "0xccc", pnl: 50 },
    ],
  };
  const d = diffLeaderboardSnapshots(prev, curr);
  assert.equal(d.newFaces.length, 1);
  assert.equal(d.newFaces[0].userName, "carol");
  assert.equal(d.dropped.length, 1);
  assert.equal(d.dropped[0].userName, "alice");
  assert.ok(d.rankChanges.some((x) => x.userName === "bob" && x.from === 2 && x.to === 1));
});

test("loadRateLimitRegistry and suggestedDelaySeconds", () => {
  const reg = loadRateLimitRegistry();
  assert.ok(reg.families.gamma);
  const delay = suggestedDelaySeconds("gamma", "general");
  assert.ok(delay > 0 && delay < 1);
});
