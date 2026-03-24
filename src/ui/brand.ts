import chalk from "chalk";

// ─── Color Palette ──────────────────────────────────────
const SKULL = chalk.hex("#FF3333");      // blood red
const BONE = chalk.hex("#E8E8E8");       // bone white
const SHADOW = chalk.hex("#555555");     // graveyard grey
const ACID = chalk.hex("#00FF88");       // toxic green (success)
const WARN = chalk.hex("#FFB800");       // hazard yellow

export const brand = { SKULL, BONE, SHADOW, ACID, WARN };

// ─── Boot Banner ────────────────────────────────────────
const BANNER = `
${SKULL("    ╔══════════════════════════════════════╗")}
${SKULL("    ║")}${BONE.bold("    ☠  N O C O N F L I C T             ")}${SKULL("║")}
${SKULL("    ║")}${SHADOW("    murder your merge conflicts.        ")}${SKULL("║")}
${SKULL("    ╚══════════════════════════════════════╝")}`;

const BANNER_MINI = `${SKULL("  ☠")} ${BONE.bold("noconflict")}`;

export function printBanner(mini = false): void {
  console.log(mini ? BANNER_MINI : BANNER);
}

// ─── Status Tags ────────────────────────────────────────
export function tag(level: "green" | "yellow" | "red" | "info"): string {
  switch (level) {
    case "green":
      return ACID("  ■ CLEAN");
    case "yellow":
      return WARN("  ■ CAUTION");
    case "red":
      return SKULL("  ■ DANGER");
    case "info":
      return SHADOW("  ■");
  }
}

// ─── Push Receipts ──────────────────────────────────────
export function receipt(msg: string): void {
  console.log(ACID(`  ✓ ${msg}`));
}

export function warn(msg: string): void {
  console.log(WARN(`  ⚠ ${msg}`));
}

export function danger(msg: string): void {
  console.log(SKULL(`  ✖ ${msg}`));
}

export function dim(msg: string): void {
  console.log(SHADOW(`  ${msg}`));
}

export function bone(msg: string): void {
  console.log(BONE(`  ${msg}`));
}

// ─── Separator ──────────────────────────────────────────
export function line(): void {
  console.log(SHADOW("  ──────────────────────────────────────"));
}

// ─── Version Tag ────────────────────────────────────────
export function versionTag(): string {
  return `${SKULL("☠")} ${SHADOW("noconflict v0.2.0")}`;
}
