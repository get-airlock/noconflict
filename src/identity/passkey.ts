import chalk from "chalk";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { config } from "../config/store.js";
import type { NcIdentity } from "../config/store.js";

const AIRLOCK_IDENTITY_URL =
  process.env.AIRLOCK_IDENTITY_URL || "https://id.airlock.so";

/**
 * Register a passkey identity via browser-based WebAuthn ceremony.
 *
 * Flow:
 * 1. Start local HTTP server on random port
 * 2. Open browser to Airlock identity service with callback URL
 * 3. User touches biometric (Face ID, Touch ID, Windows Hello)
 * 4. Identity service posts credential back to local server
 * 5. Store credential locally, close server
 *
 * Zero forms. Zero email. One touch.
 */
export async function registerPasskey(): Promise<NcIdentity | null> {
  const challenge = randomBytes(32).toString("base64url");

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      // CORS for the identity service callback
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const credential = JSON.parse(body) as NcIdentity;

            config.set("identity", credential);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));

            server.close();
            resolve(credential);
          } catch {
            res.writeHead(400);
            res.end("bad request");
          }
        });
        return;
      }

      // Success page after passkey registration
      if (req.method === "GET" && req.url === "/success") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="background:#111;color:#fff;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
              <div style="text-align:center">
                <h1>☠ locked in.</h1>
                <p style="color:#888">you can close this tab.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        resolve(null);
        return;
      }
      const port = addr.port;
      const callbackUrl = `http://127.0.0.1:${port}/callback`;
      const successUrl = `http://127.0.0.1:${port}/success`;

      const registerUrl =
        `${AIRLOCK_IDENTITY_URL}/register` +
        `?challenge=${challenge}` +
        `&callback=${encodeURIComponent(callbackUrl)}` +
        `&success=${encodeURIComponent(successUrl)}` +
        `&source=noconflict`;

      // Open browser
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";

      import("node:child_process").then(({ exec }) => {
        exec(`${openCmd} "${registerUrl}"`);
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        resolve(null);
      }, 120_000);
    });
  });
}

/**
 * Verify an existing passkey identity via browser-based WebAuthn ceremony.
 * Same flow as register, but hits /verify endpoint.
 */
export async function verifyPasskey(): Promise<boolean> {
  const identity = config.get("identity");
  if (!identity?.credentialId) return false;

  const challenge = randomBytes(32).toString("base64url");

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const result = JSON.parse(body) as { verified: boolean };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            server.close();
            resolve(result.verified);
          } catch {
            res.writeHead(400);
            res.end();
            server.close();
            resolve(false);
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        resolve(false);
        return;
      }
      const port = addr.port;
      const callbackUrl = `http://127.0.0.1:${port}/callback`;

      const verifyUrl =
        `${AIRLOCK_IDENTITY_URL}/verify` +
        `?challenge=${challenge}` +
        `&credential=${identity.credentialId}` +
        `&callback=${encodeURIComponent(callbackUrl)}` +
        `&source=noconflict`;

      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";

      import("node:child_process").then(({ exec }) => {
        exec(`${openCmd} "${verifyUrl}"`);
      });

      setTimeout(() => {
        server.close();
        resolve(false);
      }, 60_000);
    });
  });
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
