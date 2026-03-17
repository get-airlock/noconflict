import chalk from "chalk";
import ora from "ora";
import { hasApiKey, isTrialActive } from "../config/store.js";
import { getGit } from "../git/branch-scanner.js";
import { getStagedDiff, getFullDiff } from "../git/diff-analyzer.js";
import { config } from "../config/store.js";
import OpenAI from "openai";

export async function review(): Promise<void> {
  if (!hasApiKey() || !isTrialActive()) {
    console.log(chalk.dim("  nc review requires an active trial or subscription."));
    return;
  }

  const git = await getGit();

  let diff = await getStagedDiff(git);
  if (!diff.trim()) {
    diff = await getFullDiff(git);
  }
  if (!diff.trim()) {
    console.log(chalk.green("  ✓ nothing to review. clean."));
    return;
  }

  const spinner = ora({ text: chalk.dim("reviewing..."), spinner: "dots" }).start();

  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: config.get("apiKey"),
  });

  const resp = await client.chat.completions.create({
    model: config.get("model").fast,
    messages: [
      {
        role: "user",
        content: `You're a senior dev doing a quick pre-push review. Be terse. Only flag real issues — not style preferences. If everything looks good, just say "looks clean."

Diff:
${diff.slice(0, 8000)}

Respond with a short list of issues (if any). Format:
- file:line — issue description

If nothing wrong: "looks clean."`,
      },
    ],
    max_tokens: 300,
    temperature: 0.2,
  });

  spinner.stop();

  const text = resp.choices[0]?.message?.content ?? "looks clean.";

  console.log("");
  if (text.toLowerCase().includes("looks clean")) {
    console.log(chalk.green("  ✓ looks clean."));
  } else {
    console.log(chalk.yellow("  heads up:"));
    console.log("");
    for (const line of text.split("\n").filter(Boolean)) {
      console.log(chalk.white(`  ${line}`));
    }
  }
  console.log("");
}
