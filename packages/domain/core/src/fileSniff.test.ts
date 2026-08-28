import { describe, expect, it } from "vitest";
import { sniffImageMimeType } from "./fileSniff.js";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("sniffImageMimeType", () => {
  it("identifies a real PNG signature", () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
    expect(sniffImageMimeType(png)).toBe("image/png");
  });

  it("identifies a real JPEG signature", () => {
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(sniffImageMimeType(jpeg)).toBe("image/jpeg");
  });

  it("identifies a real WebP signature (RIFF....WEBP)", () => {
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
    expect(sniffImageMimeType(webp)).toBe("image/webp");
  });

  it("rejects a file whose declared type doesn't match its actual bytes (renamed/spoofed upload)", () => {
    // Plain text content, not a real image, regardless of what a client-supplied
    // Content-Type or filename extension might claim.
    const fakeImage = new TextEncoder().encode("<script>alert(1)</script>\n\n\n");
    expect(sniffImageMimeType(fakeImage)).toBeNull();
  });

  it("rejects an empty/too-short buffer rather than throwing", () => {
    expect(sniffImageMimeType(bytes())).toBeNull();
    expect(sniffImageMimeType(bytes(0x89, 0x50))).toBeNull();
  });

  it("rejects an executable (MZ/ELF header), preventing arbitrary executable content", () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0); // "MZ" DOS/PE header
    expect(sniffImageMimeType(exe)).toBeNull();
  });
});
