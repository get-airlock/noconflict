import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanReadiness } from "../../src/ship/readiness-scanner.js";

describe("readiness-scanner", () => {
  const dirs: string[] = [];

  function makeTmp(): string {
    const d = mkdtempSync(join(tmpdir(), "nc-readiness-"));
    dirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("returns report with 5 categories", async () => {
    const cwd = makeTmp();
    const report = await scanReadiness(cwd);
    expect(report.scores).toHaveLength(5);
    const categories = report.scores.map((s) => s.category).sort();
    expect(categories).toEqual([
      "dependencies",
      "deployment",
      "quality",
      "security",
      "stability",
    ]);
  });

  it("calculates overall score as weighted average (0-100)", async () => {
    const cwd = makeTmp();
    const report = await scanReadiness(cwd);
    expect(report.overall).toBeGreaterThanOrEqual(0);
    expect(report.overall).toBeLessThanOrEqual(100);
    expect(typeof report.overall).toBe("number");
  });

  it("counts auto-fixable issues", async () => {
    const cwd = makeTmp();
    // .env without .gitignore = autoFixable critical
    writeFileSync(join(cwd, ".env"), "SECRET=hello");
    const report = await scanReadiness(cwd);
    expect(report.autoFixable).toBeGreaterThan(0);
    expect(report.totalIssues).toBeGreaterThanOrEqual(report.autoFixable);
  });

  it("flags hardcoded API keys in source files", async () => {
    const cwd = makeTmp();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "config.ts"),
      'const key = "sk-proj-abc123def456";'
    );
    const report = await scanReadiness(cwd);
    const securityScore = report.scores.find((s) => s.category === "security")!;
    const keyFinding = securityScore.findings.find((f) =>
      f.message.toLowerCase().includes("secret") ||
      f.message.toLowerCase().includes("key") ||
      f.message.toLowerCase().includes("hardcoded")
    );
    expect(keyFinding).toBeDefined();
    expect(keyFinding!.severity).toBe("critical");
  });

  it("flags missing .gitignore when .env exists", async () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, ".env"), "API_KEY=test");
    const report = await scanReadiness(cwd);
    const securityScore = report.scores.find((s) => s.category === "security")!;
    const envFinding = securityScore.findings.find(
      (f) =>
        f.message.toLowerCase().includes(".env") &&
        f.message.toLowerCase().includes(".gitignore")
    );
    expect(envFinding).toBeDefined();
    expect(envFinding!.severity).toBe("critical");
    expect(envFinding!.autoFixable).toBe(true);
  });

  it("flags missing build script in package.json", async () => {
    const cwd = makeTmp();
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ name: "test", scripts: {} })
    );
    const report = await scanReadiness(cwd);
    const deployScore = report.scores.find(
      (s) => s.category === "deployment"
    )!;
    const buildFinding = deployScore.findings.find((f) =>
      f.message.toLowerCase().includes("build")
    );
    expect(buildFinding).toBeDefined();
    expect(buildFinding!.severity).toBe("warning");
  });

  it("flags missing viewport meta tag in HTML", async () => {
    const cwd = makeTmp();
    writeFileSync(
      join(cwd, "index.html"),
      "<html><head><title>Test</title></head><body></body></html>"
    );
    const report = await scanReadiness(cwd);
    const qualityScore = report.scores.find((s) => s.category === "quality")!;
    const viewportFinding = qualityScore.findings.find((f) =>
      f.message.toLowerCase().includes("viewport")
    );
    expect(viewportFinding).toBeDefined();
    expect(viewportFinding!.severity).toBe("warning");
    expect(viewportFinding!.autoFixable).toBe(true);
  });

  it("flags known vulnerable packages (score 0-100)", async () => {
    const cwd = makeTmp();
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "test",
        dependencies: { lodash: "*", express: "latest" },
      })
    );
    const report = await scanReadiness(cwd);
    const depScore = report.scores.find(
      (s) => s.category === "dependencies"
    )!;
    expect(depScore.score).toBeGreaterThanOrEqual(0);
    expect(depScore.score).toBeLessThanOrEqual(100);
    // Wildcard and "latest" should be flagged
    const wildcardFindings = depScore.findings.filter(
      (f) =>
        f.message.toLowerCase().includes("wildcard") ||
        f.message.toLowerCase().includes("latest")
    );
    expect(wildcardFindings.length).toBeGreaterThan(0);
  });

  it("gives high score (80%+) to well-configured project", async () => {
    const cwd = makeTmp();

    // .gitignore with .env
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n.env\ndist\n");

    // package.json with build + start
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "well-configured",
        version: "1.0.0",
        scripts: { build: "tsc", start: "node dist/index.js" },
        dependencies: { express: "^4.18.0" },
      })
    );

    // Lock file
    writeFileSync(join(cwd, "package-lock.json"), "{}");

    // .env + .env.example
    writeFileSync(join(cwd, ".env"), "SECRET=val");
    writeFileSync(join(cwd, ".env.example"), "SECRET=");

    // HTML with viewport + favicon
    writeFileSync(
      join(cwd, "index.html"),
      '<html><head><meta name="viewport" content="width=device-width"><link rel="icon" href="/favicon.ico"></head><body></body></html>'
    );

    // Source with health endpoint
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "index.ts"),
      'app.get("/health", (req, res) => res.json({ ok: true }));'
    );

    // 404 page
    writeFileSync(join(cwd, "404.html"), "<html><body>Not Found</body></html>");

    const report = await scanReadiness(cwd);
    expect(report.overall).toBeGreaterThanOrEqual(80);
  });
});
