#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticateFromEnv } from "./auth.js";
import { registerReadTools } from "./tools/readTools.js";
import { registerWriteTools } from "./tools/writeTools.js";

/**
 * Spencare MCP server entrypoint (Phase 18).
 *
 * TRANSPORT: stdio. No source document specifies a transport
 * (reconnaissance flagged this explicitly). Chosen because: (1) it is
 * MCP clients' most common local-integration mechanism (Claude Desktop's
 * own configuration format launches servers exactly this way -- a command
 * + args + env, communicating over stdin/stdout); (2) it needs zero new
 * infrastructure -- no HTTP server, no port, no TLS, nothing to deploy or
 * host, matching this repository's actual state (no deployment tooling
 * exists anywhere in this repo for any app); (3) it is the smallest
 * implementation that satisfies Phase 18's stated v1 scope. A
 * Streamable-HTTP/SSE transport would additionally require solving actual
 * hosting, which is explicitly out of scope for this phase.
 *
 * AUTHENTICATION: exactly once, at process startup, before this server
 * ever connects to the transport -- see auth.ts. If it fails, the process
 * logs a safe, clear message to stderr and exits; no tool is ever
 * registered, let alone invoked, against an unauthenticated identity.
 */
async function main() {
  const ctx = await authenticateFromEnv();

  const server = new McpServer({ name: "spencare", version: "0.0.1" });

  registerReadTools(server, ctx);
  registerWriteTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is owned entirely by the MCP transport from this point on --
  // never console.log anything else. Diagnostic output only ever goes to
  // stderr, and never includes the token or its hash.
  console.error(`Spencare MCP server ready (client=${ctx.mcpClientName}, scopes=${ctx.mcpScopes.join(",")}).`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : "Unknown startup error.";
  console.error(`Spencare MCP server failed to start: ${message}`);
  process.exit(1);
});
