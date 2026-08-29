import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Statement files live in the private `statements` bucket, path-scoped
 * `statements/{userId}/{importBatchId}/{fileName}` (database-
 * architecture.md §9, import-architecture.md §2) -- Storage RLS
 * (migration 20260825043726_storage.sql) already enforces per-user
 * isolation via the first path segment, matching `avatarStorageRepo.ts`'s
 * established pattern (Phase 5) applied to a different bucket. Uses the
 * caller's own session client, not service-role -- the user owns their
 * own upload.
 */

export async function uploadStatementFile(
  client: TypedSupabaseClient,
  userId: string,
  importBatchId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const path = `${userId}/${importBatchId}/${fileName}`;
  const { error } = await client.storage.from("statements").upload(path, fileBytes, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Never a public URL (security-architecture.md's private-bucket requirement) -- only ever a short-lived signed URL for the owner's own review, if the UI ever needs to re-display the original file. Not currently used by the Phase 15 v1 UI (review shows staged rows, not the raw file), kept for API completeness/future use. */
export async function getStatementSignedUrl(
  client: TypedSupabaseClient,
  path: string,
  expiresInSeconds: number = 300,
): Promise<string> {
  const { data, error } = await client.storage.from("statements").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteStatementFile(client: TypedSupabaseClient, path: string): Promise<void> {
  const { error } = await client.storage.from("statements").remove([path]);
  if (error) throw error;
}
