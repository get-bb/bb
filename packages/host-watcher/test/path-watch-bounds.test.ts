import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import parcelWatcher from "@parcel/watcher";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchPathChanges } from "../src/watch-path.js";

const EVENT_TIMEOUT_MS = 10_000;
const TEST_TIMEOUT_MS = 60_000;
const HEAVY_PACKAGES = 80;
const VISIBLE_DIRECTORIES = [
  "thr_a",
  "thr_a/worktrees",
  "thr_a/worktrees/fix-1",
  "thr_a/worktrees/fix-1/src",
  "thr_b",
  "thr_b/clone",
  "thr_b/clone/src",
  "thr_c",
];
const tempDirs: string[] = [];

function range(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => index);
}

async function buildThreadStorageFixture(): Promise<{
  heavyDirectoryCount: number;
  root: string;
}> {
  const root = fsSync.realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), "bb-path-watch-bounds-")),
  );
  tempDirs.push(root);
  const heavyDirectories = [
    ...range(HEAVY_PACKAGES).map(
      (index) => `thr_a/worktrees/fix-1/node_modules/pkg-${index}/lib`,
    ),
    "thr_a/worktrees/fix-1/.turbo/cache",
    ...range(16).map((index) => `thr_b/clone/.git/objects/${index}`),
    "thr_b/clone/.git/refs/heads",
    ...range(HEAVY_PACKAGES).map(
      (index) => `thr_b/clone/node_modules/pkg-${index}/lib`,
    ),
    ...range(HEAVY_PACKAGES).map(
      (index) => `thr_c/.venv/lib/site-packages/pkg-${index}`,
    ),
  ];
  await Promise.all(
    [...VISIBLE_DIRECTORIES, ...heavyDirectories].map((relativePath) =>
      fs.mkdir(path.join(root, relativePath), { recursive: true }),
    ),
  );
  await fs.writeFile(
    path.join(root, "thr_a", "worktrees", "fix-1", ".git"),
    "gitdir: /nonexistent/.git/worktrees/fix-1\n",
  );
  await fs.writeFile(path.join(root, "thr_a", "report.md"), "report\n");
  return { heavyDirectoryCount: heavyDirectories.length * 2, root };
}

function countInotifyWatches(): number {
  const fdinfoDir = "/proc/self/fdinfo";
  let count = 0;
  for (const fd of fsSync.readdirSync(fdinfoDir)) {
    try {
      const info = fsSync.readFileSync(path.join(fdinfoDir, fd), "utf8");
      count += info
        .split("\n")
        .filter((line) => line.startsWith("inotify wd:")).length;
    } catch {}
  }
  return count;
}

interface StartedPathWatch {
  changedPaths: Set<string>;
  stop: () => Promise<void>;
  watchErrors: string[];
}

function startPathWatch(root: string): StartedPathWatch {
  const changedPaths = new Set<string>();
  const watchErrors: string[] = [];
  const stop = watchPathChanges(root, {
    onChange: (event) => {
      for (const changedPath of event.changedPaths) {
        changedPaths.add(changedPath);
      }
    },
    onWatchError: (error) => {
      watchErrors.push(error.message);
    },
  });
  return { changedPaths, stop, watchErrors };
}

async function waitForChange(
  watch: StartedPathWatch,
  filePath: string,
): Promise<void> {
  await vi.waitFor(
    async () => {
      await fs.writeFile(filePath, `${Date.now()}\n`);
      expect(watch.watchErrors).toEqual([]);
      expect(watch.changedPaths.has(filePath)).toBe(true);
    },
    { timeout: EVENT_TIMEOUT_MS, interval: 200 },
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { force: true, recursive: true });
  }
});

describe("path watch ignores", () => {
  it("subscribes with heavy-tree and git metadata ignores", async () => {
    const { root } = await buildThreadStorageFixture();
    const ignoreLists: string[][] = [];
    vi.spyOn(parcelWatcher, "subscribe").mockImplementation(
      async (_dir, _callback, options) => {
        ignoreLists.push([...(options?.ignore ?? [])]);
        return { unsubscribe: async () => undefined };
      },
    );
    const watch = startPathWatch(root);
    try {
      await vi.waitFor(() => {
        expect(ignoreLists).toHaveLength(1);
      });
      expect(ignoreLists[0]).toEqual([
        "**/{node_modules,.pnpm-store,.venv,venv,.turbo,.next,.cache,__pycache__}/**",
        "**/.git/**",
      ]);
    } finally {
      await watch.stop();
    }
  });
});

describe.skipIf(process.platform !== "linux")(
  "path watch inotify bounds",
  () => {
    it(
      "watches only directories outside heavy trees and git metadata",
      async () => {
        const { heavyDirectoryCount, root } = await buildThreadStorageFixture();
        const baselineWatches = countInotifyWatches();
        const watch = startPathWatch(root);
        try {
          await waitForChange(
            watch,
            path.join(root, "thr_a", "worktrees", "fix-1", "src", "probe.ts"),
          );
          const heavyFile = path.join(
            root,
            "thr_b",
            "clone",
            "node_modules",
            "pkg-0",
            "lib",
            "index.js",
          );
          await fs.writeFile(heavyFile, "changed\n");
          await waitForChange(watch, path.join(root, "thr_c", "probe.md"));

          expect(heavyDirectoryCount).toBeGreaterThan(300);
          expect(countInotifyWatches() - baselineWatches).toBeLessThanOrEqual(
            VISIBLE_DIRECTORIES.length + 1,
          );
          expect(watch.changedPaths.has(heavyFile)).toBe(false);
        } finally {
          await watch.stop();
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
