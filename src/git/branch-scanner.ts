import simpleGit, { type SimpleGit } from "simple-git";

export interface BranchInfo {
  name: string;
  current: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
  lastCommitDate: string;
  lastCommitAuthor: string;
  lastCommitMessage: string;
}

export interface OverlapZone {
  file: string;
  branchA: string;
  branchB: string;
  linesA: number;
  linesB: number;
  authorA: string;
  authorB: string;
  lastModifiedA: string;
  lastModifiedB: string;
}

export async function getGit(cwd?: string): Promise<SimpleGit> {
  const git = simpleGit(cwd);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) throw new Error("not a git repo. run nc init inside one.");
  return git;
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const status = await git.status();
  return status.current ?? "HEAD";
}

export async function getBranches(git: SimpleGit): Promise<BranchInfo[]> {
  const summary = await git.branch(["-a", "--sort=-committerdate"]);
  const branches: BranchInfo[] = [];

  for (const [name, data] of Object.entries(summary.branches)) {
    if (name.includes("HEAD")) continue;

    branches.push({
      name: data.name,
      current: data.current,
      tracking: name.startsWith("remotes/") ? name : null,
      ahead: 0,
      behind: 0,
      lastCommitDate: "",
      lastCommitAuthor: "",
      lastCommitMessage: data.label,
    });
  }

  return branches;
}

export async function findOverlaps(
  git: SimpleGit,
  branchA: string,
  branchB: string
): Promise<OverlapZone[]> {
  const overlaps: OverlapZone[] = [];

  try {
    const mergeBase = await git.raw(["merge-base", branchA, branchB]);
    const base = mergeBase.trim();

    const diffA = await git.raw(["diff", "--name-only", base, branchA]);
    const diffB = await git.raw(["diff", "--name-only", base, branchB]);

    const filesA = new Set(diffA.trim().split("\n").filter(Boolean));
    const filesB = new Set(diffB.trim().split("\n").filter(Boolean));

    const shared = [...filesA].filter((f) => filesB.has(f));

    for (const file of shared) {
      let statA = { lines: 0, author: "", date: "" };
      let statB = { lines: 0, author: "", date: "" };

      try {
        const diffStatA = await git.raw([
          "diff",
          "--numstat",
          base,
          branchA,
          "--",
          file,
        ]);
        const [added, removed] = (diffStatA.trim().split("\t") ?? [
          "0",
          "0",
        ]) as [string, string];
        statA.lines = parseInt(added) + parseInt(removed);

        const logA = await git.raw([
          "log",
          "-1",
          "--format=%an|%aI",
          branchA,
          "--",
          file,
        ]);
        const [authorA, dateA] = logA.trim().split("|");
        statA.author = authorA ?? "unknown";
        statA.date = dateA ?? "";
      } catch {
        /* file may not exist on branch */
      }

      try {
        const diffStatB = await git.raw([
          "diff",
          "--numstat",
          base,
          branchB,
          "--",
          file,
        ]);
        const [added, removed] = (diffStatB.trim().split("\t") ?? [
          "0",
          "0",
        ]) as [string, string];
        statB.lines = parseInt(added) + parseInt(removed);

        const logB = await git.raw([
          "log",
          "-1",
          "--format=%an|%aI",
          branchB,
          "--",
          file,
        ]);
        const [authorB, dateB] = logB.trim().split("|");
        statB.author = authorB ?? "unknown";
        statB.date = dateB ?? "";
      } catch {
        /* file may not exist on branch */
      }

      overlaps.push({
        file,
        branchA,
        branchB,
        linesA: statA.lines,
        linesB: statB.lines,
        authorA: statA.author,
        authorB: statB.author,
        lastModifiedA: statA.date,
        lastModifiedB: statB.date,
      });
    }
  } catch {
    // branches may not share a merge base
  }

  return overlaps;
}
