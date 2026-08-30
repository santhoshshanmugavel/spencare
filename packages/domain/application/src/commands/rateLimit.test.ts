import { describe, expect, it, vi } from "vitest";

vi.mock("@spencare/domain-infra", () => ({
  checkAndIncrementRateLimit: vi.fn(async () => true),
}));

describe("checkRateLimit", () => {
  it("delegates to checkAndIncrementRateLimit with the named limit's values", async () => {
    const domainInfra = await import("@spencare/domain-infra");
    const { checkRateLimit, RATE_LIMITS } = await import("./rateLimit.js");

    await checkRateLimit({} as never, "login:user@example.com", RATE_LIMITS.LOGIN);

    expect(vi.mocked(domainInfra.checkAndIncrementRateLimit)).toHaveBeenCalledWith({}, "login:user@example.com", 10, 600);
  });

  it("every named limit has a positive maxAttempts and windowSeconds", async () => {
    const { RATE_LIMITS } = await import("./rateLimit.js");
    for (const limit of Object.values(RATE_LIMITS)) {
      expect(limit.maxAttempts).toBeGreaterThan(0);
      expect(limit.windowSeconds).toBeGreaterThan(0);
    }
  });
});
