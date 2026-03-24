import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { ReadinessFinding } from "../types.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".env",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
]);

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-proj-[A-Za-z0-9_-]{10,}/, label: "OpenAI project key" },
  { pattern: /sk-live-[A-Za-z0-9_-]{10,}/, label: "Stripe live key" },
  { pattern: /sk-test-[A-Za-z0-9_-]{10,}/, label: "Stripe test key" },
  { pattern: /AKIA[A-Z0-9]{16}/, label: "AWS access key" },
  { pattern: /ghp_[A-Za-z0-9]{36,}/, label: "GitHub personal token" },
  { pattern: /xoxb-[A-Za-z0-9-]+/, label: "Slack bot token" },
  {
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    label: "Private key",
  },
];

function walkSourceFiles(
  dir: string,
  depth: number,
  maxDepth: number
): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        results.push(...walkSourceFiles(full, depth + 1, maxDepth));
      }
    } else if (SOURCE_EXTENSIONS.has(extname(entry)) || entry === ".env") {
      results.push(full);
    }
  }
  return results;
}

export function scanSecurity(cwd: string): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];

  const envExists = existsSync(join(cwd, ".env"));
  const gitignoreExists = existsSync(join(cwd, ".gitignore"));

  if (envExists && !gitignoreExists) {
    findings.push({
      category: "security",
      severity: "critical",
      message: ".env file exists without .gitignore protection",
      file: ".env",
      line: null,
      autoFixable: true,
      fixDescription: "Create .gitignore with .env entry",
    });
  }

  if (envExists && gitignoreExists) {
    const gitignoreContent = readFileSync(join(cwd, ".gitignore"), "utf-8");
    const lines = gitignoreContent.split("\n").map((l) => l.trim());
    if (!lines.includes(".env") && !lines.includes(".env*")) {
      findings.push({
        category: "security",
        severity: "critical",
        message: ".env not listed in .gitignore — secrets may be committed",
        file: ".gitignore",
        line: null,
        autoFixable: true,
        fixDescription: "Add .env to .gitignore",
      });
    }
  }

  // Scan source files for hardcoded secrets
  const files = walkSourceFiles(cwd, 0, 4);
  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, label } of SECRET_PATTERNS) {
        if (pattern.test(lines[i])) {
          const relative = filePath.slice(cwd.length + 1);
          findings.push({
            category: "security",
            severity: "critical",
            message: `Hardcoded secret found: ${label}`,
            file: relative,
            line: i + 1,
            autoFixable: true,
            fixDescription: "Move secret to environment variable",
          });
        }
      }
    }
  }

  return findings;
}
