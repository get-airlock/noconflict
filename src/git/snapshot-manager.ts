import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SimpleGit } from "simple-git";

const NC_DIR = ".nc";
const SNAPSHOTS_DIR = join(NC_DIR, "snapshots");

export interface Snapshot {
  branch: string;
  timestamp: string;
  stashRef: string | null;
  dirtyFiles: string[];
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function snapshotPath(branch: string): string {
  const safeName = branch.replace(/\//g, "__");
  return join(SNAPSHOTS_DIR, `${safeName}.json`);
}

export async function saveSnapshot(git: SimpleGit): Promise<Snapshot | null> {
  const status = await git.status();
  const branch = status.current ?? "HEAD";

  if (status.files.length === 0) return null;

  ensureDir(SNAPSHOTS_DIR);

  let stashRef: string | null = null;
  try {
    const result = await git.stash(["push", "-m", `nc-swap-${branch}-${Date.now()}`]);
    if (!result.includes("No local changes")) {
      stashRef = result.trim();
    }
  } catch {
    // nothing to stash
  }

  const snapshot: Snapshot = {
    branch,
    timestamp: new Date().toISOString(),
    stashRef,
    dirtyFiles: status.files.map((f) => f.path),
  };

  writeFileSync(snapshotPath(branch), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

export async function restoreSnapshot(
  git: SimpleGit,
  branch: string
): Promise<Snapshot | null> {
  const path = snapshotPath(branch);
  if (!existsSync(path)) return null;

  const snapshot: Snapshot = JSON.parse(readFileSync(path, "utf-8"));

  if (snapshot.stashRef) {
    try {
      await git.stash(["pop"]);
    } catch {
      // stash may have been manually cleared
    }
  }

  // clean up snapshot file after restore
  const { unlinkSync } = await import("node:fs");
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }

  return snapshot;
}

export function hasSnapshot(branch: string): boolean {
  return existsSync(snapshotPath(branch));
}
