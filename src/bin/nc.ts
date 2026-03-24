#!/usr/bin/env node

import { Command } from "commander";
import { init } from "../commands/init.js";
import { push } from "../commands/push.js";
import { sync } from "../commands/sync.js";
import { swap } from "../commands/swap.js";
import { undo } from "../commands/undo.js";
import { status } from "../commands/status.js";
import { review } from "../commands/review.js";
import { check } from "../commands/check.js";
import { fix } from "../commands/fix.js";
import { env } from "../commands/env.js";
import { ship } from "../commands/ship.js";
import { health } from "../commands/health.js";
import { logs } from "../commands/logs.js";
import { rollback } from "../commands/rollback.js";
import { preview } from "../commands/preview.js";
import { brand, versionTag } from "../ui/brand.js";

const program = new Command();

program
  .name("nc")
  .description("☠ noconflict — murder your merge conflicts.")
  .version("0.1.0");

program
  .command("init")
  .description("set up noconflict in this repo")
  .action(init);

program
  .command("push")
  .description("push without conflict")
  .allowUnknownOption()
  .action(async (_, cmd) => {
    await push(cmd.args);
  });

program
  .command("sync")
  .description("pull + rebase without the pain")
  .action(sync);

program
  .command("swap <branch>")
  .description("switch branches without losing work")
  .action(swap);

program
  .command("undo")
  .description("undo last mistake")
  .action(undo);

program
  .command("status")
  .description("what's going on, in english")
  .option("--week", "weekly impact summary")
  .option("--trial", "full trial report")
  .action(status);

program
  .command("review")
  .description("pre-push sanity check")
  .action(review);

program
  .command("check")
  .description("readiness scan — are you ship-ready?")
  .action(check);

program
  .command("fix")
  .description("auto-fix what nc check found")
  .action(fix);

program
  .command("env")
  .description("deploy platform config")
  .option("--platform <name>", "set platform manually")
  .option("--url <url>", "set production URL")
  .option("--health <endpoint>", "set health check endpoint")
  .option("--reset", "reset all deploy config")
  .action(env);

program
  .command("ship")
  .description("deploy to production")
  .option("--force", "skip readiness check")
  .action(ship);

program
  .command("health")
  .description("production health status")
  .action(health);

program
  .command("logs")
  .description("tail production logs")
  .option("--lines <n>", "number of lines", "50")
  .action(logs);

program
  .command("rollback")
  .description("roll back to last healthy deploy")
  .action(rollback);

program
  .command("preview")
  .description("spin up preview environment")
  .action(preview);

program
  .command("activate")
  .description("go pro — $29/mo")
  .action(async () => {
    console.log("");
    console.log(brand.SKULL("  ☠") + brand.BONE.bold("  NOCONFLICT PRO — $29/mo"));
    console.log("");
    console.log(brand.BONE("  → https://noconflict.dev/pro"));
    console.log("");
    console.log(brand.SHADOW("  we handle the api key. you just kill."));
    console.log("");
  });

program.parse();
