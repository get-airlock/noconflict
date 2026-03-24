export type Platform = "vercel" | "railway" | "fly" | "cloudflare" | "netlify" | "docker" | "unknown";

export interface PlatformConfig {
  platform: Platform;
  detectedBy: "config-file" | "convention" | "manual";
  projectName: string | null;
  deployCommand: string | null;
  previewCommand: string | null;
  healthEndpoint: string | null;
  productionUrl: string | null;
}

export type ReadinessCategory = "security" | "stability" | "deployment" | "quality" | "dependencies";

export interface ReadinessFinding {
  category: ReadinessCategory;
  severity: "critical" | "warning" | "info";
  message: string;
  file: string | null;
  line: number | null;
  autoFixable: boolean;
  fixDescription: string | null;
}

export interface ReadinessScore {
  category: ReadinessCategory;
  score: number; // 0-100
  findings: ReadinessFinding[];
}

export interface ReadinessReport {
  scores: ReadinessScore[];
  overall: number; // weighted average 0-100
  totalIssues: number;
  autoFixable: number;
  timestamp: string;
}

export interface DeployRecord {
  id: string;
  timestamp: string;
  platform: Platform;
  commitSha: string;
  branch: string;
  readinessScore: number;
  deployUrl: string | null;
  status: "deploying" | "healthy" | "degraded" | "failed" | "rolled-back";
  healthChecks: HealthCheck[];
}

export interface HealthCheck {
  timestamp: string;
  statusCode: number | null;
  responseTimeMs: number | null;
  healthy: boolean;
  error: string | null;
}

export type ShipZone = "green" | "yellow" | "red";

export interface ShipClassification {
  zone: ShipZone;
  reason: string;
  autoRollback: boolean;
}
