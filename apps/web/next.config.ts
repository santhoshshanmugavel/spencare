import type { NextConfig } from "next";

/**
 * Phase 26 fix (found live): Next.js's Server Actions default to a 1MB
 * request body limit (node_modules/next/dist/docs/.../serverActions.md
 * §bodySizeLimit) -- this is UNRELATED to and silently overrides any
 * application-level file-size validation. `avatarUploadSchema` and
 * `goalImageUploadSchema` both allow images up to 5MB, but with no
 * override here, any real upload between 1MB-5MB (an entirely ordinary
 * phone-photo size) would fail with a generic 500 ("Body exceeded 1 MB
 * limit") BEFORE ever reaching that validation -- the friendly "Image
 * must be under 5MB" message would never be shown for it. Discovered via
 * this phase's own live browser verification, not by inspection alone.
 * 6mb leaves comfortable headroom over the 5MB ceiling plus
 * multipart/form-data's own boundary/header overhead (a few KB, not the
 * ~1-2KB the docs estimate is enough, kept generous on purpose).
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
