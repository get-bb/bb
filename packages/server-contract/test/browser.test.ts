import { describe, expect, it } from "vitest";
import {
  browserCommandRequestSchema,
  browserOpenRequestSchema,
  browserPublicCommandResultSchema,
  browserScreenshotArtifactSchema,
} from "../src/index.js";

describe("Browser public contracts", () => {
  it("strictly validates owner context and commands", () => {
    const owner = { callerHostId: "host_1", threadId: "thread_1" };
    expect(browserOpenRequestSchema.safeParse({ ...owner, url: "https://example.test" }).success).toBe(true);
    expect(browserOpenRequestSchema.safeParse({ ...owner, url: "file:///tmp/a" }).success).toBe(false);
    expect(browserCommandRequestSchema.safeParse({ ...owner, command: { kind: "snapshot" }, ignored: true }).success).toBe(false);
  });

  it("exposes screenshot metadata without private image bytes", () => {
    const artifact = {
      artifactId: "bs_12345678-1234-1234-1234-123456789abc",
      byteSize: 100,
      createdAt: 1,
      mimeType: "image/png",
      targetId: "bt_1",
      threadId: "thread_1",
    };
    expect(browserScreenshotArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(browserPublicCommandResultSchema.safeParse({ kind: "screenshot", artifact }).success).toBe(true);
    expect(browserPublicCommandResultSchema.safeParse({ kind: "screenshot", artifact, base64: "secret" }).success).toBe(false);
  });
});
