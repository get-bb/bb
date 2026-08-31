import { describe, expect, it } from "vitest";
import { filePreviewContentSecurityPolicy } from "../src/file-response-policy.js";

describe("file preview response policy", () => {
  it.each([
    "text/html",
    "text/html; charset=utf-8",
    "application/xhtml+xml",
    "application/rdf+xml",
    "application/xml",
    "text/xml",
    "text/mathml",
    "image/svg+xml",
  ])("sandboxes active content for %s", (mimeType) => {
    expect(filePreviewContentSecurityPolicy(mimeType)).toBe(
      "sandbox allow-scripts",
    );
  });

  it.each([
    "text/plain",
    "text/markdown",
    "application/pdf",
    "image/png",
    "audio/ogg",
    "video/mp4",
    "application/octet-stream",
  ])("does not sandbox passive content for %s", (mimeType) => {
    expect(filePreviewContentSecurityPolicy(mimeType)).toBeNull();
  });
});
