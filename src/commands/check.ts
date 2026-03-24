import ora from "ora";
import { scanReadiness } from "../ship/readiness-scanner.js";
import { brand, receipt, warn, danger, dim, line, printBanner } from "../ui/brand.js";
import type { ReadinessScore } from "../ship/types.js";

function renderBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  if (pct >= 80) return brand.ACID(bar);
  if (pct >= 50) return brand.WARN(bar);
  return brand.SKULL(bar);
}

function renderPct(pct: number, bold = false): string {
  const str = `${pct}%`;
  if (pct >= 80) return bold ? brand.ACID.bold(str) : brand.ACID(str);
  if (pct >= 50) return bold ? brand.WARN.bold(str) : brand.WARN(str);
  return bold ? brand.SKULL.bold(str) : brand.SKULL(str);
}

export async function check(): Promise<void> {
  const spinner = ora({
    text: "scanning readiness...",
    color: "gray",
  }).start();

  const report = await scanReadiness(process.cwd());

  spinner.stop();

  console.log("");
  printBanner(true);
  console.log("");
  console.log(brand.SHADOW("  ── READINESS SCAN ──"));
  console.log("");

  for (const s of report.scores) {
    const label = s.category.padEnd(14);
    console.log(`  ${brand.BONE(label)}  ${renderBar(s.score)}  ${renderPct(s.score)}`);
  }

  line();

  console.log(
    `  ${brand.BONE.bold("overall".padEnd(14))}  ${renderBar(report.overall)}  ${renderPct(report.overall, true)}`
  );
  console.log("");

  const { totalIssues, autoFixable } = report;

  if (totalIssues === 0) {
    receipt("clean. ready to ship.");
  } else if (report.overall >= 80) {
    receipt(`${totalIssues} issues found. ${autoFixable} auto-fixable. ship-ready.`);
  } else if (report.overall >= 50) {
    warn(`${totalIssues} issues found. ${autoFixable} auto-fixable.`);
  } else {
    danger(`${totalIssues} issues found. ${autoFixable} auto-fixable.`);
  }

  if (autoFixable > 0) {
    dim("run nc fix to resolve.");
  }

  // List critical findings
  const criticals = report.scores.flatMap((s) =>
    s.findings.filter((f) => f.severity === "critical")
  );
  if (criticals.length > 0) {
    console.log("");
    for (const f of criticals) {
      console.log(brand.SKULL(`  ✖ ${f.message}`));
    }
  }

  // List warnings
  const warnings = report.scores.flatMap((s) =>
    s.findings.filter((f) => f.severity === "warning")
  );
  if (warnings.length > 0) {
    console.log("");
    for (const f of warnings) {
      console.log(brand.WARN(`  ⚠ ${f.message}`));
    }
  }

  console.log("");
}
