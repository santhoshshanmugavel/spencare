import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Goal image files live in the private `goal-images` bucket, path-scoped
 * `goal-images/{userId}/{goalId}/{filename}` -- Storage RLS (migration
 * 20260907000001_goal_images.sql) already enforces per-user isolation on
 * the first path segment, so this uses the caller's OWN session client,
 * not service-role, same pattern as `avatarStorageRepo.ts`. Unlike
 * avatars (one file per user), each goal gets its own subfolder so
 * deleting/replacing one goal's image never touches another goal's.
 */

export async function uploadGoalImage(
  client: TypedSupabaseClient,
  userId: string,
  goalId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const path = `${userId}/${goalId}/${fileName}`;
  const { error } = await client.storage.from("goal-images").upload(path, fileBytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

/** Removes every existing image object for ONE goal (called before uploading a replacement, and when the goal itself is deleted) -- scoped to `{userId}/{goalId}`, never the user's other goals. */
export async function deleteAllGoalImageObjects(
  client: TypedSupabaseClient,
  userId: string,
  goalId: string,
): Promise<void> {
  const folder = `${userId}/${goalId}`;
  const { data: files, error: listError } = await client.storage.from("goal-images").list(folder);
  if (listError) throw listError;
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${folder}/${f.name}`);
  const { error: removeError } = await client.storage.from("goal-images").remove(paths);
  if (removeError) throw removeError;
}

export async function getGoalImageSignedUrl(
  client: TypedSupabaseClient,
  path: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const { data, error } = await client.storage.from("goal-images").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
