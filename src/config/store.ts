import Conf from "conf";
import type { Platform } from "../ship/types.js";

export interface NcIdentity {
  credentialId: string;
  userId: string;
  deviceName: string;
  createdAt: string;
}

export interface NcConfig {
  apiKey: string;
  provider: "openrouter";
  trialStart: string | null;
  trialDays: number;
  activated: boolean;
  model: {
    fast: string;
    smart: string;
  };
  identity: NcIdentity | null;
  ship: {
    platform: Platform | null;
    detectedBy: "config-file" | "convention" | "manual" | null;
    projectName: string | null;
    deployCommand: string | null;
    previewCommand: string | null;
    healthEndpoint: string | null;
    productionUrl: string | null;
    lastDeploy: string | null;
    deployHistory: string;
  };
}

const defaults: NcConfig = {
  apiKey: "",
  provider: "openrouter",
  trialStart: null,
  trialDays: 14,
  activated: false,
  model: {
    fast: "anthropic/claude-haiku-4.5",
    smart: "anthropic/claude-sonnet-4-6",
  },
  identity: null,
  ship: {
    platform: null,
    detectedBy: null,
    projectName: null,
    deployCommand: null,
    previewCommand: null,
    healthEndpoint: null,
    productionUrl: null,
    lastDeploy: null,
    deployHistory: ".noconflict/deploys.json",
  },
};

export const config = new Conf<NcConfig>({
  projectName: "noconflict",
  defaults,
});

export function isTrialActive(): boolean {
  if (config.get("activated")) return true;

  const start = config.get("trialStart");
  if (!start) return false;

  const elapsed = Date.now() - new Date(start).getTime();
  const trialMs = config.get("trialDays") * 24 * 60 * 60 * 1000;
  return elapsed < trialMs;
}

export function trialDaysLeft(): number {
  const start = config.get("trialStart");
  if (!start) return 0;

  const elapsed = Date.now() - new Date(start).getTime();
  const trialMs = config.get("trialDays") * 24 * 60 * 60 * 1000;
  const remaining = trialMs - elapsed;
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

export function hasApiKey(): boolean {
  return config.get("apiKey").length > 0;
}
