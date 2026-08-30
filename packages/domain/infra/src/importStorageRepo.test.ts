import { describe, expect, it, vi } from "vitest";
import { deleteAllStatementObjectsForUser } from "./importStorageRepo.js";

describe("deleteAllStatementObjectsForUser", () => {
  it("does nothing when the user has no statement folders", async () => {
    const listSpy = vi.fn(async () => ({ data: [], error: null }));
    const client = { storage: { from: () => ({ list: listSpy }) } } as never;

    await deleteAllStatementObjectsForUser(client, "user-1");
    expect(listSpy).toHaveBeenCalledWith("user-1");
  });

  it("walks each import-batch folder and removes every file found, using the full two-segment path", async () => {
    const listCalls: string[] = [];
    const removeSpy = vi.fn(async () => ({ error: null }));
    const client = {
      storage: {
        from: () => ({
          list: async (prefix: string) => {
            listCalls.push(prefix);
            if (prefix === "user-1") return { data: [{ name: "batch-1" }, { name: "batch-2" }], error: null };
            if (prefix === "user-1/batch-1") return { data: [{ name: "statement.pdf" }], error: null };
            if (prefix === "user-1/batch-2") return { data: [{ name: "another.csv" }], error: null };
            return { data: [], error: null };
          },
          remove: removeSpy,
        }),
      },
    } as never;

    await deleteAllStatementObjectsForUser(client, "user-1");

    expect(listCalls).toEqual(["user-1", "user-1/batch-1", "user-1/batch-2"]);
    expect(removeSpy).toHaveBeenCalledWith(["user-1/batch-1/statement.pdf", "user-1/batch-2/another.csv"]);
  });

  it("never removes another user's files -- every listed path is scoped under the given userId prefix", async () => {
    const removeSpy = vi.fn(async (_paths: string[]) => ({ error: null }));
    const client = {
      storage: {
        from: () => ({
          list: async (prefix: string) => (prefix === "user-1" ? { data: [{ name: "batch-1" }], error: null } : { data: [{ name: "f.pdf" }], error: null }),
          remove: removeSpy,
        }),
      },
    } as never;

    await deleteAllStatementObjectsForUser(client, "user-1");
    const [removedPaths] = removeSpy.mock.calls[0]!;
    for (const path of removedPaths as string[]) {
      expect(path.startsWith("user-1/")).toBe(true);
    }
  });
});
