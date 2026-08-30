import { describe, expect, it, vi } from "vitest";
import { checkAndIncrementRateLimit } from "./rateLimitRepo.js";

describe("checkAndIncrementRateLimit", () => {
  it("calls the RPC with the given key/limit/window and returns its boolean result", async () => {
    const rpcSpy = vi.fn(async () => ({ data: true, error: null }));
    const client = { rpc: rpcSpy } as never;

    const result = await checkAndIncrementRateLimit(client, "login:user@example.com", 10, 600);

    expect(rpcSpy).toHaveBeenCalledWith("check_and_increment_rate_limit", {
      p_bucket_key: "login:user@example.com",
      p_max_attempts: 10,
      p_window_seconds: 600,
    });
    expect(result).toBe(true);
  });

  it("returns false when the RPC reports the limit was exceeded", async () => {
    const client = { rpc: async () => ({ data: false, error: null }) } as never;
    expect(await checkAndIncrementRateLimit(client, "login:x@example.com", 10, 600)).toBe(false);
  });

  it("throws when the RPC itself errors", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "boom" } }) } as never;
    await expect(checkAndIncrementRateLimit(client, "login:x@example.com", 10, 600)).rejects.toMatchObject({ message: "boom" });
  });
});
