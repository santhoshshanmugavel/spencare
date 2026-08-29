import { describe, expect, it } from "vitest";
import { toSafeToolError, mcpErrorFromConfirmResult, McpToolError } from "./errors.js";
import { McpAuthenticationError, McpScopeError } from "./auth.js";

describe("toSafeToolError", () => {
  it("passes an existing McpToolError through unchanged", () => {
    const original = new McpToolError("NOT_FOUND", "gone");
    expect(toSafeToolError(original)).toBe(original);
  });

  it("maps McpAuthenticationError reasons to the right MCP error codes", () => {
    expect(toSafeToolError(new McpAuthenticationError("session_expired")).code).toBe("SESSION_EXPIRED");
    expect(toSafeToolError(new McpAuthenticationError("session_revoked")).code).toBe("SESSION_REVOKED");
    expect(toSafeToolError(new McpAuthenticationError("invalid_token")).code).toBe("AUTHENTICATION_FAILED");
  });

  it("maps McpScopeError to INSUFFICIENT_SCOPE", () => {
    expect(toSafeToolError(new McpScopeError("write")).code).toBe("INSUFFICIENT_SCOPE");
  });

  it("maps a Zod-shaped error to VALIDATION_FAILED without echoing the raw error", () => {
    const zodLike = { issues: [{ path: ["amountMinor"], message: "Expected number" }] };
    const result = toSafeToolError(zodLike);
    expect(result.code).toBe("VALIDATION_FAILED");
    expect(result.message).not.toContain("amountMinor");
  });

  it("maps any unrecognized error to a generic INTERNAL_ERROR, never exposing the raw message", () => {
    const rawDbError = new Error("relation \"accounts\" does not exist, connection string: postgres://user:pass@host/db");
    const result = toSafeToolError(rawDbError);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).not.toContain("postgres://");
    expect(result.message).not.toContain("pass@host");
  });
});

describe("mcpErrorFromConfirmResult", () => {
  it("maps every known confirmCommand error code to its MCP equivalent", () => {
    expect(mcpErrorFromConfirmResult("confirmation_not_found", "x").code).toBe("NOT_FOUND");
    expect(mcpErrorFromConfirmResult("confirmation_not_pending", "x").code).toBe("CONFIRMATION_REPLAYED");
    expect(mcpErrorFromConfirmResult("confirmation_expired", "x").code).toBe("CONFIRMATION_EXPIRED");
    expect(mcpErrorFromConfirmResult("not_authorized", "x").code).toBe("INSUFFICIENT_SCOPE");
  });

  it("falls back to DOMAIN_ERROR for an unrecognized code", () => {
    expect(mcpErrorFromConfirmResult("unknown_error", "x").code).toBe("DOMAIN_ERROR");
  });

  it("preserves the already-safe message confirmCommand produced", () => {
    expect(mcpErrorFromConfirmResult("confirmation_expired", "That proposal has expired.").message).toBe("That proposal has expired.");
  });
});
