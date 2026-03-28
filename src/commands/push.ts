import chalk from "chalk";
import ora from "ora";
import { createInterface } from "node:readline";
import { hasApiKey, isTrialActive, trialDaysLeft } from "../config/store.js";
import {
  getGit,
  getCurrentBranch,
  getBranches,
  findOverlaps,
} from "../git/branch-scanner.js";
import { checkForConflicts } from "../git/diff-analyzer.js";
import { classifySeverity } from "../router/severity.js";
import { analyzeConflict, chat } from "../engine/forge.js";
import { recordPush, weeklyStats } from "../proof/stats.js";
import { brand, printBanner, tag, receipt, warn, danger, dim, line } from "../ui/brand.js";

export async function push(args: string[] = []): Promise<void> {
  // gate check
  if (!hasApiKey()) {
    danger("not armed. run nc init first.");
    process.exit(1);
  }

  if (!isTrialActive()) {
    console.log("");
    dim("trial's over. nc push → git push now.");
    console.log(brand.BONE("  want your weapon back? $29/mo → nc upgrade"));
    console.log("");
    // fall through to regular git push
    const git = await getGit();
    await git.push();
    return;
  }

  const git = await getGit();
  const branch = await getCurrentBranch(git);
  const spinner = ora({ text: brand.SHADOW("  scanning for threats..."), spinner: "dots" }).start();

  // 1. check for conflicts against remote
  let targetBranch = "main";
  try {
    const tracking = await git.raw(["rev-parse", "--abbrev-ref", `${branch}@{upstream}`]);
    targetBranch = tracking.trim().replace(/^origin\//, "");
  } catch {
    // no tracking branch — pushing for first time
  }

  const conflicts = await checkForConflicts(git, `origin/${targetBranch}`).catch(
    () => ({ hasConflict: false, files: [] as string[], hunks: [] })
  );

  // 2. check for overlaps with other branches
  const branches = await getBranches(git);
  const otherBranches = branches
    .filter((b) => !b.current && !b.name.startsWith("remotes/"))
    .slice(0, 5); // limit to 5 for speed

  const allOverlaps = [];
  for (const other of otherBranches) {
    const overlaps = await findOverlaps(git, branch, other.name);
    allOverlaps.push(...overlaps);
  }

  // 3. classify severity
  const severity = classifySeverity(conflicts, allOverlaps);

  spinner.stop();

  // GREEN — push silently
  if (severity.level === "green") {
    const pushSpinner = ora({ text: brand.SHADOW("  deploying..."), spinner: "dots" }).start();

    try {
      await git.push(["-u", "origin", branch, ...args]);
      pushSpinner.stop();

      const filesAutoMerged = severity.files.length;
      if (filesAutoMerged > 0) {
        receipt(`pushed. ${filesAutoMerged} files auto-merged. no casualties.`);
      } else {
        receipt("pushed. clean kill.");
      }

      recordPush({
        timestamp: new Date().toISOString(),
        severity: "green",
        filesAutoMerged,
        conflictsAvoided: filesAutoMerged > 0 ? 1 : 0,
        estimatedMinutesSaved: severity.estimatedMinutes,
      });

      // weekly nudge (every 7th push or Friday)
      const stats = weeklyStats();
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 5 && stats.conflictsAvoided > 0) {
        dim(`this week: ${stats.conflictsAvoided} conflicts murdered, ~${(stats.minutesSaved / 60).toFixed(1)} hrs reclaimed.`);
      }

      // trial reminder in last 3 days
      const daysLeft = trialDaysLeft();
      if (daysLeft > 0 && daysLeft <= 3) {
        warn(`${daysLeft} day${daysLeft === 1 ? "" : "s"} left on trial.`);
      }
    } catch (err) {
      pushSpinner.stop();
      danger(`push failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    return;
  }

  // YELLOW or RED — engage conversation
  console.log("");
  console.log(tag(severity.level as "yellow" | "red"));
  line();

  // get recent commits on target for context
  let recentCommits = "";
  try {
    recentCommits = await git.raw([
      "log",
      `origin/${targetBranch}`,
      "-5",
      "--format=%an: %s (%ar)",
    ]);
  } catch {
    // no remote
  }

  const analysis = await analyzeConflict(severity, conflicts.hunks, {
    currentBranch: branch,
    targetBranch,
    recentCommits,
  });

  if (severity.level === "red") {
    console.log(brand.SKULL.bold("  STOP. INCOMING FIRE."));
  } else {
    console.log(brand.WARN("  heads up —"));
  }

  console.log("");
  console.log(brand.BONE(`  ${analysis.explanation}`));
  console.log("");

  if (analysis.estimatedHours > 0) {
    dim(
      `time at risk: ~${analysis.estimatedHours >= 1 ? `${analysis.estimatedHours.toFixed(1)} hours` : `${Math.ceil(analysis.estimatedHours * 60)} min`} of your life`
    );
    console.log("");
  }

  if (analysis.canAutoResolve) {
    dim(`i can handle this: ${analysis.resolution}`);
    console.log("");
  }

  // interactive prompt
  const chatHistory: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "assistant", content: analysis.explanation },
  ];

  const context = `Branch: ${branch} → ${targetBranch}\nSeverity: ${severity.level}\nFiles: ${severity.files.join(", ")}\nRecent commits:\n${recentCommits}\nConflict analysis: ${JSON.stringify(analysis)}`;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(brand.SKULL("  ▸ "), async (input) => {
      const trimmed = input.trim().toLowerCase();

      if (!trimmed || trimmed === "q" || trimmed === "quit" || trimmed === "exit") {
        dim("stood down. nothing pushed.");
        rl.close();
        return;
      }

      if (trimmed === "y" || trimmed === "yes" || trimmed === "push") {
        rl.close();
        const pushSpinner = ora({
          text: brand.SHADOW("  deploying..."),
          spinner: "dots",
        }).start();

        try {
          await git.push(["-u", "origin", branch, ...args]);
          pushSpinner.stop();
          receipt("pushed. conflict eliminated.");

          recordPush({
            timestamp: new Date().toISOString(),
            severity: severity.level,
            filesAutoMerged: 0,
            conflictsAvoided: 1,
            estimatedMinutesSaved: severity.estimatedMinutes,
          });
        } catch (err) {
          pushSpinner.stop();
          danger(`push failed: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }

      // anything else — chat with forge
      const chatSpinner = ora({
        text: brand.SHADOW("  analyzing..."),
        spinner: "dots",
      }).start();

      const response = await chat(trimmed, chatHistory, context);
      chatSpinner.stop();

      chatHistory.push({ role: "user", content: trimmed });
      chatHistory.push({ role: "assistant", content: response });

      console.log("");
      console.log(brand.BONE(`  ${response}`));
      console.log("");

      prompt();
    });
  };

  if (severity.level === "red") {
    dim("[y] push anyway  [n] stand down  or ask me anything");
  } else {
    dim("[y] push  [n] stand down  or ask me anything");
  }
  console.log("");
  prompt();
}
