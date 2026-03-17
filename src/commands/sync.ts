import chalk from "chalk";
import ora from "ora";
import { hasApiKey, isTrialActive } from "../config/store.js";
import { getGit, getCurrentBranch } from "../git/branch-scanner.js";

export async function sync(): Promise<void> {
  if (!hasApiKey() || !isTrialActive()) {
    console.log(chalk.dim("  trial ended. using regular git pull."));
    const git = await getGit();
    await git.pull(["--rebase"]);
    return;
  }

  const git = await getGit();
  const branch = await getCurrentBranch(git);
  const spinner = ora({ text: chalk.dim("syncing..."), spinner: "dots" }).start();

  try {
    await git.fetch();
    const status = await git.status();

    if (status.behind === 0) {
      spinner.stop();
      console.log(chalk.green("  ✓ already up to date."));
      return;
    }

    // attempt rebase
    try {
      await git.pull(["--rebase", "origin", branch]);
      spinner.stop();
      console.log(
        chalk.green(`  ✓ synced. pulled ${status.behind} commits.`)
      );
    } catch {
      spinner.stop();
      // rebase failed — abort and report
      try {
        await git.rebase(["--abort"]);
      } catch {
        // may not be in rebase state
      }
      console.log("");
      console.log(chalk.yellow("  rebase hit conflicts. use nc push to resolve."));
      console.log("");
    }
  } catch (err) {
    spinner.stop();
    console.log(
      chalk.red(`  sync failed: ${err instanceof Error ? err.message : err}`)
    );
  }
}
