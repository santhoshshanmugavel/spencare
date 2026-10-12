import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Plan image files live in the private `plan-images` bucket, path-scoped
 * `plan-images/{userId}/{planId}/{filename}` -- Storage RLS (migration
 * 20261011000001_plan_images.sql) enforces per-user isolation on the first
 * path segment. Mirrors goalImageStorageRepo.ts exactly, substituting
 * `plan-images` for `goal-images`.
 */

export async function uploadPlanImage(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const path = `${userId}/${planId}/${fileName}`;
  const { error } = await client.storage.from("plan-images").upload(path, fileBytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

/** Removes every existing image object for ONE plan — scoped to `{userId}/{planId}`, never the user's other plans. */
export async function deleteAllPlanImageObjects(
  client: TypedSupabaseClient,
  userId: string,
  planId: string,
): Promise<void> {
  const folder = `${userId}/${planId}`;
  const { data: files, error: listError } = await client.storage.from("plan-images").list(folder);
  if (listError) throw listError;
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${folder}/${f.name}`);
  const { error: removeError } = await client.storage.from("plan-images").remove(paths);
  if (removeError) throw removeError;
}

export async function getPlanImageSignedUrl(
  client: TypedSupabaseClient,
  path: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const { data, error } = await client.storage.from("plan-images").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
