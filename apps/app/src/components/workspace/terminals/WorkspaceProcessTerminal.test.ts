import { describe, expect, it } from "vitest";
import { findLatestLoopbackPreviewUrl } from "./WorkspaceProcessTerminal";

describe("findLatestLoopbackPreviewUrl", () => {
  it("returns the latest ANSI-wrapped loopback URL", () => {
    expect(
      findLatestLoopbackPreviewUrl(
        "Local: http://localhost:3000\n\u001b[32mhttp://127.0.0.1:4173/app\u001b[0m",
      ),
    ).toBe("http://127.0.0.1:4173/app");
  });

  it("rejects public and non-HTTP URLs", () => {
    expect(
      findLatestLoopbackPreviewUrl("https://example.com ftp://localhost:21"),
    ).toBeNull();
  });

  it("accepts the complete IPv4 loopback range", () => {
    expect(findLatestLoopbackPreviewUrl("http://127.0.0.2:4173")).toBe(
      "http://127.0.0.2:4173/",
    );
  });
});
