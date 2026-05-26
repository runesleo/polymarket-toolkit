import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type LeaderboardRow = {
  rank?: string | number;
  userName?: string;
  proxyWallet?: string;
  pnl?: number | string;
  vol?: number | string;
};

export type LeaderboardSnapshot = {
  date: string;
  category: string;
  timePeriod: string;
  rows: LeaderboardRow[];
};

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function snapshotPath(baseDir: string, category: string, timePeriod: string, date: string): string {
  return join(baseDir, `${date}_${category}_${timePeriod}.json`);
}

export function saveSnapshot(baseDir: string, snapshot: LeaderboardSnapshot): string {
  mkdirSync(baseDir, { recursive: true });
  const path = snapshotPath(baseDir, snapshot.category, snapshot.timePeriod, snapshot.date);
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  return path;
}

export function loadSnapshot(baseDir: string, category: string, timePeriod: string, date: string): LeaderboardSnapshot | null {
  const path = snapshotPath(baseDir, category, timePeriod, date);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as LeaderboardSnapshot;
}

export function diffLeaderboardSnapshots(
  previous: LeaderboardSnapshot,
  current: LeaderboardSnapshot,
): {
  newFaces: LeaderboardRow[];
  dropped: LeaderboardRow[];
  rankChanges: Array<{ userName: string; proxyWallet: string; from: number; to: number; pnl: number | null }>;
} {
  const key = (r: LeaderboardRow) => (r.proxyWallet ?? r.userName ?? "").toLowerCase();
  const prevMap = new Map(previous.rows.map((r, i) => [key(r), { row: r, rank: i + 1 }]));
  const currMap = new Map(current.rows.map((r, i) => [key(r), { row: r, rank: i + 1 }]));

  const newFaces: LeaderboardRow[] = [];
  const dropped: LeaderboardRow[] = [];
  const rankChanges: Array<{ userName: string; proxyWallet: string; from: number; to: number; pnl: number | null }> = [];

  for (const [k, { row, rank }] of currMap) {
    const prev = prevMap.get(k);
    if (!prev) {
      newFaces.push(row);
      continue;
    }
    if (prev.rank !== rank) {
      rankChanges.push({
        userName: row.userName ?? k.slice(0, 10),
        proxyWallet: row.proxyWallet ?? "",
        from: prev.rank,
        to: rank,
        pnl: row.pnl != null ? Number(row.pnl) : null,
      });
    }
  }

  for (const [k, { row }] of prevMap) {
    if (!currMap.has(k)) dropped.push(row);
  }

  rankChanges.sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to));
  return { newFaces, dropped, rankChanges };
}
