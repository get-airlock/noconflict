// Production log tailing — Task 9
import { spawn } from "node:child_process";
import type { Platform } from "../ship/types.js";

interface LogCommand {
  cmd: string;
  args: string[];
}

function getLogCommand(platform: Platform, lines: number): LogCommand {
  switch (platform) {
    case "vercel":
      return { cmd: "vercel", args: ["logs", "--follow"] };
    case "railway":
      return { cmd: "railway", args: ["logs", "--tail"] };
    case "fly":
      return { cmd: "fly", args: ["logs"] };
    case "docker":
      return { cmd: "docker", args: ["compose", "logs", "-f", `--tail=${lines}`] };
    default:
      throw new Error(`log tailing not supported for platform: ${platform}`);
  }
}

export function tailLogs(platform: Platform, lines: number = 50): void {
  const { cmd, args } = getLogCommand(platform, lines);

  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: process.env,
  });

  const cleanup = () => {
    child.kill("SIGTERM");
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  child.on("error", (err) => {
    console.error(`  failed to start ${cmd}: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.removeListener("SIGINT", cleanup);
    process.removeListener("SIGTERM", cleanup);
    process.exit(code ?? 0);
  });
}
