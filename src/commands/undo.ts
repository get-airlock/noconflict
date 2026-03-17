import chalk from "chalk";
import { getGit } from "../git/branch-scanner.js";

export async function undo(): Promise<void> {
  const git = await getGit();

  // check reflog for last action
  try {
    const reflog = await git.raw(["reflog", "-5", "--format=%H %gs"]);
    const entries = reflog.trim().split("\n").filter(Boolean);

    if (entries.length === 0) {
      console.log(chalk.dim("  nothing to undo."));
      return;
    }

    const last = entries[0];
    const [hash, ...descParts] = last?.split(" ") ?? [];
    const desc = descParts.join(" ");

    console.log("");
    console.log(chalk.white(`  last action: ${desc}`));
    console.log(chalk.dim(`  reverting to ${hash?.slice(0, 8)}...`));

    await git.reset(["--soft", "HEAD~1"]);

    console.log(chalk.green("  ✓ undone. changes are staged."));
    console.log(chalk.dim("  git status to see what's there."));
    console.log("");
  } catch (err) {
    console.log(
      chalk.red(`  undo failed: ${err instanceof Error ? err.message : err}`)
    );
  }
}
