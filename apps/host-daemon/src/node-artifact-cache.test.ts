import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashFile } from "@bb/file-transfer";
import { ensureCachedNodeArtifact } from "./node-artifact-cache.js";

vi.mock("@bb/file-transfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bb/file-transfer")>();
  return { ...actual, hashFile: vi.fn(actual.hashFile) };
});

const ARTIFACT = Buffer.from("export default { ok: true };\n");
const DIGEST = createHash("sha256").update(ARTIFACT).digest("hex");
const roots: string[] = [];

async function* body(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks;
}

async function cacheFixture() {
  const cacheDir = await mkdtemp(join(tmpdir(), "bb-node-artifact-cache-"));
  roots.push(cacheDir);
  const logger = { debug: vi.fn(), warn: vi.fn() };
  return {
    cacheDir,
    ensure: (fetchArtifact: () => Promise<AsyncIterable<Uint8Array>>) =>
      ensureCachedNodeArtifact({
        cacheDir,
        digest: DIGEST,
        byteLength: ARTIFACT.byteLength,
        fileName: "host.mjs",
        fetchArtifact,
        logger,
      }),
    listArtifactDir: () => readdir(join(cacheDir, DIGEST)),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.mocked(hashFile).mockClear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("ensureCachedNodeArtifact", () => {
  it("streams a verified download into the cache", async () => {
    const test = await cacheFixture();
    const artifactPath = await test.ensure(async () =>
      body(ARTIFACT.subarray(0, 5), ARTIFACT.subarray(5)),
    );

    await expect(readFile(artifactPath)).resolves.toEqual(ARTIFACT);
    await expect(test.listArtifactDir()).resolves.toEqual(["host.mjs"]);
  });

  it("retries a corrupt download once, then fails without leaving files", async () => {
    const test = await cacheFixture();
    const corrupt = Buffer.from(ARTIFACT).fill(0x20, 0, 6);
    const fetchArtifact = vi.fn(async () => body(corrupt));

    await expect(test.ensure(fetchArtifact)).rejects.toThrow(
      /failed verification after retry: Host artifact content hash mismatch/u,
    );
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
    await expect(test.listArtifactDir()).resolves.toEqual([]);
  });

  it("recovers when the retried download is intact", async () => {
    const test = await cacheFixture();
    const fetchArtifact = vi
      .fn<() => Promise<AsyncIterable<Uint8Array>>>()
      .mockResolvedValueOnce(body(ARTIFACT.subarray(0, 4)))
      .mockResolvedValueOnce(body(ARTIFACT));

    const artifactPath = await test.ensure(fetchArtifact);
    await expect(readFile(artifactPath)).resolves.toEqual(ARTIFACT);
    await expect(test.listArtifactDir()).resolves.toEqual(["host.mjs"]);
  });

  it("stops reading an oversized download at the expected length", async () => {
    const test = await cacheFixture();
    let emitted = 0;
    let closed = false;
    async function* endless(): AsyncGenerator<Uint8Array> {
      try {
        while (true) {
          emitted += 1;
          yield ARTIFACT;
        }
      } finally {
        closed = true;
      }
    }

    await expect(test.ensure(async () => endless())).rejects.toThrow(
      /received more than/u,
    );
    expect(emitted).toBe(4);
    expect(closed).toBe(true);
    await expect(test.listArtifactDir()).resolves.toEqual([]);
  });

  it("propagates an interrupted download without retrying or leaving files", async () => {
    const test = await cacheFixture();
    async function* interrupted(): AsyncGenerator<Uint8Array> {
      yield ARTIFACT.subarray(0, 4);
      throw new Error("socket hang up");
    }
    const fetchArtifact = vi.fn(async () => interrupted());

    await expect(test.ensure(fetchArtifact)).rejects.toThrow("socket hang up");
    expect(fetchArtifact).toHaveBeenCalledOnce();
    await expect(test.listArtifactDir()).resolves.toEqual([]);
  });

  it("re-hashes a cached artifact only after its file changes", async () => {
    const test = await cacheFixture();
    const fetchArtifact = vi.fn(async () => body(ARTIFACT));
    const artifactPath = await test.ensure(fetchArtifact);

    await test.ensure(fetchArtifact);
    expect(hashFile).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ now: Date.now() + 10_000, toFake: ["Date"] });
    await test.ensure(fetchArtifact);
    await test.ensure(fetchArtifact);
    await test.ensure(fetchArtifact);
    expect(hashFile).toHaveBeenCalledTimes(2);
    expect(fetchArtifact).toHaveBeenCalledOnce();

    await writeFile(artifactPath, Buffer.from(ARTIFACT).fill(0x20, 0, 6));
    await expect(test.ensure(fetchArtifact)).resolves.toBe(artifactPath);
    expect(hashFile).toHaveBeenCalledTimes(3);
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
    await expect(readFile(artifactPath)).resolves.toEqual(ARTIFACT);
  });
});
