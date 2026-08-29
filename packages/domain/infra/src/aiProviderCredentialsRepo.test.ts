import { describe, expect, it, vi } from "vitest";
import { getActiveProviderStatus, replaceActiveCredential, disconnectCredential } from "./aiProviderCredentialsRepo.js";

/**
 * Security-critical structural test (Phase 16 locked security-testing
 * requirement: "credentials never in browser payloads"). The RLS on
 * `ai_provider_credentials` technically permits an owner to select their
 * own `encrypted_api_key` column -- the ONLY thing standing between that
 * and a real client-facing leak is this repo function never asking for it.
 * This test fails loudly if a future edit ever adds that column back to
 * the select list, rather than relying on someone noticing in review.
 */
function fakeClient(selectSpy: (columns: string) => void) {
  return {
    from: () => ({
      select: (columns: string) => {
        selectSpy(columns);
        return {
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      },
    }),
  } as never;
}

describe("getActiveProviderStatus — never selects the encrypted key column", () => {
  it("the select list passed to Supabase never contains encrypted_api_key", async () => {
    let selectedColumns = "";
    const client = fakeClient((columns) => {
      selectedColumns = columns;
    });

    await getActiveProviderStatus(client, "user-1");

    expect(selectedColumns).not.toContain("encrypted_api_key");
    expect(selectedColumns).not.toContain("*");
    expect(selectedColumns).toBe("provider, key_last_four, is_active, last_validated_at, last_validation_error");
  });
});

describe("replaceActiveCredential — Phase 17, calls the atomic replace RPC", () => {
  it("calls the replace_active_ai_provider_credential RPC with the exact expected params, service-role client only", async () => {
    const rpcSpy = vi.fn(async () => ({ data: {}, error: null }));
    const client = { rpc: rpcSpy } as never;

    await replaceActiveCredential(client, "user-1", "anthropic", Buffer.from([0x01, 0x02]), "1234");

    expect(rpcSpy).toHaveBeenCalledWith("replace_active_ai_provider_credential", {
      p_user_id: "user-1",
      p_provider: "anthropic",
      p_encrypted_api_key: "\\x0102",
      p_key_last_four: "1234",
    });
  });

  it("throws when the RPC reports an error, never silently swallowing a failed replace", async () => {
    const client = { rpc: async () => ({ data: null, error: { message: "constraint violation", code: "23505" } }) } as never;
    await expect(replaceActiveCredential(client, "user-1", "anthropic", Buffer.from([0x01]), "1234")).rejects.toMatchObject({ message: "constraint violation" });
  });
});

describe("disconnectCredential — Phase 17, complete purge via the caller's own RLS-scoped client", () => {
  it("deletes the row scoped to the given user_id", async () => {
    const eqSpy = vi.fn(async () => ({ error: null }));
    const deleteSpy = vi.fn(() => ({ eq: eqSpy }));
    const client = { from: () => ({ delete: deleteSpy }) } as never;

    await disconnectCredential(client, "user-1");

    expect(deleteSpy).toHaveBeenCalled();
    expect(eqSpy).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("throws when the delete reports an error", async () => {
    const client = { from: () => ({ delete: () => ({ eq: async () => ({ error: { message: "boom" } }) }) }) } as never;
    await expect(disconnectCredential(client, "user-1")).rejects.toMatchObject({ message: "boom" });
  });
});
