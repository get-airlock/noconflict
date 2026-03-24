import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadinessFinding } from "../types.js";

export function scanDeployment(cwd: string): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];
  const pkgPath = join(cwd, "package.json");

  if (existsSync(pkgPath)) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    } catch {
      findings.push({
        category: "deployment",
        severity: "critical",
        message: "Malformed package.json — cannot parse",
        file: "package.json",
        line: null,
        autoFixable: false,
        fixDescription: null,
      });
      return findings;
    }

    const scripts = (pkg.scripts ?? {}) as Record<string, string>;

    if (!scripts.build) {
      findings.push({
        category: "deployment",
        severity: "warning",
        message: "No build script in package.json",
        file: "package.json",
        line: null,
        autoFixable: false,
        fixDescription: null,
      });
    }

    if (!scripts.start) {
      findings.push({
        category: "deployment",
        severity: "info",
        message: "No start command in package.json",
        file: "package.json",
        line: null,
        autoFixable: false,
        fixDescription: null,
      });
    }
  }

  const envExists = existsSync(join(cwd, ".env"));
  const envExampleExists = existsSync(join(cwd, ".env.example"));

  if (envExists && !envExampleExists) {
    findings.push({
      category: "deployment",
      severity: "warning",
      message: "Has .env but no .env.example for team onboarding",
      file: null,
      line: null,
      autoFixable: true,
      fixDescription: "Create .env.example with placeholder values",
    });
  }

  return findings;
}
