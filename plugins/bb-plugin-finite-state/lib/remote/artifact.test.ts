import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { artifactFromResponse, materializeRemoteArtifact } from "./artifact.js";

describe("remote artifacts", () => {
  it("streams bytes and rejects wrong media and declared-size mismatch", async () => {
    expect(() => artifactFromResponse({
      service: "platform",
      response: new Response("no", { headers: { "content-type": "text/plain" } }),
      allowedMediaTypes: ["application/json"],
    })).toThrow(expect.objectContaining({ code: "REMOTE_ARTIFACT_MEDIA_TYPE" }));

    const artifact = artifactFromResponse({
      service: "platform",
      response: new Response("abc", {
        headers: { "content-type": "application/octet-stream", "content-length": "4" },
      }),
      allowedMediaTypes: ["application/octet-stream"],
    });
    await expect((async () => {
      for await (const _chunk of artifact.stream()) { /* consume */ }
    })()).rejects.toMatchObject({ code: "REMOTE_ARTIFACT_SIZE_MISMATCH" });
  });

  it("bounds JSON reads without exposing a path", async () => {
    const artifact = artifactFromResponse({
      service: "platform",
      response: Response.json({ ok: true }),
      allowedMediaTypes: ["application/json"],
    });
    await expect(artifact.readJson(2)).rejects.toMatchObject({ code: "REMOTE_ARTIFACT_TOO_LARGE" });
    expect("path" in artifact).toBe(false);
  });

  it("verifies the RFC SHA-256 Digest token case-insensitively", async () => {
    const wrongDigest = createHash("sha256").update("different").digest("base64");
    const artifact = artifactFromResponse({
      service: "platform",
      response: new Response("abc", {
        headers: {
          "content-type": "application/octet-stream",
          Digest: `SHA-256=${wrongDigest}`,
        },
      }),
      allowedMediaTypes: ["application/octet-stream"],
    });
    expect(artifact.sha256).toBe(Buffer.from(wrongDigest, "base64").toString("hex"));
    await expect((async () => {
      for await (const _chunk of artifact.stream()) { /* consume */ }
    })()).rejects.toMatchObject({ code: "REMOTE_ARTIFACT_HASH_MISMATCH" });
  });

  it("normalizes a midstream reset and removes the unpromoted .part file", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        controller.error(new TypeError("connection reset at /secret/path"));
      },
    });
    const artifact = artifactFromResponse({
      service: "platform",
      response: new Response(body, { headers: { "content-type": "application/octet-stream" } }),
      allowedMediaTypes: ["application/octet-stream"],
    });
    const directory = await mkdtemp(join(tmpdir(), "fs-artifact-"));
    const target = join(directory, "firmware.bin");
    await expect(materializeRemoteArtifact(artifact, target)).rejects.toMatchObject({
      code: "REMOTE_ARTIFACT_STREAM_ERROR",
    });
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(directory, { recursive: true });
  });

  it("promotes a fully validated artifact atomically", async () => {
    const artifact = artifactFromResponse({
      service: "platform",
      response: new Response("complete", {
        headers: { "content-type": "application/octet-stream", "content-length": "8" },
      }),
      allowedMediaTypes: ["application/octet-stream"],
    });
    const directory = await mkdtemp(join(tmpdir(), "fs-artifact-"));
    const target = join(directory, "firmware.bin");
    await materializeRemoteArtifact(artifact, target);
    expect(await readFile(target, "utf8")).toBe("complete");
    await expect(stat(`${target}.part`)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(directory, { recursive: true });
  });
});
