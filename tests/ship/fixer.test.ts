import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { autoFix } from "../../src/ship/fixer.js";

describe("fixer", () => {
  const dirs: string[] = [];

  function makeTmp(): string {
    const d = mkdtempSync(join(tmpdir(), "nc-fixer-"));
    dirs.push(d);
    return d;
  }

  afterEach(() => {
    for (const d of dirs) {
      rmSync(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("creates .gitignore with .env when missing", async () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, ".env"), "SECRET=hello");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ name: "test", scripts: {} })
    );

    await autoFix(cwd);

    expect(existsSync(join(cwd, ".gitignore"))).toBe(true);
    const content = readFileSync(join(cwd, ".gitignore"), "utf-8");
    expect(content).toContain(".env");
    expect(content).toContain("node_modules");
  });

  it("adds .env to existing .gitignore", async () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, ".gitignore"), "node_modules\n");
    writeFileSync(join(cwd, ".env"), "SECRET=hello");

    await autoFix(cwd);

    const content = readFileSync(join(cwd, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain(".env");
  });

  it("adds viewport meta tag to HTML", async () => {
    const cwd = makeTmp();
    writeFileSync(
      join(cwd, "index.html"),
      "<html><head><title>Test</title></head><body></body></html>"
    );

    await autoFix(cwd);

    const content = readFileSync(join(cwd, "index.html"), "utf-8");
    expect(content).toContain('name="viewport"');
    expect(content).toContain("width=device-width, initial-scale=1");
    // viewport should appear after <head>
    const headIdx = content.indexOf("<head>");
    const viewportIdx = content.indexOf('name="viewport"');
    expect(viewportIdx).toBeGreaterThan(headIdx);
  });

  it("generates .env.example from .env", async () => {
    const cwd = makeTmp();
    writeFileSync(
      join(cwd, ".env"),
      "API_KEY=sk-abc123\nDB_URL=postgres://localhost/db\n"
    );
    writeFileSync(join(cwd, ".gitignore"), ".env\n");

    await autoFix(cwd);

    expect(existsSync(join(cwd, ".env.example"))).toBe(true);
    const content = readFileSync(join(cwd, ".env.example"), "utf-8");
    expect(content).toContain("API_KEY=");
    expect(content).toContain("DB_URL=");
    expect(content).not.toContain("sk-abc123");
    expect(content).not.toContain("postgres://localhost/db");
  });

  it("returns count of fixes applied", async () => {
    const cwd = makeTmp();
    writeFileSync(join(cwd, ".env"), "SECRET=hello");
    // No .gitignore → will create one (1 fix)
    // No .env.example → will create one (1 fix)

    const result = await autoFix(cwd);

    expect(typeof result.fixed).toBe("number");
    expect(typeof result.skipped).toBe("number");
    expect(Array.isArray(result.actions)).toBe(true);
    expect(result.fixed).toBeGreaterThan(0);
    expect(result.actions.length).toBe(result.fixed);
  });
});
