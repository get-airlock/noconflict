// Deploy orchestration — Task 7
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getGit, getCurrentBranch } from "../git/branch-scanner.js";
import { detectPlatform } from "./platform-detector.js";
import { config } from "../config/store.js";
import type { DeployRecord, ShipClassification, ShipZone } from "./types.js";

export function classifyShip(
  readinessScore: number,
  filesChanged: number
): ShipClassification {
  if (readinessScore < 50 || filesChanged > 20) {
    return {
      zone: "red",
      reason:
        readinessScore < 50
          ? `readiness ${readinessScore}% is below minimum threshold`
          : `${filesChanged} files changed exceeds safe limit`,
      autoRollback: false,
    };
  }

  if (readinessScore >= 80 && filesChanged <= 3) {
    return {
      zone: "green",
      reason: `readiness ${readinessScore}%, ${filesChanged} files — safe for auto-rollback`,
      autoRollback: true,
    };
  }

  return {
    zone: "yellow",
    reason: `readiness ${readinessScore}%, ${filesChanged} files — review recommended`,
    autoRollback: false,
  };
}

export async function deploy(
  cwd: string,
  force: boolean
): Promise<DeployRecord> {
  const ship = config.get("ship");
  let deployCommand = ship.deployCommand;
  let platform = ship.platform;

  // Auto-detect if not configured
  if (!deployCommand || !platform) {
    const detected = detectPlatform(cwd);
    platform = detected.platform;
    deployCommand = detected.deployCommand;

    if (platform !== "unknown") {
      config.set("ship.platform", platform);
      config.set("ship.detectedBy", detected.detectedBy);
      config.set("ship.deployCommand", detected.deployCommand);
    }
  }

  if (!deployCommand) {
    throw new Error(
      "no deploy command configured. run nc env --platform <name> first."
    );
  }

  // Validate platform CLI is installed before attempting deploy
  if (platform && platform !== "unknown") {
    const cliCheck: Record<string, string> = {
      vercel: "vercel",
      railway: "railway",
      fly: "flyctl",
      netlify: "netlify",
      cloudflare: "wrangler",
    };
    const cli = cliCheck[platform];
    if (cli) {
      try {
        execSync(`which ${cli}`, { stdio: "ignore" });
      } catch {
        throw new Error(
          `${platform} CLI ('${cli}') not found. install it first: https://${platform === "fly" ? "fly.io" : `${platform}.com`}/docs/cli`
        );
      }
    }
  }

  // Get git info
  const git = await getGit(cwd);
  const branch = await getCurrentBranch(git);
  const log = await git.log({ maxCount: 1 });
  const commitSha = log.latest?.hash ?? "unknown";

  const record: DeployRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    platform: platform ?? "unknown",
    commitSha,
    branch,
    readinessScore: 0,
    deployUrl: null,
    status: "deploying",
    healthChecks: [],
  };

  try {
    const output = execSync(deployCommand, {
      cwd,
      timeout: 5 * 60 * 1000, // 5 minutes
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Extract URL from output
    const urlMatch = output.match(/https?:\/\/[^\s"'<>]+/);
    if (urlMatch) {
      record.deployUrl = urlMatch[0];
    }

    record.status = "healthy";
  } catch (err: unknown) {
    record.status = "failed";
    const message =
      err instanceof Error ? err.message : "deploy command failed";
    throw new Error(message);
  } finally {
    // Save deploy record
    saveDeployRecord(cwd, record);
    config.set("ship.lastDeploy", record.timestamp);
  }

  return record;
}

function getDeployFilePath(cwd: string): string {
  const historyPath = config.get("ship.deployHistory") as string;
  return join(cwd, historyPath);
}

function saveDeployRecord(cwd: string, record: DeployRecord): void {
  const filePath = getDeployFilePath(cwd);
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const history = getDeployHistory(cwd);
  history.unshift(record);

  // Keep last 50
  const trimmed = history.slice(0, 50);
  writeFileSync(filePath, JSON.stringify(trimmed, null, 2), "utf-8");
}

export function getLastDeploy(cwd: string): DeployRecord | null {
  const history = getDeployHistory(cwd);
  return history.length > 0 ? history[0] : null;
}

export function getDeployHistory(cwd: string): DeployRecord[] {
  const filePath = getDeployFilePath(cwd);
  if (!existsSync(filePath)) return [];

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DeployRecord[];
  } catch {
    return [];
  }
}
