import { describe, expect, it, vi } from "vitest";
import { getActiveProviderStatus } from "./aiProviderCredentialsRepo.js";

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
