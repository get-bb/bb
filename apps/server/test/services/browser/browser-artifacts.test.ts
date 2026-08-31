import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_SCREENSHOT_MAX_COUNT_PER_THREAD,
  BrowserArtifactStore,
} from "../../../src/services/browser/browser-artifacts.js";

const temporaryDirectories: string[] = [];
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString("base64");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function createStore() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-browser-artifacts-"));
  temporaryDirectories.push(dataDir);
  let now = 0;
  return { dataDir, store: new BrowserArtifactStore(dataDir, () => ++now) };
}

describe("BrowserArtifactStore", () => {
  it("stores opaque thread-confined PNGs and rejects invalid content", async () => {
    const { dataDir, store } = await createStore();
    const metadata = await store.store({ base64: png, targetId: "bt_1", threadId: "thread/../../one" });
    expect(metadata).not.toHaveProperty("base64");
    expect(await store.read({ artifactId: metadata.artifactId, threadId: "thread/../../one" })).toEqual(Buffer.from(png, "base64"));
    await expect(store.read({ artifactId: metadata.artifactId, threadId: "thread_two" })).rejects.toMatchObject({ body: { code: "browser_artifact_not_found" } });
    await expect(store.store({ base64: Buffer.from("not png").toString("base64"), targetId: "bt_1", threadId: "thread_one" })).rejects.toMatchObject({ body: { code: "invalid_request" } });
    expect((await readdir(join(dataDir, "browser-artifacts"))).every((name) => !name.includes("/"))).toBe(true);
  });

  it("rolls back temporary and final files after a partial store failure", async () => {
    const { dataDir } = await createStore();
    let renameCount = 0;
    const store = new BrowserArtifactStore(dataDir, Date.now, {
      renameFile: async (from, to) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error("injected metadata commit failure");
        await rename(from, to);
      },
    });
    await expect(store.store({ base64: png, targetId: "bt_1", threadId: "thread_one" })).rejects.toThrow("injected metadata commit failure");
    const root = join(dataDir, "browser-artifacts", createHash("sha256").update("thread_one").digest("hex"));
    expect(await readdir(root)).toEqual([]);
  });

  it("reconciles stale temporary and unpaired files on restart access", async () => {
    const { dataDir } = await createStore();
    const threadId = "thread_one";
    const root = join(dataDir, "browser-artifacts", createHash("sha256").update(threadId).digest("hex"));
    await mkdir(root, { recursive: true });
    const orphanPng = join(root, "bs_00000000-0000-0000-0000-000000000001.png");
    const orphanMetadata = join(root, "bs_00000000-0000-0000-0000-000000000002.json");
    const staleTemporary = join(root, ".bs_stale.tmp");
    await writeFile(orphanPng, Buffer.from(png, "base64"), { mode: 0o600 });
    await writeFile(orphanMetadata, "{}", { mode: 0o600 });
    await writeFile(staleTemporary, Buffer.from(png, "base64"), { mode: 0o600 });

    const restarted = new BrowserArtifactStore(dataDir);
    const stored = await restarted.store({ base64: png, targetId: "bt_1", threadId });
    expect((await readdir(root)).sort()).toEqual([`${stored.artifactId}.json`, `${stored.artifactId}.png`]);
    expect((await stat(join(root, `${stored.artifactId}.json`))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, `${stored.artifactId}.png`))).mode & 0o777).toBe(0o600);
  });

  it("evicts deterministically oldest-first at the per-thread count bound", async () => {
    const { store } = await createStore();
    const artifacts = [];
    for (let index = 0; index <= BROWSER_SCREENSHOT_MAX_COUNT_PER_THREAD; index += 1) {
      artifacts.push(await store.store({ base64: png, targetId: "bt_1", threadId: "thread_one" }));
    }
    await expect(store.metadata({ artifactId: artifacts[0]!.artifactId, threadId: "thread_one" })).rejects.toMatchObject({ body: { code: "browser_artifact_not_found" } });
    await expect(store.metadata({ artifactId: artifacts[1]!.artifactId, threadId: "thread_one" })).resolves.toEqual(artifacts[1]);
  });
});
