// Scenario: save + diff Data API leaderboard snapshots (F3 lite).
// Run: npx tsx examples/20-leaderboard-snapshot.ts [--save] [--diff]
// CLI: pm lb --category crypto --period day --save · pm lb --diff

import { fetchDataLeaderboardPnL } from "../src/index.ts";
import {
  diffLeaderboardSnapshots,
  loadSnapshot,
  saveSnapshot,
  todayUtcDate,
} from "../src/leaderboard.ts";
import { join } from "node:path";

const dir = join(process.cwd(), ".pm-toolkit", "lb-snapshots");
const category = "overall";
const timePeriod = "day";
const today = todayUtcDate();
const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

const rows = await fetchDataLeaderboardPnL({ limit: 10, category, timePeriod, orderBy: "PNL" });
const snapshot = { date: today, category, timePeriod, rows: rows as never[] };

if (process.argv.includes("--save")) {
  console.log("saved", saveSnapshot(dir, snapshot));
}

if (process.argv.includes("--diff")) {
  const prev = loadSnapshot(dir, category, timePeriod, yesterday);
  if (!prev) throw new Error("no yesterday snapshot — run with --save first on prior day");
  console.log(JSON.stringify(diffLeaderboardSnapshots(prev, snapshot), null, 2));
} else if (!process.argv.includes("--save")) {
  console.log(JSON.stringify(snapshot, null, 2));
}
