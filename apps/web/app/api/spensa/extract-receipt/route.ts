import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { extractReceiptFromImage, ReceiptExtractionCapabilityError } from "@spencare/ai";
import { NoProviderConfiguredError } from "@spencare/ai";

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json() as { attachmentId?: string };
  const { attachmentId } = body;
  if (!attachmentId) {
    return NextResponse.json({ error: "attachmentId is required." }, { status: 400 });
  }

  const serviceSupabase = createServiceRoleSupabaseClient();

  // Verify attachment belongs to this user
  const { data: attachment } = await serviceSupabase
    .from("spensa_attachments" as never)
    .select("id, user_id, storage_path, mime_type, status")
    .eq("id", attachmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!attachment) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  const att = attachment as { id: string; user_id: string; storage_path: string; mime_type: string; status: string };

  if (!SUPPORTED_IMAGE_TYPES.has(att.mime_type)) {
    return NextResponse.json(
      { error: `Receipt extraction supports images only. This file is ${att.mime_type}.` },
      { status: 415 },
    );
  }

  // Mark as processing
  await serviceSupabase
    .from("spensa_attachments" as never)
    .update({ status: "processing", updated_at: new Date().toISOString() } as never)
    .eq("id", attachmentId);

  // Download from storage
  const { data: fileData, error: downloadError } = await serviceSupabase.storage
    .from("spensa-attachments")
    .download(att.storage_path);

  if (downloadError || !fileData) {
    await serviceSupabase
      .from("spensa_attachments" as never)
      .update({ status: "failed", updated_at: new Date().toISOString() } as never)
      .eq("id", attachmentId);
    return NextResponse.json({ error: "Could not read attachment from storage." }, { status: 500 });
  }

  const imageBuffer = await fileData.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString("base64");

  const ctx = {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: serviceSupabase,
  };

  let extraction;
  try {
    extraction = await extractReceiptFromImage(
      ctx,
      imageBase64,
      att.mime_type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
    );
  } catch (err) {
    if (err instanceof NoProviderConfiguredError) {
      await serviceSupabase
        .from("spensa_attachments" as never)
        .update({ status: "failed", updated_at: new Date().toISOString() } as never)
        .eq("id", attachmentId);
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof ReceiptExtractionCapabilityError) {
      await serviceSupabase
        .from("spensa_attachments" as never)
        .update({ status: "failed", updated_at: new Date().toISOString() } as never)
        .eq("id", attachmentId);
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    await serviceSupabase
      .from("spensa_attachments" as never)
      .update({ status: "failed", updated_at: new Date().toISOString() } as never)
      .eq("id", attachmentId);
    return NextResponse.json({ error: "Extraction failed." }, { status: 500 });
  }

  // Save extraction to metadata
  await serviceSupabase
    .from("spensa_attachments" as never)
    .update({
      extraction: extraction as never,
      status: "ready",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", attachmentId);

  return NextResponse.json({ extraction, attachmentId });
}
