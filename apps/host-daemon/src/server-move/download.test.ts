import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadVerifiedFile } from "./download.js";
import {
  createRoot,
  exists,
  listen,
  registerServerMoveFixtureCleanup,
} from "./test-fixture.js";

registerServerMoveFixtureCleanup();

const PAYLOAD = Buffer.from("bb-app package bytes");
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");

async function serve(args: {
  contentLength: string | null;
  body?: Buffer;
}): Promise<string> {
  const { url } = await listen((_request, response) => {
    if (args.contentLength !== null) {
      response.setHeader("content-length", args.contentLength);
    }
    response.end(args.body ?? PAYLOAD);
  });
  return `${url}/internal/server-move/move-1/bb-app.tgz`;
}

async function download(args: {
  url: string;
  expectedSizeBytes: number | null;
  maxSizeBytes: number;
}): Promise<string> {
  const destinationPath = join(await createRoot(), "bb-app.tgz");
  await downloadVerifiedFile({
    fetchFn: fetch,
    url: args.url,
    headers: {},
    destinationPath,
    expectedSha256: PAYLOAD_SHA256,
    expectedSizeBytes: args.expectedSizeBytes,
    maxSizeBytes: args.maxSizeBytes,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });
  return destinationPath;
}

describe("downloadVerifiedFile", () => {
  it("uses content-length as the size when the caller has none", async () => {
    const url = await serve({ contentLength: String(PAYLOAD.byteLength) });

    const path = await download({
      url,
      expectedSizeBytes: null,
      maxSizeBytes: 1024,
    });

    expect(await readFile(path)).toEqual(PAYLOAD);
  });

  it("refuses a download that does not report its size", async () => {
    const { url: baseUrl } = await listen((_request, response) => {
      response.write(PAYLOAD);
      response.end();
    });

    await expect(
      download({
        url: `${baseUrl}/internal/server-move/move-1/bb-app.tgz`,
        expectedSizeBytes: null,
        maxSizeBytes: 1024,
      }),
    ).rejects.toMatchObject({
      code: "server_move_download_failed",
      message:
        "Download of /internal/server-move/move-1/bb-app.tgz did not report its size",
    });
  });

  it("refuses a download over the size cap before reading it", async () => {
    const url = await serve({ contentLength: String(PAYLOAD.byteLength) });
    const destinationPath = join(await createRoot(), "bb-app.tgz");

    await expect(
      downloadVerifiedFile({
        fetchFn: fetch,
        url,
        headers: {},
        destinationPath,
        expectedSha256: PAYLOAD_SHA256,
        expectedSizeBytes: null,
        maxSizeBytes: PAYLOAD.byteLength - 1,
        signal: new AbortController().signal,
        onProgress: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "server_move_download_failed",
      message: expect.stringContaining("over the"),
    });
    expect(await exists(destinationPath)).toBe(false);
    expect(await exists(`${destinationPath}.partial`)).toBe(false);
  });

  it("refuses a content-length that disagrees with the expected size", async () => {
    const url = await serve({ contentLength: String(PAYLOAD.byteLength) });

    await expect(
      download({
        url,
        expectedSizeBytes: PAYLOAD.byteLength + 10,
        maxSizeBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toMatchObject({ code: "server_move_digest_mismatch" });
  });
});
