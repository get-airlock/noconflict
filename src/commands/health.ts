import { getLastDeploy, getDeployHistory } from "../ship/deployer.js";
import { checkHealth } from "../watch/health-monitor.js";
import { config } from "../config/store.js";
import { brand, receipt, danger, dim, line, printBanner } from "../ui/brand.js";
import type { DeployRecord } from "../ship/types.js";

function statusIndicator(status: DeployRecord["status"]): string {
  switch (status) {
    case "healthy":
      return brand.ACID("● healthy");
    case "deploying":
      return brand.WARN("● deploying");
    case "degraded":
      return brand.WARN("● degraded");
    case "failed":
      return brand.SKULL("● failed");
    case "rolled-back":
      return brand.SKULL("● rolled-back");
    default:
      return brand.SHADOW("● unknown");
  }
}

export async function health(): Promise<void> {
  const cwd = process.cwd();

  console.log("");
  printBanner(true);
  console.log("");

  const last = getLastDeploy(cwd);

  if (!last) {
    dim("no deploys yet. run nc ship first.");
    console.log("");
    return;
  }

  // Show last deploy info
  console.log(brand.SHADOW("  ── DEPLOY STATUS ──"));
  console.log("");

  const shortSha = last.commitSha.slice(0, 7);
  console.log(
    `  ${brand.BONE("timestamp:".padEnd(12))} ${brand.SHADOW(last.timestamp)}`
  );
  console.log(
    `  ${brand.BONE("commit:".padEnd(12))} ${brand.SHADOW(shortSha)}`
  );
  console.log(
    `  ${brand.BONE("platform:".padEnd(12))} ${brand.SHADOW(last.platform)}`
  );
  console.log(`  ${brand.BONE("status:".padEnd(12))} ${statusIndicator(last.status)}`);
  console.log("");

  // Live health check if URL configured
  const ship = config.get("ship");
  const url = ship.productionUrl ?? ship.healthEndpoint;

  if (url) {
    const check = await checkHealth(url);

    if (check.healthy) {
      receipt(`healthy. ${check.responseTimeMs}ms. HTTP ${check.statusCode}.`);
    } else {
      danger(`unhealthy. ${check.error}`);
    }
    console.log("");
  } else {
    dim("no production url configured.");
    dim("set one: nc env --url <url>");
    console.log("");
  }

  // Show last 5 deploys
  const history = getDeployHistory(cwd);
  if (history.length > 1) {
    console.log(brand.SHADOW("  ── RECENT DEPLOYS ──"));
    console.log("");

    const recent = history.slice(0, 5);
    for (const d of recent) {
      const sha = d.commitSha.slice(0, 7);
      const date = new Date(d.timestamp).toLocaleDateString();
      console.log(
        `  ${brand.SHADOW(date)}  ${brand.SHADOW(sha)}  ${statusIndicator(d.status)}`
      );
    }
    console.log("");
  }
}
