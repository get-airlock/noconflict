import { config } from "../config/store.js";
import { getStripe } from "./stripe.js";

// ─── Local license storage via conf ────────────────────
// Keys stored in conf (same store as rest of nc config):
//   billing.licenseKey  — Stripe customer ID
//   billing.plan        — "free" | "pro"
//   billing.validatedAt — ISO timestamp of last server check
//   billing.expiresAt   — ISO timestamp when sub ends (period_end)

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getLicenseKey(): string {
  return (config.get("billing.licenseKey" as never) as string) ?? "";
}

export function setLicenseKey(key: string): void {
  config.set("billing.licenseKey" as never, key as never);
}

export function getPlan(): "free" | "pro" {
  return (
    (config.get("billing.plan" as never) as "free" | "pro") ?? "free"
  );
}

export function setPlan(plan: "free" | "pro"): void {
  config.set("billing.plan" as never, plan as never);
}

export function getValidatedAt(): number {
  const ts = config.get("billing.validatedAt" as never) as string;
  return ts ? new Date(ts).getTime() : 0;
}

export function setValidatedAt(): void {
  config.set(
    "billing.validatedAt" as never,
    new Date().toISOString() as never
  );
}

export function getExpiresAt(): string {
  return (config.get("billing.expiresAt" as never) as string) ?? "";
}

export function setExpiresAt(iso: string): void {
  config.set("billing.expiresAt" as never, iso as never);
}

export function clearLicense(): void {
  config.delete("billing.licenseKey" as never);
  config.delete("billing.plan" as never);
  config.delete("billing.validatedAt" as never);
  config.delete("billing.expiresAt" as never);
}

// ─── Validate license against Stripe (cached 24h) ─────
export async function validateLicense(): Promise<boolean> {
  const key = getLicenseKey();
  if (!key) return false;

  // Check cache first
  const lastCheck = getValidatedAt();
  if (Date.now() - lastCheck < CACHE_TTL_MS) {
    // Trust cached plan
    return getPlan() === "pro";
  }

  // Hit Stripe to verify active subscription
  try {
    const stripe = getStripe();
    const subs = await stripe.subscriptions.list({
      customer: key,
      status: "active",
      limit: 1,
    });

    if (subs.data.length > 0) {
      const sub = subs.data[0];
      setPlan("pro");
      // Use cancel_at if set, otherwise mark as ongoing
      if (sub.cancel_at) {
        setExpiresAt(new Date(sub.cancel_at * 1000).toISOString());
      } else {
        // Active and not canceling — set a far-future marker
        setExpiresAt("");
      }
      setValidatedAt();
      return true;
    }

    // No active sub — downgrade
    setPlan("free");
    setValidatedAt();
    return false;
  } catch {
    // Network error — trust cache if recent enough (within 7 days)
    const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - lastCheck < GRACE_MS && getPlan() === "pro") {
      return true;
    }
    return false;
  }
}

// ─── Activate from Stripe customer ID ─────────────────
export async function activateFromCustomerId(
  customerId: string
): Promise<boolean> {
  setLicenseKey(customerId);
  // Force fresh validation
  config.delete("billing.validatedAt" as never);
  return validateLicense();
}
