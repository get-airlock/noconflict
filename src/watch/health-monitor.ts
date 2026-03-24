// Post-deploy health monitoring — Task 8
import type { HealthCheck } from "../ship/types.js";

export async function checkHealth(url: string): Promise<HealthCheck> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });

    const responseTimeMs = Date.now() - start;
    const statusCode = response.status;
    const healthy = statusCode >= 200 && statusCode < 400;

    return {
      timestamp: new Date().toISOString(),
      statusCode,
      responseTimeMs,
      healthy,
      error: healthy ? null : `HTTP ${statusCode}`,
    };
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    const message =
      err instanceof Error ? err.message : "health check failed";

    return {
      timestamp: new Date().toISOString(),
      statusCode: null,
      responseTimeMs,
      healthy: false,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function watchHealth(
  url: string,
  intervalMs: number,
  durationMs: number,
  onCheck: (check: HealthCheck) => void
): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    const check = await checkHealth(url);
    checks.push(check);
    onCheck(check);

    if (!check.healthy) break;

    const remaining = endTime - Date.now();
    if (remaining > intervalMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } else {
      break;
    }
  }

  return checks;
}
