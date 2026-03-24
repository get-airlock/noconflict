import type {
  ReadinessReport,
  ReadinessScore,
  ReadinessCategory,
  ReadinessFinding,
} from "./types.js";
import { scanSecurity } from "./scanners/security.js";
import { scanStability } from "./scanners/stability.js";
import { scanDeployment } from "./scanners/deployment.js";
import { scanQuality } from "./scanners/quality.js";
import { scanDependencies } from "./scanners/dependencies.js";

const CATEGORY_WEIGHTS: Record<ReadinessCategory, number> = {
  security: 30,
  stability: 25,
  deployment: 20,
  quality: 15,
  dependencies: 10,
};

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 25,
  warning: 10,
  info: 3,
};

function scoreCategory(
  category: ReadinessCategory,
  findings: ReadinessFinding[]
): ReadinessScore {
  let score = 100;
  for (const f of findings) {
    score -= SEVERITY_DEDUCTIONS[f.severity] ?? 0;
  }
  return {
    category,
    score: Math.max(0, Math.min(100, score)),
    findings,
  };
}

export async function scanReadiness(cwd: string): Promise<ReadinessReport> {
  const scanners: Array<[ReadinessCategory, (cwd: string) => ReadinessFinding[]]> = [
    ["security", scanSecurity],
    ["stability", scanStability],
    ["deployment", scanDeployment],
    ["quality", scanQuality],
    ["dependencies", scanDependencies],
  ];

  const scores: ReadinessScore[] = scanners.map(([category, scanner]) =>
    scoreCategory(category, scanner(cwd))
  );

  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  const overall = Math.round(
    scores.reduce(
      (sum, s) => sum + s.score * CATEGORY_WEIGHTS[s.category],
      0
    ) / totalWeight
  );

  const allFindings = scores.flatMap((s) => s.findings);

  return {
    scores,
    overall: Math.max(0, Math.min(100, overall)),
    totalIssues: allFindings.length,
    autoFixable: allFindings.filter((f) => f.autoFixable).length,
    timestamp: new Date().toISOString(),
  };
}
