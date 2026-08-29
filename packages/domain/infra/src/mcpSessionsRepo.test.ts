import { describe, expect, it, vi } from "vitest";
import { listMcpSessionsForUser, findMcpSessionByTokenHash, revokeMcpSession, insertMcpSession, touchMcpSessionLastUsed } from "./mcpSessionsRepo.js";

describe("listMcpSessionsForUser — never selects token_hash", () => {
  it("the select list never contains token_hash or a wildcard", async () => {
    let selectedColumns = "";
    const client = {
      from: () => ({
        select: (columns: string) => {
          selectedColumns = columns;
          return { eq: () => ({ order: async () => ({ data: [], error: null }) }) };
        },
      }),
    } as never;

    await listMcpSessionsForUser(client, "user-1");

    expect(selectedColumns).not.toContain("token_hash");
    expect(selectedColumns).not.toBe("*");
  });

  it("maps rows to the safe McpSessionStatus shape, dropping user_id/token_hash entirely", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [{ id: "s1", client_name: "Claude Desktop", scopes: ["read"], created_at: "2026-09-05T00:00:00Z", expires_at: null, revoked_at: null, last_used_at: null }],
              error: null,
            }),
          }),
        }),
      }),
    } as never;

    const result = await listMcpSessionsForUser(client, "user-1");
    expect(result).toEqual([{ id: "s1", clientName: "Claude Desktop", scopes: ["read"], createdAt: "2026-09-05T00:00:00Z", expiresAt: null, revokedAt: null, lastUsedAt: null }]);
  });
});

describe("findMcpSessionByTokenHash — service-role only, the one function that reads token_hash", () => {
  it("looks up by token_hash via the service-role client", async () => {
    const eqSpy = vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) }));
    const client = { from: () => ({ select: () => ({ eq: eqSpy }) }) } as never;

    await findMcpSessionByTokenHash(client, "abc123hash");

    expect(eqSpy).toHaveBeenCalledWith("token_hash", "abc123hash");
  });
});

describe("revokeMcpSession — own-row, only-if-still-pending", () => {
  it("scopes the update to the given user and only a not-yet-revoked row", async () => {
    const isSpy = vi.fn(async () => ({ error: null }));
    const eqUserSpy = vi.fn(() => ({ is: isSpy }));
    const eqIdSpy = vi.fn(() => ({ eq: eqUserSpy }));
    const client = { from: () => ({ update: () => ({ eq: eqIdSpy }) }) } as never;

    await revokeMcpSession(client, "user-1", "s1");

    expect(eqIdSpy).toHaveBeenCalledWith("id", "s1");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(isSpy).toHaveBeenCalledWith("revoked_at", null);
  });
});

describe("insertMcpSession", () => {
  it("inserts scoped to the given user with the provided hash/scopes/expiry, never a plaintext token", async () => {
    const insertSpy = vi.fn(() => ({
      select: () => ({
        single: async () => ({
          data: { id: "s1", client_name: "Claude Desktop", scopes: ["read", "write"], created_at: "2026-09-05T00:00:00Z", expires_at: null, revoked_at: null, last_used_at: null },
          error: null,
        }),
      }),
    }));
    const client = { from: () => ({ insert: insertSpy }) } as never;

    const result = await insertMcpSession(client, "user-1", { clientName: "Claude Desktop", tokenHash: "hash-only", scopes: ["read", "write"], expiresAt: null });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", token_hash: "hash-only", scopes: ["read", "write"] }));
    expect(result).not.toHaveProperty("tokenHash");
    expect(result).not.toHaveProperty("token_hash");
  });
});

describe("touchMcpSessionLastUsed", () => {
  it("updates last_used_at for the given session id", async () => {
    const eqSpy = vi.fn(async () => ({ error: null }));
    const client = { from: () => ({ update: () => ({ eq: eqSpy }) }) } as never;

    await touchMcpSessionLastUsed(client, "s1");

    expect(eqSpy).toHaveBeenCalledWith("id", "s1");
  });
});
