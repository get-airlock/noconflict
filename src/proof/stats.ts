import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NC_DIR = ".nc";
const STATS_FILE = join(NC_DIR, "stats.json");

export interface PushRecord {
  timestamp: string;
  severity: "green" | "yellow" | "red";
  filesAutoMerged: number;
  conflictsAvoided: number;
  estimatedMinutesSaved: number;
}

export interface Stats {
  pushes: PushRecord[];
  totalPushes: number;
  totalSilentMerges: number;
  totalConflictsAvoided: number;
  totalMinutesSaved: number;
}

function ensureDir(): void {
  if (!existsSync(NC_DIR)) mkdirSync(NC_DIR, { recursive: true });
}

export function loadStats(): Stats {
  ensureDir();

  if (!existsSync(STATS_FILE)) {
    return {
      pushes: [],
      totalPushes: 0,
      totalSilentMerges: 0,
      totalConflictsAvoided: 0,
      totalMinutesSaved: 0,
    };
  }

  return JSON.parse(readFileSync(STATS_FILE, "utf-8"));
}

export function recordPush(record: PushRecord): Stats {
  const stats = loadStats();

  stats.pushes.push(record);
  stats.totalPushes++;
  stats.totalSilentMerges += record.filesAutoMerged;
  stats.totalConflictsAvoided += record.conflictsAvoided;
  stats.totalMinutesSaved += record.estimatedMinutesSaved;

  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  return stats;
}

export function weeklyStats(): {
  pushes: number;
  silentMerges: number;
  conflictsAvoided: number;
  minutesSaved: number;
  biggestSave: PushRecord | null;
} {
  const stats = loadStats();
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const thisWeek = stats.pushes.filter(
    (p) => new Date(p.timestamp).getTime() > oneWeekAgo
  );

  const biggestSave = thisWeek.reduce<PushRecord | null>((best, p) => {
    if (!best || p.estimatedMinutesSaved > best.estimatedMinutesSaved)
      return p;
    return best;
  }, null);

  return {
    pushes: thisWeek.length,
    silentMerges: thisWeek.reduce((s, p) => s + p.filesAutoMerged, 0),
    conflictsAvoided: thisWeek.reduce((s, p) => s + p.conflictsAvoided, 0),
    minutesSaved: thisWeek.reduce((s, p) => s + p.estimatedMinutesSaved, 0),
    biggestSave,
  };
}
