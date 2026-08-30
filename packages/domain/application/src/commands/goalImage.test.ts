import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types.js";

/**
 * Real magic-byte fixtures -- `sniffImageMimeType` (domain-core, NOT
 * mocked here since it's pure and already unit-tested) must actually
 * recognize these, the same way it would a real upload.
 */
function pngBytes(size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function notAnImage(): Uint8Array {
  return new Uint8Array(Buffer.from("just some plain text, not an image at all"));
}

interface FakeGoal {
  id: string;
  user_id: string;
  image_url: string | null;
  deleted_at: string | null;
}

let goals: Map<string, FakeGoal>;
/** folder ("userId/goalId") -> set of uploaded object paths, mirrors the real bucket's per-goal subfolder. */
let objects: Map<string, Set<string>>;

function reset() {
  goals = new Map([
    ["goal-1", { id: "goal-1", user_id: "user-a", image_url: null, deleted_at: null }],
    ["goal-2", { id: "goal-2", user_id: "user-b", image_url: null, deleted_at: null }],
  ]);
  objects = new Map();
}

vi.mock("@spencare/domain-infra", () => ({
  getGoal: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) return null;
    return { ...row };
  }),
  uploadGoalImage: vi.fn(
    async (_client: unknown, userId: string, goalId: string, fileName: string, _bytes: Uint8Array, _contentType: string) => {
      const folder = `${userId}/${goalId}`;
      const path = `${folder}/${fileName}`;
      if (!objects.has(folder)) objects.set(folder, new Set());
      objects.get(folder)!.add(path);
      return path;
    },
  ),
  deleteAllGoalImageObjects: vi.fn(async (_client: unknown, userId: string, goalId: string) => {
    objects.delete(`${userId}/${goalId}`);
  }),
  updateGoalImageUrl: vi.fn(async (_client: unknown, userId: string, goalId: string, imageUrl: string | null) => {
    const row = goals.get(goalId);
    if (!row || row.user_id !== userId || row.deleted_at) throw new Error("not found");
    row.image_url = imageUrl;
    return { ...row };
  }),
  getGoalImageSignedUrl: vi.fn(async (_client: unknown, path: string) => `https://signed.example/${path}`),
}));

const { updateGoalImage, removeGoalImage } = await import("./goalImage.js");

function makeCtx(userId = "user-a"): AuthContext {
  return {
    userId,
    email: "a@example.com",
    supabase: {} as AuthContext["supabase"],
    serviceRoleSupabase: {} as AuthContext["serviceRoleSupabase"],
  };
}

beforeEach(reset);

describe("updateGoalImage", () => {
  it("uploads a valid PNG and points the goal at it", async () => {
    const result = await updateGoalImage.execute(makeCtx(), {
      goalId: "goal-1",
      fileBytes: pngBytes(),
      declaredMimeType: "image/png",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.signedUrl).toBe("https://signed.example/user-a/goal-1/image.png");
      expect(result.value.goal.image_url).toBe("user-a/goal-1/image.png");
    }
    expect(objects.get("user-a/goal-1")?.has("user-a/goal-1/image.png")).toBe(true);
  });

  it("rejects a file whose bytes don't match any supported image format, regardless of the declared MIME type", async () => {
    const result = await updateGoalImage.execute(makeCtx(), {
      goalId: "goal-1",
      fileBytes: notAnImage(),
      declaredMimeType: "image/png", // lies about what it is
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_file_content");
    expect(goals.get("goal-1")!.image_url).toBeNull();
  });

  it("rejects an oversized file before ever touching storage", async () => {
    const oversized = pngBytes(5 * 1024 * 1024 + 1);
    const result = await updateGoalImage.execute(makeCtx(), {
      goalId: "goal-1",
      fileBytes: oversized,
      declaredMimeType: "image/png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
    expect(objects.get("user-a/goal-1")).toBeUndefined();
  });

  it("rejects a declared MIME type outside the allow-list", async () => {
    const result = await updateGoalImage.execute(makeCtx(), {
      goalId: "goal-1",
      fileBytes: pngBytes(),
      declaredMimeType: "application/pdf",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation_error");
  });

  it("rejects upload to a goal that doesn't belong to the caller (unauthorized / cross-user, IDOR)", async () => {
    const result = await updateGoalImage.execute(makeCtx("user-a"), {
      goalId: "goal-2", // owned by user-b
      fileBytes: pngBytes(),
      declaredMimeType: "image/png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
    // Never even reaches Storage for a goal the caller doesn't own.
    expect(objects.has("user-a/goal-2")).toBe(false);
    expect(objects.has("user-b/goal-2")).toBe(false);
  });

  it("rejects a goal id that doesn't exist at all", async () => {
    const result = await updateGoalImage.execute(makeCtx(), {
      goalId: "no-such-goal",
      fileBytes: pngBytes(),
      declaredMimeType: "image/png",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("replacing an image deletes the previous object(s) for that goal before uploading the new one", async () => {
    await updateGoalImage.execute(makeCtx(), { goalId: "goal-1", fileBytes: pngBytes(), declaredMimeType: "image/png" });
    expect(objects.get("user-a/goal-1")?.size).toBe(1);

    const second = await updateGoalImage.execute(makeCtx(), {
      goalId: "goal-1",
      fileBytes: pngBytes(40),
      declaredMimeType: "image/png",
    });
    expect(second.ok).toBe(true);
    // Still exactly one object for this goal -- the old one was removed,
    // not accumulated alongside the new one.
    expect(objects.get("user-a/goal-1")?.size).toBe(1);
  });

  it("replacing one goal's image never touches a different goal's own image objects", async () => {
    goals.set("goal-3", { id: "goal-3", user_id: "user-a", image_url: null, deleted_at: null });
    await updateGoalImage.execute(makeCtx(), { goalId: "goal-1", fileBytes: pngBytes(), declaredMimeType: "image/png" });
    await updateGoalImage.execute(makeCtx(), { goalId: "goal-3", fileBytes: pngBytes(), declaredMimeType: "image/png" });
    expect(objects.get("user-a/goal-1")?.size).toBe(1);
    expect(objects.get("user-a/goal-3")?.size).toBe(1);

    await updateGoalImage.execute(makeCtx(), { goalId: "goal-1", fileBytes: pngBytes(50), declaredMimeType: "image/png" });
    expect(objects.get("user-a/goal-1")?.size).toBe(1);
    expect(objects.get("user-a/goal-3")?.size).toBe(1); // untouched
  });

  it("is not marked consequential (same non-destructive-metadata classification as updateAvatar)", () => {
    expect(updateGoalImage.consequential).toBe(false);
  });
});

describe("removeGoalImage", () => {
  it("removes the image and clears the goal's pointer", async () => {
    await updateGoalImage.execute(makeCtx(), { goalId: "goal-1", fileBytes: pngBytes(), declaredMimeType: "image/png" });
    const result = await removeGoalImage.execute(makeCtx(), { goalId: "goal-1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.image_url).toBeNull();
    expect(objects.has("user-a/goal-1")).toBe(false);
  });

  it("rejects removal for a goal that doesn't belong to the caller (cross-user, IDOR)", async () => {
    const result = await removeGoalImage.execute(makeCtx("user-a"), { goalId: "goal-2" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });

  it("rejects a missing goal id", async () => {
    const result = await removeGoalImage.execute(makeCtx(), { goalId: "" });
    expect(result.ok).toBe(false);
  });
});
