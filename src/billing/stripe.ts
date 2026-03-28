import Stripe from "stripe";

// NEVER hardcode the secret key. Always use environment variable.
const key = process.env.STRIPE_SECRET_KEY ?? "";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY not set. Add it to .env or export it."
      );
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
}

// Stripe price for NoConflict Pro — $29/mo recurring
// Created via Stripe Dashboard or API. Set this after creating the price.
export const PRO_PRICE_ID = process.env.NC_STRIPE_PRICE_ID ?? "";

// Success/cancel URLs for Checkout
export const CHECKOUT_SUCCESS_URL =
  process.env.NC_CHECKOUT_SUCCESS_URL ?? "https://noconflict.dev/pro/success";
export const CHECKOUT_CANCEL_URL =
  process.env.NC_CHECKOUT_CANCEL_URL ?? "https://noconflict.dev/pro";
