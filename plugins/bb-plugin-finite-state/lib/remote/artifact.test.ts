import { describe, expect, it } from "vitest";
import { artifactFromResponse } from "./artifact.js";

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
});
