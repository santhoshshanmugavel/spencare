import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
]);

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = "spensa-attachments";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const conversationId = (formData.get("conversationId") as string | null) ?? null;

  // Server-side validation — never trust client
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `File type '${file.type}' is not supported. Upload images, PDF, or CSV.` },
      { status: 415 },
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 10 MB.` },
      { status: 413 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty." }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleSupabaseClient();

  // Insert metadata row first (status = uploading)
  const { data: metaRow, error: metaError } = await serviceSupabase
    .from("spensa_attachments" as never)
    .insert({
      user_id: user.id,
      conversation_id: conversationId,
      storage_path: "", // filled in after upload
      original_filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      status: "uploading",
    } as never)
    .select("id")
    .single();

  if (metaError || !metaRow) {
    return NextResponse.json({ error: "Failed to create attachment record." }, { status: 500 });
  }

  const attachmentId = (metaRow as { id: string }).id;
  const storagePath = `${user.id}/${conversationId ?? "no-conversation"}/${attachmentId}/${file.name}`;

  // Upload to Storage using service role (bypasses RLS for the actual upload)
  const fileBuffer = await file.arrayBuffer();
  const { error: uploadError } = await serviceSupabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    // Mark as failed
    await serviceSupabase
      .from("spensa_attachments" as never)
      .update({ status: "failed", updated_at: new Date().toISOString() } as never)
      .eq("id", attachmentId);
    return NextResponse.json({ error: "Storage upload failed." }, { status: 500 });
  }

  // Update metadata with storage path and uploaded status
  await serviceSupabase
    .from("spensa_attachments" as never)
    .update({
      storage_path: storagePath,
      status: "uploaded",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", attachmentId);

  return NextResponse.json({
    attachmentId,
    originalFilename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    status: "uploaded",
  });
}
