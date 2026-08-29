import { McpAuthenticationError, McpScopeError } from "./auth.js";

/**
 * Structured MCP error contract (Phase 18 §18). Every tool handler's
 * thrown error is normalized to exactly one of these codes before it ever
 * reaches the MCP client -- raw database errors, stack traces, and
 * provider/credential material are never exposed.
 */
export type McpErrorCode =
  | "AUTHENTICATION_FAILED"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "INSUFFICIENT_SCOPE"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_REPLAYED"
  | "DOMAIN_ERROR"
  | "INTERNAL_ERROR";

export class McpToolError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

const CONFIRM_ERROR_CODE_MAP: Record<string, McpErrorCode> = {
  confirmation_not_found: "NOT_FOUND",
  confirmation_not_pending: "CONFIRMATION_REPLAYED",
  confirmation_expired: "CONFIRMATION_EXPIRED",
  not_authorized: "INSUFFICIENT_SCOPE",
};

/** Maps the structured {code, message} shape confirmCommand already returns into the MCP error contract. */
export function mcpErrorFromConfirmResult(code: string, message: string): McpToolError {
  return new McpToolError(CONFIRM_ERROR_CODE_MAP[code] ?? "DOMAIN_ERROR", message);
}

/**
 * The one place every tool handler's catch block routes through. Never
 * passes an arbitrary caught error's `.message` straight through -- only
 * errors already constructed as `McpToolError` (deliberately, with a safe
 * message) keep their text; everything else becomes a generic, safe
 * message so a raw Postgres/SDK exception, stack trace, or unexpected
 * detail can never reach an external MCP client.
 */
export function toSafeToolError(err: unknown): McpToolError {
  if (err instanceof McpToolError) return err;
  if (err instanceof McpAuthenticationError) {
    const code: McpErrorCode = err.reason === "session_expired" ? "SESSION_EXPIRED" : err.reason === "session_revoked" ? "SESSION_REVOKED" : "AUTHENTICATION_FAILED";
    return new McpToolError(code, err.message);
  }
  if (err instanceof McpScopeError) return new McpToolError("INSUFFICIENT_SCOPE", err.message);
  if (err && typeof err === "object" && "issues" in err) {
    // Zod validation error shape -- safe to summarize (field paths/expected
    // types), never the raw error object itself.
    return new McpToolError("VALIDATION_FAILED", "That input didn't match the expected shape.");
  }
  return new McpToolError("INTERNAL_ERROR", "Something went wrong. Please try again.");
}
