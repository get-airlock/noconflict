import chalk from "chalk";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import os from "node:os";
import { config } from "../config/store.js";
import type { NcIdentity } from "../config/store.js";

// ─── Keychain helpers (macOS only) ──────────────────────────────────────────

const KEYCHAIN_SERVICE = "noconflict-identity";
const KEYCHAIN_ACCOUNT = "device-credential";

function keychainStore(credentialId: string): void {
  if (process.platform !== "darwin") return;
  try {
    execSync(
      `security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w "${credentialId}"`,
      { stdio: "ignore" }
    );
  } catch {
    // silently degrade — conf store is the primary
  }
}

function keychainRead(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const result = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w`,
      { stdio: ["ignore", "pipe", "ignore"] }
    );
    return result.toString().trim() || null;
  } catch {
    return null;
  }
}

// ─── Device fingerprint ──────────────────────────────────────────────────────

function buildUserId(salt: string): string {
  const raw = `${os.hostname()}::${os.userInfo().username}::${salt}`;
  return createHash("sha256").update(raw).digest("hex");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a local passkey identity.
 *
 * No browser, no server, no network.
 * Generates a unique credential tied to this device + user and stores it in:
 *   1. The Conf store (cross-platform)
 *   2. macOS system keychain (backup/verification on macOS)
 */
export async function registerPasskey(): Promise<NcIdentity | null> {
  const salt = randomBytes(16).toString("hex");
  const credentialId = randomUUID();
  const userId = buildUserId(salt);
  const deviceName = os.hostname();

  const identity: NcIdentity = {
    credentialId,
    userId,
    deviceName,
    createdAt: new Date().toISOString(),
  };

  // Primary store
  config.set("identity", identity);

  // Backup: macOS keychain
  keychainStore(credentialId);

  return identity;
}

/**
 * Verify the stored identity against this device.
 *
 * Checks that the credentialId in conf matches what's in the keychain
 * (macOS) or simply that the conf entry exists (Linux/Windows).
 * Returns true if identity is intact.
 */
export async function verifyPasskey(): Promise<boolean> {
  const identity = config.get("identity");
  if (!identity?.credentialId) return false;

  if (process.platform === "darwin") {
    const stored = keychainRead();
    // If keychain has nothing yet (first run after migration), trust conf
    if (stored === null) return true;
    return stored === identity.credentialId;
  }

  // Non-macOS: validate credential format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(identity.credentialId);
}

/**
 * Check if this device has a registered identity.
 */
export function hasIdentity(): boolean {
  const identity = config.get("identity");
  return !!identity?.credentialId;
}

/**
 * Get the stored identity info.
 */
export function getIdentity(): NcIdentity | null {
  const identity = config.get("identity");
  if (!identity?.credentialId) return null;
  return identity;
}

/**
 * Print identity status.
 */
export function printIdentityStatus(): void {
  const id = getIdentity();
  if (!id) {
    console.log(chalk.dim("  identity: none"));
    return;
  }
  console.log(
    chalk.dim(`  identity: ${id.userId.slice(0, 8)}... (${id.deviceName})`)
  );
  console.log(chalk.dim(`  linked: ${id.createdAt.split("T")[0]}`));
}
