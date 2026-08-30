/**
 * Library entrypoint (Phase 22) -- the reusable MCP tool-registration and
 * auth pieces, exported for a SECOND transport to build on top of without
 * duplicating any of it (mcp-architecture.md's own instruction: one
 * implementation, multiple transports). `index.ts` (the stdio CLI) is
 * untouched and remains this package's `start` entrypoint; this file
 * changes nothing about it, it only exposes what already existed
 * internally so `apps/web/app/api/mcp/route.ts` (the remote HTTP
 * transport, Phase 22) can register the exact same tools against a
 * per-request-authenticated `McpAuthContext` instead of the
 * once-at-startup one the stdio transport uses.
 */
export { registerReadTools } from "./tools/readTools.js";
export { registerWriteTools } from "./tools/writeTools.js";
export { resolveMcpAuthContextFromToken, authenticateFromToken, McpAuthenticationError, McpScopeError } from "./auth.js";
export { toSafeToolError } from "./errors.js";
