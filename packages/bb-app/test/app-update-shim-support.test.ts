import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatAppUpdateShimLockPath } from "@bb/config/app-update";
import {
  acquireShimLock,
  isSameRevision,
  readLiveShimLock,
} from "../src/app-update/shim-support.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-update-support-"));
  scratchDirs.push(dir);
  return dir;
}

describe("shim lock", () => {
  it("lets only one shim manage a data directory at a time", async () => {
    const dataDir = scratchDir();

    const first = await acquireShimLock(dataDir);
    expect(first).not.toBeNull();
    expect((await readLiveShimLock(dataDir))?.pid).toBe(process.pid);

    writeFileSync(
      formatAppUpdateShimLockPath(dataDir),
      JSON.stringify({
        entryPath: "/usr/bin/bb-app",
        pid: process.ppid,
        startedAt: "2026-09-23T00:00:00.000Z",
      }),
    );
    expect(await acquireShimLock(dataDir)).toBeNull();
  });

  it("takes over a lock left behind by a shim that is gone", async () => {
    const dataDir = scratchDir();
    writeFileSync(
      formatAppUpdateShimLockPath(dataDir),
      JSON.stringify({
        entryPath: "/usr/bin/bb-app",
        pid: 2 ** 22 + 12_345,
        startedAt: "2026-09-23T00:00:00.000Z",
      }),
    );

    const lock = await acquireShimLock(dataDir);

    expect(lock).not.toBeNull();
    expect((await readLiveShimLock(dataDir))?.pid).toBe(process.pid);
    await lock?.release();
    expect(await readLiveShimLock(dataDir)).toBeNull();
  });
});

describe("isSameRevision", () => {
  it("matches an install reached through a symlinked data directory", () => {
    const root = scratchDir();
    const realDataDir = join(root, "real");
    const packageRoot = join(
      realDataDir,
      "app-versions",
      "1.1.0",
      "node_modules",
      "bb-app",
    );
    mkdirSync(packageRoot, { recursive: true });
    symlinkSync(realDataDir, join(root, "linked"));

    expect(
      isSameRevision(
        {
          kind: "npm",
          packageRoot: join(
            root,
            "linked",
            "app-versions",
            "1.1.0",
            "node_modules",
            "bb-app",
          ),
          version: "1.1.0",
        },
        { kind: "npm", packageRoot, version: "1.1.0" },
      ),
    ).toBe(true);
  });
});
