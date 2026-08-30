import { describe, expect, it, vi } from "vitest";
import {
  getGmailConnectionStatus,
  upsertGmailConnection,
  revokeGmailConnection,
  getDecryptedConnectionForSync,
  updateGmailSyncCursor,
  tryMarkGmailSyncStarted,
  purgePendingGmailCandidates,
} from "./gmailConnectionsRepo.js";

describe("getGmailConnectionStatus — never selects encrypted_refresh_token", () => {
  it("the select list never contains the encrypted token column or a wildcard", async () => {
    let selectedColumns = "";
    const client = {
      from: () => ({
        select: (columns: string) => {
          selectedColumns = columns;
          return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) };
        },
      }),
    } as never;

    await getGmailConnectionStatus(client, "user-1");

    expect(selectedColumns).not.toContain("encrypted_refresh_token");
    expect(selectedColumns).not.toBe("*");
  });

  it("maps a row to the safe status shape", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "conn-1",
                google_email: "user@gmail.com",
                scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
                sync_status: "idle",
                last_sync_at: null,
                last_sync_error: null,
                candidates_found_last_sync: null,
                connected_at: "2026-08-30T00:00:00Z",
                revoked_at: null,
              },
              error: null,
            }),
          }),
        }),
      }),
    } as never;

    const result = await getGmailConnectionStatus(client, "user-1");
    expect(result).toEqual({
      id: "conn-1",
      googleEmail: "user@gmail.com",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      syncStatus: "idle",
      lastSyncAt: null,
      lastSyncError: null,
      candidatesFoundLastSync: null,
      connectedAt: "2026-08-30T00:00:00Z",
      revokedAt: null,
    });
  });
});

describe("upsertGmailConnection", () => {
  it("upserts on user_id, hex-encodes the encrypted token, and resets sync state for a fresh/re- connection", async () => {
    const upsertSpy = vi.fn((_payload: unknown, _opts: unknown) => ({
      select: () => ({
        single: async () => ({
          data: {
            id: "conn-1",
            google_email: "user@gmail.com",
            scopes: ["scope-a"],
            sync_status: "idle",
            last_sync_at: null,
            last_sync_error: null,
            candidates_found_last_sync: null,
            connected_at: "2026-08-30T00:00:00Z",
            revoked_at: null,
          },
          error: null,
        }),
      }),
    }));
    const client = { from: () => ({ upsert: upsertSpy }) } as never;

    await upsertGmailConnection(client, "user-1", {
      googleEmail: "user@gmail.com",
      encryptedRefreshToken: Buffer.from("secret-bytes"),
      scopes: ["scope-a"],
    });

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        google_email: "user@gmail.com",
        encrypted_refresh_token: expect.stringMatching(/^\\x[0-9a-f]+$/),
        history_id: null,
        sync_status: "idle",
      }),
      { onConflict: "user_id" },
    );
  });
});

describe("revokeGmailConnection", () => {
  it("nulls the encrypted token and sets revoked_at, scoped to the owner's not-yet-revoked row", async () => {
    const isSpy = vi.fn(async () => ({ error: null }));
    const eqUserSpy = vi.fn(() => ({ is: isSpy }));
    const client = { from: () => ({ update: (payload: unknown) => ({ eq: eqUserSpy, __payload: payload }) }) } as never;

    await revokeGmailConnection(client, "user-1");

    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(isSpy).toHaveBeenCalledWith("revoked_at", null);
  });

  it("the update payload nulls encrypted_refresh_token, never leaving it in place", async () => {
    let capturedPayload: Record<string, unknown> = {};
    const client = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          capturedPayload = payload;
          return { eq: () => ({ is: async () => ({ error: null }) }) };
        },
      }),
    } as never;

    await revokeGmailConnection(client, "user-1");
    expect(capturedPayload.encrypted_refresh_token).toBeNull();
    expect(capturedPayload.revoked_at).not.toBeNull();
  });
});

describe("getDecryptedConnectionForSync — service-role only, the one function that reads the encrypted token", () => {
  it("returns null when there is no non-revoked connection", async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) } as never;
    expect(await getDecryptedConnectionForSync(client, "user-1")).toBeNull();
  });

  it("returns null when the connection exists but the token was already nulled (disconnected)", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: { encrypted_refresh_token: null, history_id: null, google_email: "user@gmail.com" }, error: null }),
            }),
          }),
        }),
      }),
    } as never;
    expect(await getDecryptedConnectionForSync(client, "user-1")).toBeNull();
  });

  it("decodes the hex-encoded token back into a Buffer", async () => {
    const hex = Buffer.from("secret-bytes").toString("hex");
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({
                data: { encrypted_refresh_token: `\\x${hex}`, history_id: "12345", google_email: "user@gmail.com" },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as never;

    const result = await getDecryptedConnectionForSync(client, "user-1");
    expect(result?.encryptedRefreshToken.toString()).toBe("secret-bytes");
    expect(result?.historyId).toBe("12345");
  });
});

describe("updateGmailSyncCursor / markGmailSyncStarted / purgePendingGmailCandidates", () => {
  it("updateGmailSyncCursor updates the given user's row with the new cursor/status", async () => {
    const eqSpy = vi.fn(async () => ({ error: null }));
    const client = { from: () => ({ update: () => ({ eq: eqSpy }) }) } as never;

    await updateGmailSyncCursor(client, "user-1", { historyId: "999", syncStatus: "success", lastSyncError: null, candidatesFound: 3 });
    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("tryMarkGmailSyncStarted returns true when the row was not already syncing", async () => {
    const selectSpy = vi.fn(async () => ({ data: [{ id: "conn-1" }], error: null }));
    const neqSpy = vi.fn(() => ({ select: selectSpy }));
    const eqSpy = vi.fn(() => ({ neq: neqSpy }));
    const client = { from: () => ({ update: () => ({ eq: eqSpy }) }) } as never;

    const result = await tryMarkGmailSyncStarted(client, "user-1");
    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(neqSpy).toHaveBeenCalledWith("sync_status", "syncing");
    expect(result).toBe(true);
  });

  it("tryMarkGmailSyncStarted returns false (loses the race) when the row was already syncing -- the WHERE guard matches zero rows", async () => {
    const selectSpy = vi.fn(async () => ({ data: [], error: null }));
    const client = { from: () => ({ update: () => ({ eq: () => ({ neq: () => ({ select: selectSpy }) }) }) }) } as never;

    expect(await tryMarkGmailSyncStarted(client, "user-1")).toBe(false);
  });

  it("purgePendingGmailCandidates only deletes pending-review rows for the given user", async () => {
    const eqStatusSpy = vi.fn(async () => ({ error: null }));
    const eqUserSpy = vi.fn(() => ({ eq: eqStatusSpy }));
    const client = { from: () => ({ delete: () => ({ eq: eqUserSpy }) }) } as never;

    await purgePendingGmailCandidates(client, "user-1");
    expect(eqUserSpy).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqStatusSpy).toHaveBeenCalledWith("review_status", "pending");
  });
});
