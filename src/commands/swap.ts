import chalk from "chalk";
import ora from "ora";
import { getGit, getCurrentBranch } from "../git/branch-scanner.js";
import {
  saveSnapshot,
  restoreSnapshot,
  hasSnapshot,
} from "../git/snapshot-manager.js";

export async function swap(targetBranch: string): Promise<void> {
  if (!targetBranch) {
    console.log(chalk.red("  usage: nc swap <branch>"));
    process.exit(1);
  }

  const git = await getGit();
  const currentBranch = await getCurrentBranch(git);

  if (currentBranch === targetBranch) {
    console.log(chalk.dim("  already on that branch."));
    return;
  }

  const spinner = ora({ text: chalk.dim("swapping..."), spinner: "dots" }).start();

  // save current state
  const snapshot = await saveSnapshot(git);

  // checkout target
  try {
    await git.checkout(targetBranch);
  } catch {
    // branch may not exist locally — try creating from remote
    try {
      await git.checkout(["-b", targetBranch, `origin/${targetBranch}`]);
    } catch {
      spinner.stop();
      console.log(chalk.red(`  branch '${targetBranch}' not found.`));
      // restore if we stashed
      if (snapshot?.stashRef) {
        try {
          await git.stash(["pop"]);
        } catch {
          /* */
        }
      }
      return;
    }
  }

  // restore target's snapshot if it exists
  const restored = await restoreSnapshot(git, targetBranch);

  spinner.stop();

  if (restored) {
    console.log(
      chalk.green(
        `  ✓ swapped to ${targetBranch}. restored ${restored.dirtyFiles.length} files.`
      )
    );
  } else {
    console.log(chalk.green(`  ✓ swapped to ${targetBranch}.`));
  }

  if (snapshot) {
    console.log(
      chalk.dim(
        `  ${currentBranch} state saved. nc swap ${currentBranch} to go back.`
      )
    );
  }
}
