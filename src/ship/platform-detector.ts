// Platform auto-detection engine — Task 2
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Platform, PlatformConfig } from "./types.js";

interface PlatformDefaults {
  deployCommand: string | null;
  previewCommand: string | null;
}

const PLATFORM_DEFAULTS: Record<Platform, PlatformDefaults> = {
  vercel: { deployCommand: "vercel --prod", previewCommand: "vercel" },
  railway: { deployCommand: "railway up", previewCommand: "railway up --detach" },
  fly: { deployCommand: "fly deploy", previewCommand: "fly deploy --app preview" },
  cloudflare: { deployCommand: "wrangler pages deploy", previewCommand: null },
  netlify: { deployCommand: "netlify deploy --prod", previewCommand: "netlify deploy" },
  docker: { deployCommand: "docker compose up -d --build", previewCommand: null },
  unknown: { deployCommand: null, previewCommand: null },
};

/** Config-file detection rules, checked in priority order. */
const CONFIG_RULES: Array<{ files: string[]; platform: Platform }> = [
  { files: ["vercel.json", ".vercel/project.json"], platform: "vercel" },
  { files: ["railway.json", "railway.toml"], platform: "railway" },
  { files: ["fly.toml"], platform: "fly" },
  { files: ["wrangler.toml"], platform: "cloudflare" },
  { files: ["netlify.toml"], platform: "netlify" },
  { files: ["render.yaml"], platform: "railway" },
  { files: ["Dockerfile", "docker-compose.yaml", "docker-compose.yml"], platform: "docker" },
];

function fileExists(cwd: string, rel: string): boolean {
  return existsSync(join(cwd, rel));
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function detectByConfig(cwd: string): Platform | null {
  for (const rule of CONFIG_RULES) {
    for (const file of rule.files) {
      if (fileExists(cwd, file)) return rule.platform;
    }
  }
  return null;
}

function hasDep(pkg: Record<string, unknown>, name: string): boolean {
  const deps = pkg.dependencies as Record<string, string> | undefined;
  const devDeps = pkg.devDependencies as Record<string, string> | undefined;
  return !!(deps?.[name] || devDeps?.[name]);
}

function detectByConvention(cwd: string): Platform | null {
  const pkgPath = join(cwd, "package.json");
  const pkg = readJson(pkgPath);

  if (pkg) {
    // Framework deps → vercel
    if (hasDep(pkg, "next") || hasDep(pkg, "@sveltejs/kit") || hasDep(pkg, "nuxt")) {
      return "vercel";
    }
    // Server deps → railway
    if (hasDep(pkg, "express") || hasDep(pkg, "fastify") || hasDep(pkg, "hono")) {
      return "railway";
    }
  }

  // Python deps
  const reqTxt = readText(join(cwd, "requirements.txt"));
  if (reqTxt) {
    const lower = reqTxt.toLowerCase();
    if (lower.includes("fastapi") || lower.includes("django") || lower.includes("flask")) {
      return "railway";
    }
  }

  const pyproject = readText(join(cwd, "pyproject.toml"));
  if (pyproject) {
    const lower = pyproject.toLowerCase();
    if (lower.includes("fastapi") || lower.includes("django") || lower.includes("flask")) {
      return "railway";
    }
  }

  // Static HTML without package.json
  if (!pkg && fileExists(cwd, "index.html")) {
    return "cloudflare";
  }

  return null;
}

function projectName(cwd: string): string | null {
  const pkg = readJson(join(cwd, "package.json"));
  if (pkg && typeof pkg.name === "string") return pkg.name;
  return basename(cwd) || null;
}

export function detectPlatform(cwd: string): PlatformConfig {
  const configPlatform = detectByConfig(cwd);
  if (configPlatform) {
    const defaults = PLATFORM_DEFAULTS[configPlatform];
    return {
      platform: configPlatform,
      detectedBy: "config-file",
      projectName: projectName(cwd),
      deployCommand: defaults.deployCommand,
      previewCommand: defaults.previewCommand,
      healthEndpoint: null,
      productionUrl: null,
    };
  }

  const conventionPlatform = detectByConvention(cwd);
  if (conventionPlatform) {
    const defaults = PLATFORM_DEFAULTS[conventionPlatform];
    return {
      platform: conventionPlatform,
      detectedBy: "convention",
      projectName: projectName(cwd),
      deployCommand: defaults.deployCommand,
      previewCommand: defaults.previewCommand,
      healthEndpoint: null,
      productionUrl: null,
    };
  }

  return {
    platform: "unknown",
    detectedBy: "manual",
    projectName: projectName(cwd),
    deployCommand: null,
    previewCommand: null,
    healthEndpoint: null,
    productionUrl: null,
  };
}
