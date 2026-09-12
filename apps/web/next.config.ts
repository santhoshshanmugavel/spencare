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
  // pdfjs-dist (via pdf-parse → @spencare/domain-infra) uses DOMMatrix at
  // module-evaluation time. When bundled by Turbopack into the SSR chunks,
  // the inline code hits `ReferenceError: DOMMatrix is not defined` before
  // any request is served. Marking these packages as external means
  // Next.js emits a require() call that is resolved lazily at call-site
  // instead of inlining the module graph; pdfjs-dist's own polyfill guards
  // (try/catch around @napi-rs/canvas) then run in their original context
  // and degrade gracefully with warnings rather than crashing the Lambda.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
