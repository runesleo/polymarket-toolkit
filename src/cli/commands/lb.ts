import { fetchDataLeaderboardPnL } from "../../index.ts";
import {
  diffLeaderboardSnapshots,
  loadSnapshot,
  saveSnapshot,
  todayUtcDate,
  type LeaderboardRow,
} from "../../leaderboard.ts";
import { printJson } from "../util.ts";
import { join } from "node:path";

const SNAPSHOT_DIR = join(process.cwd(), ".pm-toolkit", "lb-snapshots");

const CATEGORIES = ["overall", "politics", "crypto", "sports", "weather", "finance", "tech", "culture"];

export async function runLb(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const save = argv.includes("--save");
  const diff = argv.includes("--diff");

  const catIdx = argv.indexOf("--category");
  const category = catIdx >= 0 ? (argv[catIdx + 1] ?? "overall") : "overall";
  const periodIdx = argv.indexOf("--period");
  const timePeriod = periodIdx >= 0 ? (argv[periodIdx + 1] ?? "day") : "day";
  const topIdx = argv.indexOf("--top");
  const top = topIdx >= 0 ? Number(argv[topIdx + 1] ?? 10) : 10;

  if (!CATEGORIES.includes(category)) {
    throw new Error(`Unknown category ${category}. Try: ${CATEGORIES.join(", ")}`);
  }

  const today = todayUtcDate();
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  if (diff) {
    const curr =
      loadSnapshot(SNAPSHOT_DIR, category, timePeriod, today) ??
      (await fetchAndBuild(category, timePeriod, top, today));
    const prev = loadSnapshot(SNAPSHOT_DIR, category, timePeriod, yesterday);
    if (!prev) {
      throw new Error(`No snapshot for ${yesterday}. Run: pm lb --category ${category} --save`);
    }
    const delta = diffLeaderboardSnapshots(prev, curr);
    if (json) {
      printJson({ today: curr.date, yesterday: prev.date, category, timePeriod, ...delta });
      return;
    }
    console.log(`LB diff · ${category} · ${timePeriod} · ${prev.date} → ${curr.date}\n`);
    console.log(`New faces (${delta.newFaces.length}):`);
    for (const r of delta.newFaces.slice(0, 10)) {
      console.log(`  + #${r.rank} ${r.userName} ${r.proxyWallet?.slice(0, 10)} pnl=${r.pnl}`);
    }
    console.log(`\nRank movers (top ${Math.min(10, delta.rankChanges.length)}):`);
    for (const m of delta.rankChanges.slice(0, 10)) {
      console.log(`  ${m.userName}: ${m.from} → ${m.to} (pnl=${m.pnl})`);
    }
    return;
  }

  const snapshot = await fetchAndBuild(category, timePeriod, top, today);
  if (save) {
    const path = saveSnapshot(SNAPSHOT_DIR, snapshot);
    console.error(`Saved ${path}`);
  }

  if (json) {
    printJson(snapshot);
    return;
  }

  console.log(`Leaderboard · ${category} · ${timePeriod} · top ${top}\n`);
  for (const r of snapshot.rows) {
    console.log(`  #${r.rank} ${r.userName ?? "?"} · pnl=${r.pnl} · ${r.proxyWallet?.slice(0, 12)}…`);
  }
  console.log(`\nTip: pm lb --category ${category} --save · pm lb --diff --category ${category}`);
}

async function fetchAndBuild(category: string, timePeriod: string, top: number, date: string) {
  const rows = (await fetchDataLeaderboardPnL({
    limit: top,
    offset: 0,
    timePeriod,
    category,
    orderBy: "PNL",
  })) as LeaderboardRow[];
  return { date, category, timePeriod, rows };
}
