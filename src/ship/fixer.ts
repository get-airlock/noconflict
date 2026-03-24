import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanReadiness } from "./readiness-scanner.js";
import type { ReadinessFinding } from "./types.js";

export interface FixResult {
  fixed: number;
  skipped: number;
  actions: string[];
}

const GITIGNORE_TEMPLATE = [
  "node_modules",
  ".env",
  ".env.local",
  ".env.*.local",
  "dist",
  "build",
  ".next",
  ".noconflict",
  ".nc",
  "*.log",
].join("\n") + "\n";

function fixMissingGitignore(cwd: string): string | null {
  const gitignorePath = join(cwd, ".gitignore");
  if (existsSync(gitignorePath)) return null;
  writeFileSync(gitignorePath, GITIGNORE_TEMPLATE, "utf-8");
  return "Created .gitignore with standard entries";
}

function fixEnvNotInGitignore(cwd: string): string | null {
  const gitignorePath = join(cwd, ".gitignore");
  if (!existsSync(gitignorePath)) return null;
  const content = readFileSync(gitignorePath, "utf-8");
  const lines = content.split("\n").map((l) => l.trim());
  if (lines.includes(".env") || lines.includes(".env*")) return null;
  const suffix = content.endsWith("\n") ? "" : "\n";
  writeFileSync(
    gitignorePath,
    content + suffix + ".env\n.env.local\n.env.*.local\n",
    "utf-8"
  );
  return "Added .env entries to .gitignore";
}

function fixMissingViewport(cwd: string, finding: ReadinessFinding): string | null {
  if (!finding.file) return null;
  const filePath = join(cwd, finding.file);
  if (!existsSync(filePath)) return null;
  let content = readFileSync(filePath, "utf-8");
  if (content.includes('name="viewport"')) return null;
  const headTag = "<head>";
  const headIdx = content.toLowerCase().indexOf(headTag);
  if (headIdx === -1) return null;
  const insertPos = headIdx + headTag.length;
  const meta = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  content = content.slice(0, insertPos) + meta + content.slice(insertPos);
  writeFileSync(filePath, content, "utf-8");
  return `Added viewport meta tag to ${finding.file}`;
}

function fixMissingEnvExample(cwd: string): string | null {
  const envPath = join(cwd, ".env");
  const examplePath = join(cwd, ".env.example");
  if (!existsSync(envPath) || existsSync(examplePath)) return null;
  const content = readFileSync(envPath, "utf-8");
  const stripped = content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return trimmed;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return trimmed;
      return trimmed.slice(0, eqIdx + 1);
    })
    .join("\n");
  writeFileSync(examplePath, stripped, "utf-8");
  return "Generated .env.example from .env (values stripped)";
}

export async function autoFix(cwd: string): Promise<FixResult> {
  const report = await scanReadiness(cwd);
  const allFindings = report.scores.flatMap((s) => s.findings);
  const fixable = allFindings.filter((f) => f.autoFixable);

  const actions: string[] = [];
  let skipped = 0;

  // Track which fix types we've applied to avoid duplicates
  const applied = new Set<string>();

  for (const finding of fixable) {
    const msg = finding.message.toLowerCase();
    let result: string | null = null;

    if (msg.includes(".env") && msg.includes(".gitignore") && msg.includes("without")) {
      // Missing .gitignore when .env exists
      if (!applied.has("missing-gitignore")) {
        result = fixMissingGitignore(cwd);
        if (result) applied.add("missing-gitignore");
      }
    } else if (msg.includes(".env") && msg.includes("not listed")) {
      // .env not in .gitignore
      if (!applied.has("env-in-gitignore")) {
        result = fixEnvNotInGitignore(cwd);
        if (result) applied.add("env-in-gitignore");
      }
    } else if (msg.includes("viewport")) {
      // Missing viewport meta tag
      result = fixMissingViewport(cwd, finding);
    } else if (msg.includes(".env.example") || msg.includes("env") && msg.includes("onboarding")) {
      // Missing .env.example
      if (!applied.has("env-example")) {
        result = fixMissingEnvExample(cwd);
        if (result) applied.add("env-example");
      }
    } else if (msg.includes("hardcoded") || msg.includes("secret")) {
      // Hardcoded API keys — do NOT auto-fix (too risky)
      skipped++;
      continue;
    } else {
      // Unknown fixable finding — skip
      skipped++;
      continue;
    }

    if (result) {
      actions.push(result);
    }
  }

  return {
    fixed: actions.length,
    skipped,
    actions,
  };
}
