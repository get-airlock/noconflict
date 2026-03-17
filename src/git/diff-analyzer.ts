import type { SimpleGit } from "simple-git";

export interface DiffHunk {
  file: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface ConflictCheck {
  hasConflict: boolean;
  files: string[];
  hunks: DiffHunk[];
}

export async function getDiffAgainstRemote(
  git: SimpleGit,
  branch: string
): Promise<DiffHunk[]> {
  const hunks: DiffHunk[] = [];

  try {
    const remote = `origin/${branch}`;
    const diff = await git.diff([remote, "--numstat"]);

    for (const line of diff.trim().split("\n").filter(Boolean)) {
      const [added, removed, file] = line.split("\t");
      if (!file) continue;

      let patch = "";
      try {
        patch = await git.diff([remote, "--", file]);
      } catch {
        // file may be new
      }

      hunks.push({
        file,
        additions: parseInt(added ?? "0"),
        deletions: parseInt(removed ?? "0"),
        patch,
      });
    }
  } catch {
    // no remote tracking branch — first push
  }

  return hunks;
}

export async function checkForConflicts(
  git: SimpleGit,
  targetBranch: string
): Promise<ConflictCheck> {
  const currentBranch = (await git.status()).current ?? "HEAD";

  try {
    // dry-run merge to detect conflicts without modifying the tree
    await git.raw(["merge-tree", "--write-tree", currentBranch, targetBranch]);
    return { hasConflict: false, files: [], hunks: [] };
  } catch (err: unknown) {
    // merge-tree exits non-zero when there are conflicts
    const output = err instanceof Error ? err.message : String(err);
    const conflictFiles = output
      .split("\n")
      .filter((l) => l.includes("CONFLICT"))
      .map((l) => {
        const match = l.match(/CONFLICT.*?: (.+)/);
        return match?.[1]?.trim() ?? "";
      })
      .filter(Boolean);

    const hunks: DiffHunk[] = [];
    for (const file of conflictFiles) {
      try {
        const patch = await git.diff([targetBranch, "--", file]);
        const stat = await git.diff([targetBranch, "--numstat", "--", file]);
        const [added, removed] = (stat.trim().split("\t") ?? [
          "0",
          "0",
        ]) as [string, string];
        hunks.push({
          file,
          additions: parseInt(added),
          deletions: parseInt(removed),
          patch,
        });
      } catch {
        hunks.push({ file, additions: 0, deletions: 0, patch: "" });
      }
    }

    return { hasConflict: conflictFiles.length > 0, files: conflictFiles, hunks };
  }
}

export async function getStagedDiff(git: SimpleGit): Promise<string> {
  return git.diff(["--cached"]);
}

export async function getFullDiff(git: SimpleGit): Promise<string> {
  return git.diff();
}
