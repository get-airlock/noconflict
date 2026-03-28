import { isTrialActive, config } from "../config/store.js";
import { getPlan, validateLicense } from "./license.js";
import { brand, warn, dim } from "../ui/brand.js";

/**
 * Gate for Pro commands. Checks (in order):
 * 1. Active trial → allow
 * 2. Pro license (cached or server-validated) → allow
 * 3. Otherwise → block with upgrade CTA
 *
 * Usage: await requirePro() at top of any Pro command.
 * Exits process with code 1 if not authorized.
 */
export async function requirePro(): Promise<void> {
  // Trial still active — let them through
  if (isTrialActive()) return;

  // Check local cache first (no network)
  if (getPlan() === "pro") {
    // Validate in background if stale, but don't block
    const valid = await validateLicense();
    if (valid) return;
  }

  // Not on trial, not pro — block
  console.log("");
  warn("this is a Pro command.");
  console.log("");
  console.log(
    brand.BONE("  noconflict pro — $29/mo. all 14 commands. no limits.")
  );
  console.log("");
  console.log(brand.BONE("  → ") + brand.ACID.bold("nc upgrade"));
  console.log("");
  dim("nc check and nc status are always free.");
  console.log("");
  process.exit(1);
}

// ─── Fix gate — free users get 3, then Pro ─────────────

function getFixCount(): number {
  return (config.get("billing.fixCount" as never) as number) ?? 0;
}

function incrementFixCount(): void {
  const count = getFixCount() + 1;
  config.set("billing.fixCount" as never, count as never);
}

/**
 * Gate for `nc fix` — free users get 3 uses, then requires Pro.
 */
export async function requireFixOrPro(): Promise<void> {
  // Trial or Pro — unlimited
  if (isTrialActive()) return;
  if (getPlan() === "pro") {
    const valid = await validateLicense();
    if (valid) return;
  }

  const count = getFixCount();
  if (count < 3) {
    incrementFixCount();
    dim(`free fix ${count + 1}/3 used.`);
    return;
  }

  // Exhausted free fixes
  console.log("");
  warn("you've used all 3 free fixes.");
  console.log("");
  console.log(
    brand.BONE("  unlimited fixes with Pro — $29/mo")
  );
  console.log("");
  console.log(brand.BONE("  → ") + brand.ACID.bold("nc upgrade"));
  console.log("");
  process.exit(1);
}
