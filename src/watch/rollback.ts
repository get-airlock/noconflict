// Rollback engine — Task 10
import { execSync } from "node:child_process";
import { getDeployHistory } from "../ship/deployer.js";
import { config } from "../config/store.js";
import type { DeployRecord, Platform } from "../ship/types.js";

export function getLastHealthyDeploy(cwd: string): DeployRecord | null {
  const history = getDeployHistory(cwd);

  // Find the most recent healthy deploy that isn't the latest entry
  for (let i = 1; i < history.length; i++) {
    if (history[i].status === "healthy") {
      return history[i];
    }
  }

  return null;
}

function getRollbackCommand(platform: Platform, commitSha: string): string {
  switch (platform) {
    case "vercel":
      return "git revert --no-commit HEAD && vercel --prod";
    case "railway":
      return "railway up";
    case "fly":
      return `fly deploy --image-ref ${commitSha}`;
    case "docker":
      return `git checkout ${commitSha} -- . && docker compose up -d --build`;
    default:
      throw new Error(`rollback not supported for platform: ${platform}`);
  }
}

export function rollbackToDeploy(cwd: string, target: DeployRecord): void {
  const platform = config.get("ship.platform") as Platform | null;

  if (!platform || platform === "unknown") {
    throw new Error("no platform configured. run nc env --platform <name>");
  }

  const command = getRollbackCommand(platform, target.commitSha);

  execSync(command, {
    cwd,
    timeout: 2 * 60 * 1000, // 2-minute timeout
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
