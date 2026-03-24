import { createInterface } from "node:readline";
import ora from "ora";
import { scanReadiness } from "../ship/readiness-scanner.js";
import { deploy, classifyShip } from "../ship/deployer.js";
import { getGit } from "../git/branch-scanner.js";
import { brand, receipt, warn, danger, dim, line, printBanner } from "../ui/brand.js";

async function confirm(question: string): Promise<boolean> {
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

export async function ship(options: { force?: boolean }): Promise<void> {
  const cwd = process.cwd();

  console.log("");
  printBanner(true);
  console.log("");

  // Readiness gate (unless --force)
  let readinessScore = 100;
  if (!options.force) {
    const spinner = ora({
      text: "scanning readiness...",
      color: "gray",
    }).start();

    const report = await scanReadiness(cwd);
    readinessScore = report.overall;
    spinner.stop();

    console.log(
      `  ${brand.BONE("readiness:")} ${readinessScore >= 80 ? brand.ACID(`${readinessScore}%`) : readinessScore >= 50 ? brand.WARN(`${readinessScore}%`) : brand.SKULL(`${readinessScore}%`)}`
    );
    console.log("");

    if (readinessScore < 50) {
      danger(`readiness ${readinessScore}% — below deploy threshold.`);
      dim("run nc check → nc fix, or use --force to override.");
      console.log("");
      return;
    }

    if (readinessScore < 80) {
      warn(`readiness ${readinessScore}% — proceed with caution.`);

      // Show criticals
      const criticals = report.scores.flatMap((s) =>
        s.findings.filter((f) => f.severity === "critical")
      );
      for (const f of criticals) {
        console.log(brand.SKULL(`  ✖ ${f.message}`));
      }
      console.log("");

      const proceed = await confirm(
        brand.WARN("  deploy anyway? (y/n) ")
      );
      if (!proceed) {
        dim("deploy cancelled.");
        console.log("");
        return;
      }
      console.log("");
    }
  }

  // Deploy
  const spinner = ora({
    text: "deploying...",
    color: "green",
  }).start();

  try {
    const record = await deploy(cwd, !!options.force);
    spinner.stop();

    console.log(brand.SHADOW("  ── DEPLOY RECEIPT ──"));
    console.log("");

    const shortSha = record.commitSha.slice(0, 7);
    receipt(`deployed.`);
    console.log(
      `  ${brand.BONE("url:".padEnd(12))} ${brand.ACID(record.deployUrl ?? "not captured")}`
    );
    console.log(
      `  ${brand.BONE("commit:".padEnd(12))} ${brand.SHADOW(shortSha)}`
    );
    console.log(
      `  ${brand.BONE("platform:".padEnd(12))} ${brand.SHADOW(record.platform)}`
    );

    // Classify ship zone
    const git = await getGit(cwd);
    const diffStat = await git.diffSummary(["HEAD~1"]);
    const filesChanged = diffStat.changed;
    const classification = classifyShip(readinessScore, filesChanged);

    const zoneColor =
      classification.zone === "green"
        ? brand.ACID
        : classification.zone === "yellow"
          ? brand.WARN
          : brand.SKULL;

    console.log(
      `  ${brand.BONE("zone:".padEnd(12))} ${zoneColor(classification.zone.toUpperCase())}`
    );

    if (classification.autoRollback) {
      dim("auto-rollback enabled for this deploy.");
    }

    console.log("");
  } catch (err: unknown) {
    spinner.stop();
    const message =
      err instanceof Error ? err.message : "deploy failed";
    danger(message);
    console.log("");
  }
}
