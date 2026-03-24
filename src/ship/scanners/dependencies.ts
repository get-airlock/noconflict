import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadinessFinding } from "../types.js";

const LOCK_FILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
];

export function scanDependencies(cwd: string): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];
  const pkgPath = join(cwd, "package.json");

  if (!existsSync(pkgPath)) {
    return findings;
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    findings.push({
      category: "dependencies",
      severity: "critical",
      message: "Malformed package.json — cannot parse",
      file: "package.json",
      line: null,
      autoFixable: false,
      fixDescription: null,
    });
    return findings;
  }

  // Check lock file
  const hasLockFile = LOCK_FILES.some((f) => existsSync(join(cwd, f)));
  if (!hasLockFile) {
    findings.push({
      category: "dependencies",
      severity: "warning",
      message: "No lock file found (package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lockb)",
      file: null,
      line: null,
      autoFixable: false,
      fixDescription: null,
    });
  }

  // Check for wildcard / "latest" versions
  const allDeps: Record<string, string> = {
    ...((pkg.dependencies ?? {}) as Record<string, string>),
    ...((pkg.devDependencies ?? {}) as Record<string, string>),
  };

  for (const [name, version] of Object.entries(allDeps)) {
    if (version === "*" || version === "latest") {
      findings.push({
        category: "dependencies",
        severity: "warning",
        message: `Wildcard or "latest" version for ${name}: ${version}`,
        file: "package.json",
        line: null,
        autoFixable: false,
        fixDescription: null,
      });
    }
  }

  return findings;
}
