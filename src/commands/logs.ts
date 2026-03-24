import { config } from "../config/store.js";
import { detectPlatform } from "../ship/platform-detector.js";
import { tailLogs } from "../watch/log-tailer.js";
import { danger, dim, printBanner } from "../ui/brand.js";
import type { Platform } from "../ship/types.js";

export async function logs(options: { lines?: string }): Promise<void> {
  const cwd = process.cwd();

  let platform: Platform | null = config.get("ship.platform");

  // Auto-detect if not configured
  if (!platform || platform === "unknown") {
    const detected = detectPlatform(cwd);
    platform = detected.platform;
  }

  if (!platform || platform === "unknown") {
    danger("no platform detected. run nc env --platform <name>");
    console.log("");
    return;
  }

  console.log("");
  printBanner(true);
  console.log("");
  dim(`tailing ${platform} logs... (ctrl+c to stop)`);
  console.log("");

  tailLogs(platform, parseInt(options.lines ?? "50", 10));
}
