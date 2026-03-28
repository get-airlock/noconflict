import OpenAI from "openai";
import { config } from "../config/store.js";
import type { DiffHunk } from "../git/diff-analyzer.js";
import type { SeverityResult } from "../router/severity.js";

function getClient(): OpenAI {
  const apiKey = config.get("apiKey");
  if (!apiKey) throw new Error("no api key. run nc init first.");

  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  });
}

function pickModel(severity: SeverityResult["level"]): string {
  const models = config.get("model");
  return severity === "red" ? models.smart : models.fast;
}

export interface ForgeResponse {
  explanation: string;
  canAutoResolve: boolean;
  resolution: string | null;
  estimatedHours: number;
}

export async function analyzeConflict(
  severity: SeverityResult,
  hunks: DiffHunk[],
  context: {
    currentBranch: string;
    targetBranch: string;
    recentCommits: string;
  }
): Promise<ForgeResponse> {
  const client = getClient();
  const model = pickModel(severity.level);

  const patchSummary = hunks
    .map(
      (h) =>
        `--- ${h.file} (+${h.additions}/-${h.deletions})\n${h.patch.slice(0, 2000)}`
    )
    .join("\n\n");

  const prompt = `You are a senior developer helping a teammate understand a merge situation. Be direct, brief, and speak like a person — not a robot.

Branch: ${context.currentBranch} → ${context.targetBranch}
Severity: ${severity.level.toUpperCase()} — ${severity.reason}
Files: ${severity.files.join(", ")}
Estimated manual resolution: ~${severity.estimatedMinutes} min

Recent commits on target:
${context.recentCommits}

Diff hunks:
${patchSummary}

Respond with JSON:
{
  "explanation": "1-3 sentences explaining what's happening in plain english. no jargon. name the developers if visible in commits. mention what would be lost.",
  "canAutoResolve": true/false,
  "resolution": "if auto-resolvable, describe what you'd do. otherwise null.",
  "estimatedHours": 0.5
}`;

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.2,
    });

    const text = resp.choices[0]?.message?.content ?? "{}";

    try {
      return JSON.parse(text) as ForgeResponse;
    } catch {
      return {
        explanation: "couldn't parse the conflict. take a look manually.",
        canAutoResolve: false,
        resolution: null,
        estimatedHours: severity.estimatedMinutes / 60,
      };
    }
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new Error("api key invalid or expired. run nc init to set a new key.");
    }
    throw new Error(
      `api error: ${err instanceof Error ? err.message : "unknown"}. check your connection.`
    );
  }
}

export async function chat(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  context: string
): Promise<string> {
  const client = getClient();
  const model = config.get("model").smart;

  const resp = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You are a senior dev helping a teammate with a git situation. Be brief, direct, lowercase energy. No "I'm an AI" — you're just a knowledgeable teammate. You know the repo, the branches, the commits.\n\nContext:\n${context}`,
      },
      ...history,
      { role: "user", content: message },
    ],
    max_tokens: 400,
    temperature: 0.3,
  });

  return resp.choices[0]?.message?.content ?? "hmm, not sure. try nc diff to look manually.";
}
