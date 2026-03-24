import { createInterface } from "node:readline";
import ora from "ora";
import { getLastDeploy } from "../ship/deployer.js";
import { getLastHealthyDeploy, rollbackToDeploy } from "../watch/rollback.js";
import { brand, receipt, danger, dim, printBanner } from "../ui/brand.js";

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith("y"));
    });
  });
}

export async function rollback(): Promise<void> {
  const cwd = process.cwd();

  console.log("");
  printBanner(true);
  console.log("");

  const current = getLastDeploy(cwd);

  if (!current) {
    dim("no deploys found. nothing to roll back.");
    console.log("");
    return;
  }

  const target = getLastHealthyDeploy(cwd);

  if (!target) {
    danger("no previous healthy deploy to roll back to.");
    console.log("");
    return;
  }

  // Show current vs target
  console.log(brand.SHADOW("  ── ROLLBACK PLAN ──"));
  console.log("");
  console.log(
    `  ${brand.BONE("current:".padEnd(12))} ${brand.SKULL(current.commitSha.slice(0, 7))} ${brand.SHADOW(`(${current.status})`)}`
  );
  console.log(
    `  ${brand.BONE("target:".padEnd(12))} ${brand.ACID(target.commitSha.slice(0, 7))} ${brand.SHADOW(`(${new Date(target.timestamp).toLocaleString()})`)}`
  );
  console.log("");

  const proceed = await confirm(brand.WARN("  roll back? (y/n) "));
  if (!proceed) {
    dim("rollback cancelled.");
    console.log("");
    return;
  }

  console.log("");

  const spinner = ora({
    text: "rolling back...",
    color: "red",
  }).start();

  try {
    rollbackToDeploy(cwd, target);
    spinner.stop();

    receipt(`rolled back to ${target.commitSha.slice(0, 7)}.`);
    console.log("");
  } catch (err: unknown) {
    spinner.stop();
    const message = err instanceof Error ? err.message : "rollback failed";
    danger(message);
    console.log("");
  }
}
