import chalk from "chalk";
import { isTrialActive, trialDaysLeft, hasApiKey } from "../config/store.js";
import { getGit, getCurrentBranch } from "../git/branch-scanner.js";
import { loadStats, weeklyStats } from "../proof/stats.js";
import { brand, printBanner, line, dim, receipt, warn, danger } from "../ui/brand.js";

export async function status(flags: { week?: boolean; trial?: boolean }): Promise<void> {
  if (!hasApiKey()) {
    danger("not armed. run nc init.");
    process.exit(1);
  }

  console.log("");

  if (flags.week) {
    return showWeekly();
  }

  if (flags.trial) {
    return showTrial();
  }

  // default: current state
  const git = await getGit();
  const branch = await getCurrentBranch(git);
  const gitStatus = await git.status();

  printBanner(true);
  console.log("");
  console.log(brand.BONE(`  branch: ${brand.BONE.bold(branch)}`));

  if (gitStatus.ahead > 0) {
    dim(`${gitStatus.ahead} commits loaded. ready to fire.`);
  }
  if (gitStatus.behind > 0) {
    warn(`${gitStatus.behind} commits behind remote. nc sync to reload.`);
  }
  if (gitStatus.files.length > 0) {
    dim(`${gitStatus.files.length} modified files.`);
  }

  if (!isTrialActive()) {
    console.log("");
    warn("trial's over. nc activate for $29/mo.");
  } else {
    const days = trialDaysLeft();
    if (days <= 7) {
      console.log("");
      dim(`trial: ${days} day${days === 1 ? "" : "s"} left.`);
    }
  }

  console.log("");
}

function showWeekly(): void {
  const stats = weeklyStats();

  printBanner(true);
  console.log(brand.SHADOW("  ── KILL COUNT (THIS WEEK) ──"));
  console.log("");
  console.log(brand.BONE(`  pushes:            ${stats.pushes}`));
  console.log(brand.BONE(`  silent merges:     ${stats.silentMerges}`));
  console.log(brand.ACID(`  conflicts killed:  ${stats.conflictsAvoided}`));
  console.log(
    brand.BONE(
      `  time reclaimed:    ~${stats.minutesSaved >= 60 ? `${(stats.minutesSaved / 60).toFixed(1)} hours` : `${stats.minutesSaved} min`}`
    )
  );

  if (stats.biggestSave) {
    const date = new Date(stats.biggestSave.timestamp).toLocaleDateString(
      "en-US",
      { weekday: "long" }
    );
    console.log("");
    dim(`biggest save: ${date}, ~${stats.biggestSave.estimatedMinutesSaved} min.`);
  }

  const daysLeft = trialDaysLeft();
  if (daysLeft > 0) {
    console.log("");
    dim(`trial ends in ${daysLeft} days.`);
  }

  console.log("");
}

function showTrial(): void {
  const stats = loadStats();

  printBanner(true);
  console.log(brand.SHADOW("  ── TRIAL DEBRIEF ──"));
  console.log("");
  console.log(brand.BONE(`  total pushes:        ${stats.totalPushes}`));
  console.log(brand.BONE(`  silent merges:       ${stats.totalSilentMerges}`));
  console.log(brand.ACID(`  conflicts killed:    ${stats.totalConflictsAvoided}`));
  console.log(
    brand.BONE(
      `  time reclaimed:      ~${stats.totalMinutesSaved >= 60 ? `${(stats.totalMinutesSaved / 60).toFixed(1)} hours` : `${stats.totalMinutesSaved} min`}`
    )
  );

  const daysLeft = trialDaysLeft();
  if (daysLeft > 0) {
    console.log("");
    dim(`${daysLeft} days left in trial.`);
  } else {
    console.log("");
    warn("trial's over.");
    console.log(brand.BONE("  want your weapon back? $29/mo → nc activate"));
  }

  console.log("");
}
