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
import { upgrade } from "../commands/upgrade.js";
import { brand, versionTag } from "../ui/brand.js";
import { requirePro, requireFixOrPro } from "../billing/gate.js";

const program = new Command();

program
  .name("nc")
  .description("☠ noconflict — murder your merge conflicts.")
  .version("0.2.0");

program
  .command("init")
  .description("set up noconflict in this repo")
  .action(init);

// ─── MERGE layer (Pro) ─────────────────────────────────
program
  .command("push")
  .description("push without conflict")
  .allowUnknownOption()
  .action(async (_, cmd) => {
    await requirePro();
    await push(cmd.args);
  });

program
  .command("sync")
  .description("pull + rebase without the pain")
  .action(async () => {
    await requirePro();
    await sync();
  });

program
  .command("swap <branch>")
  .description("switch branches without losing work")
  .action(async (branch: string) => {
    await requirePro();
    await swap(branch);
  });

program
  .command("undo")
  .description("undo last mistake")
  .action(async () => {
    await requirePro();
    await undo();
  });

program
  .command("review")
  .description("pre-push sanity check")
  .action(async () => {
    await requirePro();
    await review();
  });

// ─── FREE commands ─────────────────────────────────────
program
  .command("status")
  .description("what's going on, in english")
  .option("--week", "weekly impact summary")
  .option("--trial", "full trial report")
  .action(status);

program
  .command("check")
  .description("readiness scan — are you ship-ready?")
  .action(check);

// ─── FIX — 3 free, then Pro ───────────────────────────
program
  .command("fix")
  .description("auto-fix what nc check found")
  .action(async () => {
    await requireFixOrPro();
    await fix();
  });

// ─── SHIP layer (Pro) ─────────────────────────────────
program
  .command("env")
  .description("deploy platform config")
  .option("--platform <name>", "set platform manually")
  .option("--url <url>", "set production URL")
  .option("--health <endpoint>", "set health check endpoint")
  .option("--reset", "reset all deploy config")
  .action(async (opts) => {
    await requirePro();
    await env(opts);
  });

program
  .command("ship")
  .description("deploy to production")
  .option("--force", "skip readiness check")
  .action(async (opts) => {
    await requirePro();
    await ship(opts);
  });

program
  .command("preview")
  .description("spin up preview environment")
  .action(async () => {
    await requirePro();
    await preview();
  });

// ─── WATCH layer (Pro) ────────────────────────────────
program
  .command("health")
  .description("production health status")
  .action(async () => {
    await requirePro();
    await health();
  });

program
  .command("logs")
  .description("tail production logs")
  .option("--lines <n>", "number of lines", "50")
  .action(async (opts) => {
    await requirePro();
    await logs(opts);
  });

program
  .command("rollback")
  .description("roll back to last healthy deploy")
  .action(async () => {
    await requirePro();
    await rollback();
  });

// ─── Billing ──────────────────────────────────────────
program
  .command("upgrade")
  .description("go pro — $29/mo")
  .action(upgrade);

// Keep activate as alias for upgrade
program
  .command("activate")
  .description("go pro — $29/mo (alias for upgrade)")
  .action(upgrade);

program.parse();
