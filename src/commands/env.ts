import { detectPlatform } from "../ship/platform-detector.js";
import { config } from "../config/store.js";
import { brand, receipt, warn, dim, line, printBanner } from "../ui/brand.js";
import type { Platform } from "../ship/types.js";

const KNOWN_PLATFORMS: Platform[] = [
  "vercel",
  "railway",
  "fly",
  "cloudflare",
  "netlify",
  "docker",
];

export async function env(options: {
  platform?: string;
  url?: string;
  health?: string;
  reset?: boolean;
}): Promise<void> {
  console.log("");
  printBanner(true);
  console.log("");

  // --reset: restore defaults
  if (options.reset) {
    config.set("ship", {
      platform: null,
      detectedBy: null,
      projectName: null,
      deployCommand: null,
      previewCommand: null,
      healthEndpoint: null,
      productionUrl: null,
      lastDeploy: null,
      deployHistory: ".noconflict/deploys.json",
    });
    receipt("platform config reset.");
    console.log("");
    return;
  }

  // --platform <name>: manual override
  if (options.platform) {
    const name = options.platform.toLowerCase() as Platform;
    if (!KNOWN_PLATFORMS.includes(name)) {
      warn(`unknown platform "${options.platform}".`);
      dim(`known: ${KNOWN_PLATFORMS.join(", ")}`);
      dim("set manually: nc env --platform <name>");
      console.log("");
      return;
    }
    config.set("ship.platform", name);
    config.set("ship.detectedBy", "manual");
    receipt(`platform set to ${name}.`);
    console.log("");
    return;
  }

  // --url <url>: set production URL
  if (options.url) {
    config.set("ship.productionUrl", options.url);
    receipt(`production url set to ${options.url}.`);
    console.log("");
    return;
  }

  // --health <endpoint>: set health endpoint
  if (options.health) {
    config.set("ship.healthEndpoint", options.health);
    receipt(`health endpoint set to ${options.health}.`);
    console.log("");
    return;
  }

  // No flags: display current config
  const ship = config.get("ship");
  let platform = ship.platform;
  let detectedBy = ship.detectedBy;

  // Auto-detect if not set
  if (!platform) {
    const detected = detectPlatform(process.cwd());
    platform = detected.platform;
    detectedBy = detected.detectedBy;

    if (platform !== "unknown") {
      config.set("ship.platform", platform);
      config.set("ship.detectedBy", detectedBy);
      config.set("ship.projectName", detected.projectName);
      config.set("ship.deployCommand", detected.deployCommand);
      config.set("ship.previewCommand", detected.previewCommand);
    }
  }

  console.log(brand.SHADOW("  ── DEPLOY CONFIG ──"));
  console.log("");

  if (platform === "unknown" || !platform) {
    console.log(`  ${brand.BONE("platform:".padEnd(14))} ${brand.WARN("unknown")}`);
    warn("could not detect platform.");
    dim("set manually: nc env --platform <name>");
  } else {
    console.log(`  ${brand.BONE("platform:".padEnd(14))} ${brand.ACID(platform)}`);
  }

  console.log(
    `  ${brand.BONE("detected by:".padEnd(14))} ${brand.SHADOW(detectedBy ?? "not set")}`
  );
  console.log(
    `  ${brand.BONE("deploy cmd:".padEnd(14))} ${brand.SHADOW(ship.deployCommand ?? "not set")}`
  );
  console.log(
    `  ${brand.BONE("preview cmd:".padEnd(14))} ${brand.SHADOW(ship.previewCommand ?? "not set")}`
  );
  console.log(
    `  ${brand.BONE("prod url:".padEnd(14))} ${brand.SHADOW(ship.productionUrl ?? "not set")}`
  );
  console.log(
    `  ${brand.BONE("health:".padEnd(14))} ${brand.SHADOW(ship.healthEndpoint ?? "not set")}`
  );
  console.log(
    `  ${brand.BONE("last deploy:".padEnd(14))} ${brand.SHADOW(ship.lastDeploy ?? "never")}`
  );

  console.log("");
}
