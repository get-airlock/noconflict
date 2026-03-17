import type { OverlapZone } from "../git/branch-scanner.js";
import type { ConflictCheck, DiffHunk } from "../git/diff-analyzer.js";

export type Severity = "green" | "yellow" | "red";

export interface SeverityResult {
  level: Severity;
  reason: string;
  files: string[];
  estimatedMinutes: number;
}

const TRIVIAL_PATTERNS = [
  /^import\s/,
  /^export\s/,
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*/,
  /^\s*$/,
  /^\s*\}\s*$/,
  /^\s*\{\s*$/,
];

function isTrivialChange(patch: string): boolean {
  const changedLines = patch
    .split("\n")
    .filter((l) => l.startsWith("+") || l.startsWith("-"))
    .filter((l) => !l.startsWith("+++") && !l.startsWith("---"))
    .map((l) => l.slice(1).trim());

  if (changedLines.length === 0) return true;

  return changedLines.every((line) =>
    TRIVIAL_PATTERNS.some((pattern) => pattern.test(line))
  );
}

function estimateMinutes(hunks: DiffHunk[]): number {
  const totalLines = hunks.reduce((sum, h) => sum + h.additions + h.deletions, 0);

  // rough heuristic: 1 min per 5 conflicting lines + 10 min base for context switching
  if (totalLines === 0) return 0;
  return Math.ceil(totalLines / 5) + 10;
}

export function classifySeverity(
  conflicts: ConflictCheck,
  overlaps: OverlapZone[]
): SeverityResult {
  // no conflicts at all
  if (!conflicts.hasConflict && overlaps.length === 0) {
    return {
      level: "green",
      reason: "clean push",
      files: [],
      estimatedMinutes: 0,
    };
  }

  // conflicts exist — check if trivial
  if (conflicts.hasConflict) {
    const allTrivial = conflicts.hunks.every((h) => isTrivialChange(h.patch));

    if (allTrivial) {
      return {
        level: "green",
        reason: "trivial conflicts (imports, whitespace)",
        files: conflicts.files,
        estimatedMinutes: 0,
      };
    }

    const minutes = estimateMinutes(conflicts.hunks);
    const largeConflict = conflicts.hunks.some(
      (h) => h.additions + h.deletions > 50
    );

    if (largeConflict || minutes > 30) {
      return {
        level: "red",
        reason: "significant code at risk",
        files: conflicts.files,
        estimatedMinutes: minutes,
      };
    }

    return {
      level: "yellow",
      reason: "semantic differences detected",
      files: conflicts.files,
      estimatedMinutes: minutes,
    };
  }

  // overlaps without direct conflicts — warn but don't block
  if (overlaps.length > 0) {
    const totalOverlapLines = overlaps.reduce(
      (sum, o) => sum + o.linesA + o.linesB,
      0
    );

    if (totalOverlapLines > 100) {
      return {
        level: "yellow",
        reason: `${overlaps.length} shared files with other branches`,
        files: overlaps.map((o) => o.file),
        estimatedMinutes: Math.ceil(totalOverlapLines / 10),
      };
    }

    return {
      level: "green",
      reason: "minor overlap, safe to push",
      files: overlaps.map((o) => o.file),
      estimatedMinutes: 0,
    };
  }

  return {
    level: "green",
    reason: "clean",
    files: [],
    estimatedMinutes: 0,
  };
}
