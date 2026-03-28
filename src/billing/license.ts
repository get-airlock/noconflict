import { config } from "../config/store.js";
import { getStripe } from "./stripe.js";

let _lastValidationOffline = false;

export function wasLastValidationOffline(): boolean {
  return _lastValidationOffline;
}

// ─── Local license storage via conf ────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getLicenseKey(): string {
  return config.get("billing").licenseKey ?? "";
}

export function setLicenseKey(key: string): void {
  const billing = config.get("billing");
  config.set("billing", { ...billing, licenseKey: key });
}

export function getPlan(): "free" | "pro" {
  return config.get("billing").plan ?? "free";
}

export function setPlan(plan: "free" | "pro"): void {
  const billing = config.get("billing");
  config.set("billing", { ...billing, plan });
}

export function getValidatedAt(): number {
  const ts = config.get("billing").validatedAt;
  return ts ? new Date(ts).getTime() : 0;
}

export function setValidatedAt(): void {
  const billing = config.get("billing");
  config.set("billing", { ...billing, validatedAt: new Date().toISOString() });
}

export function getExpiresAt(): string {
  return config.get("billing").expiresAt ?? "";
}

export function setExpiresAt(iso: string): void {
  const billing = config.get("billing");
  config.set("billing", { ...billing, expiresAt: iso });
}

export function clearLicense(): void {
  config.set("billing", {
    licenseKey: "",
    plan: "free",
    validatedAt: "",
    expiresAt: "",
    fixCount: 0,
  });
}

// ─── Validate license against Stripe (cached 24h) ─────
export async function validateLicense(): Promise<boolean> {
  const key = getLicenseKey();
  if (!key) return false;

  // Check cache first
  const lastCheck = getValidatedAt();
  if (Date.now() - lastCheck < CACHE_TTL_MS) {
    return getPlan() === "pro";
  }

  // Hit Stripe to verify active subscription
  _lastValidationOffline = false;
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
      if (sub.cancel_at) {
        setExpiresAt(new Date(sub.cancel_at * 1000).toISOString());
      } else {
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
    _lastValidationOffline = true;
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
  const billing = config.get("billing");
  config.set("billing", { ...billing, validatedAt: "" });
  return validateLicense();
}
