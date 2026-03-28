import chalk from "chalk";
import { createInterface } from "node:readline";
import { config } from "../config/store.js";
import { getGit } from "../git/branch-scanner.js";
import { registerPasskey, hasIdentity, printIdentityStatus } from "../identity/passkey.js";
import { printBanner, brand, line, dim, receipt, danger } from "../ui/brand.js";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function init(): Promise<void> {
  printBanner();
  console.log("");

  // verify we're in a git repo
  try {
    await getGit();
  } catch {
    danger("not a git repo. cd into one first.");
    process.exit(1);
  }

  // check if already initialized
  if (config.get("apiKey")) {
    dim("already armed. you're good.");
    dim(`trial: ${config.get("trialStart") ? "active" : "not started"}`);
    printIdentityStatus();
    rl.close();
    return;
  }

  // ── Step 1: Identity (passkey) ──────────────────────────────

  if (!hasIdentity()) {
    line();
    console.log(brand.BONE("  STEP 1 — IDENTITY"));
    dim("one touch. no forms. no email.");
    console.log("");

    const doPasskey = await ask(brand.BONE("  set up passkey? (y/n): "));

    if (doPasskey.trim().toLowerCase() === "y") {
      console.log("");
      const identity = await registerPasskey();
      if (identity) {
        receipt("identity locked.");
        dim(`credential: ${identity.credentialId.slice(0, 8)}...`);
        dim(`device: ${identity.deviceName}`);
        dim(`user id: ${identity.userId.slice(0, 8)}...`);
      } else {
        dim("identity setup failed. try again with nc init.");
      }
      console.log("");
    } else {
      dim("skipped. set up later with nc init.");
      console.log("");
    }
  } else {
    receipt("identity: linked");
    printIdentityStatus();
    console.log("");
  }

  // ── Step 2: API Key (BYOK) ─────────────────────────────────

  line();
  console.log(brand.BONE("  STEP 2 — BRING YOUR OWN KEY"));
  dim("all you need is an openrouter key.");
  dim("get one free → openrouter.ai/keys");
  console.log("");

  const key = await ask(brand.BONE("  paste your openrouter key: "));

  if (!key.trim()) {
    danger("no key, no weapon. try again.");
    rl.close();
    process.exit(1);
  }

  config.set("apiKey", key.trim());
  config.set("trialStart", new Date().toISOString());

  console.log("");
  line();
  console.log(brand.SKULL("  ☠") + brand.BONE.bold("  ARMED AND DANGEROUS."));
  console.log("");
  dim("14 days free. no credit card.");
  dim("nc push instead of git push. that's it.");
  console.log("");
  dim("your code stays on your machine.");
  dim("we just read diffs. nothing else.");

  if (hasIdentity()) {
    console.log("");
    dim("your identity follows you everywhere.");
    dim("next time, we'll know it's you.");
  }

  console.log("");

  rl.close();
}
