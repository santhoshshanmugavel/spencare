/**
 * Content-sniffing for uploaded image files -- verifies the actual byte
 * signature, not just the declared/extension MIME type (security-
 * architecture.md §4 threat-model row "Malicious PDF uploads": "file-type
 * allowlist verified by content sniffing (not just extension)" -- the same
 * principle applied here to avatar image uploads, per Phase 5 §5's
 * "validate file type... prevent arbitrary executable content"). Pure,
 * zero I/O, no Supabase/React -- domain-core-safe.
 */

export type SniffedImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffImageMimeType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}
