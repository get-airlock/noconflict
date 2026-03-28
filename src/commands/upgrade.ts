import open from "open";
import ora from "ora";
import { createInterface } from "node:readline";
import {
  PRO_PRICE_ID,
  CHECKOUT_SUCCESS_URL,
  CHECKOUT_CANCEL_URL,
} from "../billing/stripe.js";
import {
  getPlan,
  getLicenseKey,
  activateFromCustomerId,
} from "../billing/license.js";
import { isTrialActive, trialDaysLeft } from "../config/store.js";
import { brand, receipt, warn, dim, line } from "../ui/brand.js";

export async function upgrade(): Promise<void> {
  console.log("");
  console.log(
    brand.SKULL("  ☠") + brand.BONE.bold("  NOCONFLICT PRO — $29/mo")
  );
  line();

  // Already pro?
  if (getPlan() === "pro" && getLicenseKey()) {
    receipt("you're already Pro.");
    dim("run nc status to see your plan.");
    console.log("");
    return;
  }

  // Show trial status
  if (isTrialActive()) {
    const days = trialDaysLeft();
    dim(`trial: ${days} day${days === 1 ? "" : "s"} remaining.`);
    console.log("");
  }

  console.log(brand.BONE("  what you get:"));
  console.log(brand.ACID("    ✓ all 14 commands — push, sync, swap, ship, fix..."));
  console.log(brand.ACID("    ✓ unlimited fixes (free plan caps at 3)"));
  console.log(brand.ACID("    ✓ deploy, preview, health, logs, rollback"));
  console.log(brand.ACID("    ✓ priority conflict resolution"));
  console.log("");

  // If they have a customer ID already (re-activating), try that first
  const existingKey = getLicenseKey();
  if (existingKey) {
    const spinner = ora({
      text: brand.SHADOW("  checking existing subscription..."),
      spinner: "dots",
    }).start();

    try {
      const valid = await activateFromCustomerId(existingKey);
      spinner.stop();

      if (valid) {
        receipt("subscription reactivated. welcome back.");
        console.log("");
        return;
      }
    } catch {
      spinner.stop();
      dim("couldn't reach payment server. try again when online.");
      console.log("");
    }
  }

  // Option 1: Open Stripe Checkout (if Stripe is fully configured)
  if (PRO_PRICE_ID && process.env.STRIPE_SECRET_KEY) {
    console.log(brand.BONE("  opening checkout..."));
    console.log("");

    try {
      const { getStripe } = await import("../billing/stripe.js");
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
        success_url: `${CHECKOUT_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: CHECKOUT_CANCEL_URL,
      });

      if (session.url) {
        await open(session.url);
        dim("checkout opened in your browser.");
      }
    } catch (err) {
      warn(
        `couldn't create checkout: ${err instanceof Error ? err.message : err}`
      );
      dim("subscribe manually at noconflict.dev/pro instead.");
    }

    console.log("");
    console.log(
      brand.BONE("  after payment, enter your customer ID to activate:")
    );
  } else {
    // Manual activation (Stripe not configured locally)
    console.log(
      brand.BONE("  subscribe at ") +
        brand.ACID.bold("https://noconflict.dev/pro")
    );
    console.log("");
    console.log(
      brand.BONE("  then enter your customer ID to activate:")
    );
  }

  console.log("");

  // Prompt for customer ID
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle EOF (Ctrl+D) gracefully
  rl.on("close", () => {
    // If closed without input, exit cleanly
  });

  rl.question(brand.SHADOW("  customer ID (cus_...): "), async (input) => {
    rl.close();
    const trimmed = input.trim();

    if (!trimmed) {
      dim("no ID entered. run nc upgrade when you're ready.");
      console.log("");
      return;
    }

    if (!trimmed.startsWith("cus_")) {
      warn("that doesn't look like a Stripe customer ID (should start with cus_).");
      console.log("");
      return;
    }

    const spinner = ora({
      text: brand.SHADOW("  verifying..."),
      spinner: "dots",
    }).start();

    try {
      const valid = await activateFromCustomerId(trimmed);
      spinner.stop();

      if (valid) {
        console.log("");
        receipt("you're Pro now. every command unlocked.");
        dim("run nc status to confirm.");
      } else {
        console.log("");
        warn("no active subscription found for that ID.");
        dim("make sure you've completed payment at noconflict.dev/pro");
      }
    } catch {
      spinner.stop();
      console.log("");
      warn("couldn't verify — are you online?");
      dim("try again when you have an internet connection.");
    }
    console.log("");
  });
}
