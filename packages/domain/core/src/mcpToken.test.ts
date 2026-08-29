import { describe, expect, it } from "vitest";
import { generateMcpToken, hashMcpToken } from "./mcpToken.js";

describe("generateMcpToken", () => {
  it("generates a unique, high-entropy, prefixed token each call", () => {
    const a = generateMcpToken();
    const b = generateMcpToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^spc_mcp_/);
    expect(a.length).toBeGreaterThan(40); // 256 bits base64url-encoded, plus prefix
  });
});

describe("hashMcpToken", () => {
  it("is deterministic -- the same token always hashes to the same value", () => {
    const token = generateMcpToken();
    expect(hashMcpToken(token)).toBe(hashMcpToken(token));
  });

  it("different tokens hash to different values", () => {
    const a = generateMcpToken();
    const b = generateMcpToken();
    expect(hashMcpToken(a)).not.toBe(hashMcpToken(b));
  });

  it("never returns the plaintext token itself", () => {
    const token = generateMcpToken();
    const hash = hashMcpToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });

  it("produces a fixed-length hex digest (SHA-256, 64 hex chars)", () => {
    expect(hashMcpToken(generateMcpToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});
