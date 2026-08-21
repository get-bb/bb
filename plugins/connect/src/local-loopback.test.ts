import { describe, expect, it } from "vitest";
import { resolveLocalCloudLoopbackUrl } from "./local-loopback.js";

describe("resolveLocalCloudLoopbackUrl", () => {
  it("targets Vite only for a local source-development pairing", () => {
    expect(
      resolveLocalCloudLoopbackUrl("http://sawyer.localhost:8787", "11001"),
    ).toBe("http://127.0.0.1:11001");
    expect(
      resolveLocalCloudLoopbackUrl("https://sawyer.getbb.app", "11001"),
    ).toBeNull();
    expect(
      resolveLocalCloudLoopbackUrl("http://sawyer.localhost:8787", undefined),
    ).toBeNull();
  });
});
