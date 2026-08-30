import { describe, expect, it, vi } from "vitest";
import { deleteOwnAccount } from "./accountDeletionRepo.js";

describe("deleteOwnAccount", () => {
  it("calls the delete_own_account RPC with the given user id", async () => {
    const rpcSpy = vi.fn(async () => ({ error: null }));
    const client = { rpc: rpcSpy } as never;

    await deleteOwnAccount(client, "user-1");

    expect(rpcSpy).toHaveBeenCalledWith("delete_own_account", { p_user_id: "user-1" });
  });

  it("throws when the RPC reports an error (e.g. not_authorized)", async () => {
    const client = { rpc: async () => ({ error: { message: "not_authorized" } }) } as never;

    await expect(deleteOwnAccount(client, "user-1")).rejects.toMatchObject({ message: "not_authorized" });
  });
});
