import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPlatform } from "../../src/ship/platform-detector.js";

describe("platform-detector", () => {
  const dirs: string[] = [];

  function makeTmp(): string {
    const d = mkdtempSync(join(tmpdir(), "nc-detect-"));
    dirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  // --- Config file detection ---

  it("detects vercel from vercel.json", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "vercel.json"), "{}");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("vercel");
    expect(result.detectedBy).toBe("config-file");
    expect(result.deployCommand).toBe("vercel --prod");
    expect(result.previewCommand).toBe("vercel");
  });

  it("detects railway from railway.json", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "railway.json"), "{}");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("railway");
    expect(result.detectedBy).toBe("config-file");
    expect(result.deployCommand).toBe("railway up");
    expect(result.previewCommand).toBe("railway up --detach");
  });

  it("detects fly from fly.toml", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "fly.toml"), "");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("fly");
    expect(result.detectedBy).toBe("config-file");
    expect(result.deployCommand).toBe("fly deploy");
    expect(result.previewCommand).toBe("fly deploy --app preview");
  });

  it("detects cloudflare from wrangler.toml", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "wrangler.toml"), "");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("cloudflare");
    expect(result.detectedBy).toBe("config-file");
    expect(result.deployCommand).toBe("wrangler pages deploy");
    expect(result.previewCommand).toBeNull();
  });

  it("detects netlify from netlify.toml", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "netlify.toml"), "");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("netlify");
    expect(result.detectedBy).toBe("config-file");
    expect(result.deployCommand).toBe("netlify deploy --prod");
    expect(result.previewCommand).toBe("netlify deploy");
  });

  it("detects docker from Dockerfile", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "Dockerfile"), "FROM node:20");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("docker");
    expect(result.detectedBy).toBe("config-file");
    expect(result.deployCommand).toBe("docker compose up -d --build");
    expect(result.previewCommand).toBeNull();
  });

  // --- Convention-based detection ---

  it("detects vercel by convention for Next.js project", () => {
    const cwd = makeTmp();
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { next: "^14.0.0" } })
    );
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("vercel");
    expect(result.detectedBy).toBe("convention");
  });

  it("detects railway by convention for FastAPI project", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "requirements.txt"), "fastapi==0.104.0\nuvicorn");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("railway");
    expect(result.detectedBy).toBe("convention");
  });

  it("detects cloudflare by convention for static HTML", () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, "index.html"), "<html></html>");
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("cloudflare");
    expect(result.detectedBy).toBe("convention");
  });

  // --- Fallback ---

  it("returns unknown when nothing detected", () => {
    const cwd = makeTmp();
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("unknown");
    expect(result.detectedBy).toBe("manual");
    expect(result.deployCommand).toBeNull();
    expect(result.previewCommand).toBeNull();
  });

  // --- Priority ---

  it("prioritizes config file over convention", () => {
    const cwd = makeTmp();
    // railway.json (config) + Next.js package.json (convention → vercel)
    writeFileSync(join(cwd, "railway.json"), "{}");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ dependencies: { next: "^14.0.0" } })
    );
    const result = detectPlatform(cwd);
    expect(result.platform).toBe("railway");
    expect(result.detectedBy).toBe("config-file");
  });
});
