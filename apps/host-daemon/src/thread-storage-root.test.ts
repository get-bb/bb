import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureThreadStorageRoot,
  threadStorageRootPath,
} from "./thread-storage-root.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { force: true, recursive: true });
    }),
  );
});

describe("thread storage root", () => {
  it("creates the shared thread-storage directory under the host data dir", async () => {
    const dataDir = await makeTempDir("bb-thread-storage-root-");

    const rootPath = await ensureThreadStorageRoot(dataDir);
    const stats = await fs.stat(rootPath);

    expect(rootPath).toBe(threadStorageRootPath(dataDir));
    expect(stats.isDirectory()).toBe(true);
  });

  it("ignores a parent agent thread's ambient storage path", async () => {
    const dataDir = await makeTempDir("bb-thread-storage-root-data-");
    const parentStorageRoot = await makeTempDir(
      "bb-thread-storage-root-parent-",
    );
    vi.stubEnv("BB_THREAD_STORAGE", path.join(parentStorageRoot, "thr_parent"));

    const rootPath = await ensureThreadStorageRoot(dataDir);

    expect(rootPath).toBe(path.join(dataDir, "thread-storage"));
  });
});
