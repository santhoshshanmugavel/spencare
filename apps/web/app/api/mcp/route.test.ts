import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeMcpAuthenticationError extends Error {
  constructor(public readonly reason: string) {
    super(`auth error: ${reason}`);
  }
}

const registerReadToolsSpy = vi.fn();
const registerWriteToolsSpy = vi.fn();
const resolveMcpAuthContextFromTokenSpy = vi.fn(async (...args: [string, { url?: string; serviceRoleKey?: string }]) => {
  if (args[0] !== "valid-test-token") throw new FakeMcpAuthenticationError("invalid_token");
  return { userId: "user-1", mcpScopes: ["read"] } as never;
});

vi.mock("@spencare/mcp-server", () => ({
  registerReadTools: registerReadToolsSpy,
  registerWriteTools: registerWriteToolsSpy,
  resolveMcpAuthContextFromToken: resolveMcpAuthContextFromTokenSpy,
  McpAuthenticationError: FakeMcpAuthenticationError,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function mcpRequest(body: unknown, authHeader?: string): Request {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" });
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new Request("http://localhost:3000/api/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } },
};

describe("POST /api/mcp (Phase 22 remote MCP transport)", () => {
  it("rejects a request with no Authorization header, before ever authenticating or registering tools", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(mcpRequest(INITIALIZE_BODY));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("missing_token");
    expect(resolveMcpAuthContextFromTokenSpy).not.toHaveBeenCalled();
    expect(registerReadToolsSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization header the same way as a missing one", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(mcpRequest(INITIALIZE_BODY, "Basic dXNlcjpwYXNz"));
    expect(response.status).toBe(401);
    expect(resolveMcpAuthContextFromTokenSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token and never registers any tool against it", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(mcpRequest(INITIALIZE_BODY, "Bearer wrong-token"));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("invalid_token");
    expect(resolveMcpAuthContextFromTokenSpy).toHaveBeenCalledWith("wrong-token", expect.anything());
    expect(registerReadToolsSpy).not.toHaveBeenCalled();
    expect(registerWriteToolsSpy).not.toHaveBeenCalled();
  });

  it("authenticates a valid bearer token, registers both tool sets, and completes a real MCP initialize handshake", async () => {
    const { POST } = await import("./route.js");
    const response = await POST(mcpRequest(INITIALIZE_BODY, "Bearer valid-test-token"));

    expect(resolveMcpAuthContextFromTokenSpy).toHaveBeenCalledWith("valid-test-token", expect.anything());
    expect(registerReadToolsSpy).toHaveBeenCalledTimes(1);
    expect(registerWriteToolsSpy).toHaveBeenCalledTimes(1);
    // The resolved ctx (never a client-supplied identity) is what both
    // registration calls receive.
    expect(registerReadToolsSpy.mock.calls[0]?.[1]).toEqual({ userId: "user-1", mcpScopes: ["read"] });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.serverInfo).toEqual({ name: "spencare", version: "0.0.1" });
  });

  it("GET and DELETE go through the exact same auth gate as POST", async () => {
    const { GET, DELETE } = await import("./route.js");
    const getResponse = await GET(new Request("http://localhost:3000/api/mcp"));
    const deleteResponse = await DELETE(new Request("http://localhost:3000/api/mcp", { method: "DELETE" }));
    expect(getResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
  });
});
