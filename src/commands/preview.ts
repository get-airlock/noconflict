import { execSync } from "node:child_process";
import ora from "ora";
import { config } from "../config/store.js";
import { detectPlatform } from "../ship/platform-detector.js";
import { receipt, danger, dim, printBanner } from "../ui/brand.js";

export async function preview(): Promise<void> {
  const cwd = process.cwd();

  console.log("");
  printBanner(true);
  console.log("");

  let previewCommand = config.get("ship.previewCommand") as string | null;
  let platform = config.get("ship.platform") as string | null;

  // Auto-detect if not configured
  if (!previewCommand) {
    const detected = detectPlatform(cwd);
    platform = detected.platform;
    previewCommand = detected.previewCommand;
  }

  if (!previewCommand) {
    danger("no preview command for platform.");
    dim("set one: nc env --platform <name>");
    console.log("");
    return;
  }

  const spinner = ora({
    text: "spinning up preview...",
    color: "green",
  }).start();

  try {
    const output = execSync(previewCommand, {
      cwd,
      timeout: 3 * 60 * 1000, // 3-minute timeout
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    spinner.stop();

    // Extract URL from output
    const urlMatch = output.match(/https?:\/\/[^\s"'<>]+/);

    if (urlMatch) {
      receipt(`preview: ${urlMatch[0]}`);
    } else {
      receipt("preview deployed.");
      if (output.trim().length > 0) {
        dim(output.trim().slice(0, 200));
      }
    }

    console.log("");
  } catch (err: unknown) {
    spinner.stop();
    const message = err instanceof Error ? err.message : "preview failed";
    danger(message);
    console.log("");
  }
}
