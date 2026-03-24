import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import type { ReadinessFinding } from "../types.js";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "__pycache__",
]);

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
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

export function scanStability(cwd: string): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];

  const files = walkSourceFiles(cwd, 0, 4);
  let hasHealthEndpoint = false;
  let hasReact = false;
  let hasErrorBoundary = false;

  for (const filePath of files) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (
      content.includes("/health") ||
      content.includes("/api/health")
    ) {
      hasHealthEndpoint = true;
    }

    if (
      content.includes("from 'react'") ||
      content.includes('from "react"') ||
      content.includes("require('react')") ||
      content.includes('require("react")')
    ) {
      hasReact = true;
    }

    if (
      content.includes("ErrorBoundary") ||
      content.includes("componentDidCatch") ||
      content.includes("getDerivedStateFromError")
    ) {
      hasErrorBoundary = true;
    }
  }

  if (!hasHealthEndpoint && files.length > 0) {
    findings.push({
      category: "stability",
      severity: "warning",
      message: "No health endpoint found (/health or /api/health)",
      file: null,
      line: null,
      autoFixable: true,
      fixDescription: "Add a /health endpoint that returns 200 OK",
    });
  }

  if (hasReact && !hasErrorBoundary) {
    findings.push({
      category: "stability",
      severity: "warning",
      message: "React app without error boundaries",
      file: null,
      line: null,
      autoFixable: false,
      fixDescription: null,
    });
  }

  return findings;
}
