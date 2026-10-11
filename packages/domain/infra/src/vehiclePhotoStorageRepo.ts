import type { TypedSupabaseClient } from "./supabaseClients.js";

/**
 * Vehicle photo files live in the private `vehicle-photos` bucket, path-scoped
 * `vehicle-photos/{userId}/{vehicleId}/{filename}` -- Storage RLS (migration
 * 20261011000001_vehicle_photos.sql) already enforces per-user isolation on
 * the first path segment, so this uses the caller's OWN session client,
 * not service-role, same pattern as `goalImageStorageRepo.ts`. Each vehicle
 * gets its own subfolder so replacing one vehicle's photo never touches another.
 */

export async function uploadVehiclePhoto(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
  fileName: string,
  fileBytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const path = `${userId}/${vehicleId}/${fileName}`;
  const { error } = await client.storage.from("vehicle-photos").upload(path, fileBytes, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

/** Removes every existing photo object for ONE vehicle -- scoped to `{userId}/{vehicleId}`. */
export async function deleteAllVehiclePhotoObjects(
  client: TypedSupabaseClient,
  userId: string,
  vehicleId: string,
): Promise<void> {
  const folder = `${userId}/${vehicleId}`;
  const { data: files, error: listError } = await client.storage.from("vehicle-photos").list(folder);
  if (listError) throw listError;
  if (!files || files.length === 0) return;
  const paths = files.map((f) => `${folder}/${f.name}`);
  const { error: removeError } = await client.storage.from("vehicle-photos").remove(paths);
  if (removeError) throw removeError;
}

export async function getVehiclePhotoSignedUrl(
  client: TypedSupabaseClient,
  path: string,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const { data, error } = await client.storage.from("vehicle-photos").createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
