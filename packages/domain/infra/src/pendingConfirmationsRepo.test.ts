import { describe, expect, it } from "vitest";
import { callConfirmCommand } from "./pendingConfirmationsRepo.js";

/**
 * `confirm_command`'s `confirmation_expired` branch returns a structured
 * `{ error: "confirmation_expired" }` body at HTTP 200 instead of raising a
 * Postgres exception (the migration explains why: raising there would have
 * silently rolled back the branch's own `status = 'expired'` update).
 * `callConfirmCommand` is the one place that re-normalizes that shape back
 * into a thrown error so every other caller keeps a single, uniform
 * "confirm rejected" contract.
 */
function fakeRpcClient(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: async () => rpcResult,
  } as never;
}

describe("callConfirmCommand — normalizes the RPC's non-throwing error shape", () => {
  it("throws when the RPC returns a structured { error } body, even though PostgREST reported no error", async () => {
    const client = fakeRpcClient({ data: { error: "confirmation_expired" }, error: null });
    await expect(callConfirmCommand(client, "user-1", "conf-1")).rejects.toThrow("confirmation_expired");
  });

  it("returns the record as-is on a genuine success (no error field)", async () => {
    const client = fakeRpcClient({ data: { id: "txn-1", amount_minor: 500 }, error: null });
    const result = await callConfirmCommand(client, "user-1", "conf-1");
    expect(result).toEqual({ id: "txn-1", amount_minor: 500 });
  });

  it("still throws the real Postgres error for a genuine RPC-level failure (e.g. not_authorized)", async () => {
    const client = fakeRpcClient({ data: null, error: { message: "not_authorized", code: "P0001" } });
    await expect(callConfirmCommand(client, "user-1", "conf-1")).rejects.toMatchObject({ message: "not_authorized" });
  });
});
