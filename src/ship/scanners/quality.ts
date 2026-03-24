import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReadinessFinding } from "../types.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
]);

function findHtmlFiles(
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
        results.push(...findHtmlFiles(full, depth + 1, maxDepth));
      }
    } else if (entry.endsWith(".html")) {
      results.push(full);
    }
  }
  return results;
}

export function scanQuality(cwd: string): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];

  const htmlFiles = findHtmlFiles(cwd, 0, 4);

  for (const filePath of htmlFiles) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const relative = filePath.slice(cwd.length + 1);

    if (!content.includes('name="viewport"')) {
      findings.push({
        category: "quality",
        severity: "warning",
        message: `Missing viewport meta tag in ${relative}`,
        file: relative,
        line: null,
        autoFixable: true,
        fixDescription:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1">',
      });
    }

    if (
      !content.includes('rel="icon"') &&
      !content.includes("rel='icon'") &&
      !content.includes('rel="shortcut icon"') &&
      !content.includes("rel='shortcut icon'")
    ) {
      findings.push({
        category: "quality",
        severity: "info",
        message: `Missing favicon in ${relative}`,
        file: relative,
        line: null,
        autoFixable: false,
        fixDescription: null,
      });
    }
  }

  // Check for 404 page
  const has404 =
    existsSync(join(cwd, "404.html")) ||
    existsSync(join(cwd, "pages/404.tsx")) ||
    existsSync(join(cwd, "pages/404.jsx")) ||
    existsSync(join(cwd, "src/pages/404.tsx")) ||
    existsSync(join(cwd, "src/pages/404.jsx")) ||
    existsSync(join(cwd, "app/not-found.tsx")) ||
    existsSync(join(cwd, "src/app/not-found.tsx"));

  if (!has404) {
    findings.push({
      category: "quality",
      severity: "info",
      message: "No 404 page found",
      file: null,
      line: null,
      autoFixable: true,
      fixDescription: "Create a 404.html or framework-specific not-found page",
    });
  }

  return findings;
}
