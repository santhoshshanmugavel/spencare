import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Avatar files live in the private `avatars` bucket, path-scoped
 * `avatars/{userId}/{filename}` -- Storage RLS (migration
 * 20260826000001_auth_identity.sql) already enforces per-user isolation,
 * so this uses the caller's OWN session client, not service-role.
 */

export async function uploadAvatar(
  client: TypedSupabaseClient,
  userId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const path = `${userId}/${fileName}`;
  const { error } = await client.storage.from("avatars").upload(path, fileBytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

/** Removes every existing avatar object for this user (called before uploading a replacement, so old files don't accumulate). */
export async function deleteAllAvatarObjects(
  client: TypedSupabaseClient,
  userId: string,
): Promise<void> {
  const { data: files, error: listError } = await client.storage.from("avatars").list(userId);
  if (listError) throw listError;
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${userId}/${f.name}`);
  const { error: removeError } = await client.storage.from("avatars").remove(paths);
  if (removeError) throw removeError;
}

export async function getAvatarSignedUrl(
  client: TypedSupabaseClient,
  path: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const { data, error } = await client.storage
    .from("avatars")
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
