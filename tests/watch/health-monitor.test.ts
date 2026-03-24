import { describe, it, expect } from "vitest";
import { checkHealth } from "../../src/watch/health-monitor.js";

describe("health-monitor", () => {
  it("returns unhealthy for unreachable URL", async () => {
    const result = await checkHealth("http://localhost:99999");

    expect(result.healthy).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.statusCode).toBeNull();
  });

  it("returns health check structure with expected fields", async () => {
    const result = await checkHealth("http://localhost:99999");

    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("statusCode");
    expect(result).toHaveProperty("responseTimeMs");
    expect(result).toHaveProperty("healthy");
    expect(typeof result.timestamp).toBe("string");
    expect(typeof result.responseTimeMs).toBe("number");
    expect(typeof result.healthy).toBe("boolean");
  });
});
