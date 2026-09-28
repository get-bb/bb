import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DiskUsageInput } from "./host-contract.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiskUsageError } from "./fs-errors.js";
import { measureDiskUsage, type DiskUsageOptions } from "./disk-usage.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, default: { ...actual } };
});

type MeasureTargets = DiskUsageInput["targets"];

const tempDirs: string[] = [];
const isPosix = process.platform !== "win32";

const duOptions: DiskUsageOptions = {
  duCommand: "du",
  duConcurrency: 4,
  duBatchMaxEntries: 100,
  walkerConcurrency: 8,
};
const walkerOptions: DiskUsageOptions = {
  duCommand: null,
  duConcurrency: 4,
  duBatchMaxEntries: 100,
  walkerConcurrency: 2,
};

async function makeTempDir(): Promise<string> {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bb-disk-usage-test-")),
  );
  tempDirs.push(dir);
  return dir;
}

async function allocatedBytes(...entryPaths: string[]): Promise<number> {
  let total = 0;
  for (const entryPath of entryPaths) {
    const stats = await fs.lstat(entryPath);
    total += process.platform === "win32" ? stats.size : stats.blocks * 512;
  }
  return total;
}

async function writeFile(filePath: string, sizeBytes: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.alloc(sizeBytes, 1));
}

async function writeFakeDu(dir: string, body: string): Promise<string> {
  const scriptPath = path.join(dir, "fake-du");
  await fs.writeFile(scriptPath, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return scriptPath;
}

function measure(
  targets: MeasureTargets,
  options: DiskUsageOptions,
  timeoutMs = 60_000,
) {
  return measureDiskUsage({ targets, timeoutMs }, options);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe.each([
  {
    strategy: "du",
    options: duOptions,
    enabled: isPosix,
    hardLinksSpanChildren: true,
  },
  {
    strategy: "du with one child per batch",
    options: { ...duOptions, duBatchMaxEntries: 1 },
    enabled: isPosix,
    hardLinksSpanChildren: false,
  },
  {
    strategy: "walker",
    options: walkerOptions,
    enabled: true,
    hardLinksSpanChildren: true,
  },
  {
    strategy: "walker after du is not found",
    options: { ...duOptions, duCommand: "/nonexistent/bb-test/du" },
    enabled: isPosix,
    hardLinksSpanChildren: true,
  },
])(
  "measureDiskUsage with $strategy",
  ({ options, enabled, hardLinksSpanChildren }) => {
    it.runIf(enabled)(
      "sums nested directories and breaks a target down per child, including top-level files",
      async () => {
        const root = await makeTempDir();
        const storage = path.join(root, "thread-storage");
        await writeFile(path.join(storage, "thread-a", "notes.md"), 10_000);
        await writeFile(
          path.join(storage, "thread-a", "deep", "nested", "log.txt"),
          50_000,
        );
        await writeFile(path.join(storage, "thread-b", "image.png"), 20_000);
        await writeFile(path.join(storage, "stray.txt"), 3_000);

        const threadA = await allocatedBytes(
          path.join(storage, "thread-a"),
          path.join(storage, "thread-a", "notes.md"),
          path.join(storage, "thread-a", "deep"),
          path.join(storage, "thread-a", "deep", "nested"),
          path.join(storage, "thread-a", "deep", "nested", "log.txt"),
        );
        const threadB = await allocatedBytes(
          path.join(storage, "thread-b"),
          path.join(storage, "thread-b", "image.png"),
        );
        const stray = await allocatedBytes(path.join(storage, "stray.txt"));
        const own = await allocatedBytes(storage);

        const result = await measure(
          [
            { path: storage, perChild: true },
            { path: path.join(storage, "thread-a"), perChild: false },
          ],
          options,
        );

        expect(threadA).toBeGreaterThanOrEqual(60_000);
        expect(result).toEqual({
          targets: [
            {
              outcome: "measured",
              path: storage,
              sizeBytes: own + threadA + threadB + stray,
              children: expect.arrayContaining([
                { name: "thread-a", sizeBytes: threadA },
                { name: "thread-b", sizeBytes: threadB },
                { name: "stray.txt", sizeBytes: stray },
              ]),
            },
            {
              outcome: "measured",
              path: path.join(storage, "thread-a"),
              sizeBytes: threadA,
              children: null,
            },
          ],
        });
        expect(result.targets[0]).toMatchObject({ children: { length: 3 } });
      },
    );

    it.runIf(enabled)(
      "reports missing targets and measures file targets without children",
      async () => {
        const root = await makeTempDir();
        const filePath = path.join(root, "report.html");
        await writeFile(filePath, 5_000);

        const result = await measure(
          [
            { path: path.join(root, "missing"), perChild: true },
            { path: path.join(filePath, "under-a-file"), perChild: false },
            { path: filePath, perChild: true },
          ],
          options,
        );

        expect(result).toEqual({
          targets: [
            { outcome: "missing", path: path.join(root, "missing") },
            { outcome: "missing", path: path.join(filePath, "under-a-file") },
            {
              outcome: "measured",
              path: filePath,
              sizeBytes: await allocatedBytes(filePath),
              children: null,
            },
          ],
        });
      },
    );

    it.runIf(enabled)(
      "counts symlinks themselves without following them",
      async () => {
        const root = await makeTempDir();
        const outside = path.join(root, "outside");
        const target = path.join(root, "target");
        await writeFile(path.join(outside, "big.bin"), 200_000);
        await writeFile(path.join(target, "nested", "small.txt"), 1_000);
        await fs.symlink(outside, path.join(target, "linked-dir"));
        await fs.symlink(
          path.join(outside, "big.bin"),
          path.join(target, "linked-file"),
        );
        await fs.symlink(outside, path.join(target, "nested", "linked-dir"));

        const result = await measure(
          [
            { path: target, perChild: true },
            { path: target, perChild: false },
          ],
          options,
        );

        const linkedDir = await allocatedBytes(path.join(target, "linked-dir"));
        const linkedFile = await allocatedBytes(
          path.join(target, "linked-file"),
        );
        const nested = await allocatedBytes(
          path.join(target, "nested"),
          path.join(target, "nested", "small.txt"),
          path.join(target, "nested", "linked-dir"),
        );
        const total =
          (await allocatedBytes(target)) + linkedDir + linkedFile + nested;
        expect(result.targets).toEqual([
          {
            outcome: "measured",
            path: target,
            sizeBytes: total,
            children: expect.arrayContaining([
              { name: "linked-dir", sizeBytes: linkedDir },
              { name: "linked-file", sizeBytes: linkedFile },
              { name: "nested", sizeBytes: nested },
            ]),
          },
          {
            outcome: "measured",
            path: target,
            sizeBytes: total,
            children: null,
          },
        ]);
        expect(total).toBeLessThan(200_000);
      },
    );

    it.runIf(enabled)(
      "counts a hard-linked file once per target, or per du batch across children",
      async () => {
        const root = await makeTempDir();
        await writeFile(path.join(root, "a", "blob.bin"), 100_000);
        await fs.mkdir(path.join(root, "b"));
        await fs.link(
          path.join(root, "a", "blob.bin"),
          path.join(root, "b", "blob.bin"),
        );
        const blob = await allocatedBytes(path.join(root, "a", "blob.bin"));
        const expected =
          (await allocatedBytes(
            root,
            path.join(root, "a"),
            path.join(root, "b"),
          )) + blob;

        const result = await measure(
          [
            { path: root, perChild: false },
            { path: root, perChild: true },
          ],
          options,
        );

        expect(result.targets).toMatchObject([
          { outcome: "measured", sizeBytes: expected },
          {
            outcome: "measured",
            sizeBytes: hardLinksSpanChildren ? expected : expected + blob,
          },
        ]);
      },
    );

    it.runIf(enabled)("measures wide trees completely", async () => {
      const root = await makeTempDir();
      const entryPaths: string[] = [root];
      for (let dirIndex = 0; dirIndex < 20; dirIndex++) {
        const dir = path.join(root, `dir-${dirIndex}`);
        entryPaths.push(dir);
        for (let fileIndex = 0; fileIndex < 10; fileIndex++) {
          const filePath = path.join(dir, `file-${fileIndex}.txt`);
          await writeFile(filePath, 1_000);
          entryPaths.push(filePath);
        }
      }

      const result = await measure([{ path: root, perChild: false }], options);

      expect(result).toEqual({
        targets: [
          {
            outcome: "measured",
            path: root,
            sizeBytes: await allocatedBytes(...entryPaths),
            children: null,
          },
        ],
      });
    });
  },
);

describe("measureDiskUsage", () => {
  it("shares the filesystem budget across targets and simultaneous requests", async () => {
    const root = await makeTempDir();
    for (let index = 0; index < 24; index++) {
      await writeFile(path.join(root, `child-${index}`, "file.txt"), 1000);
    }
    const originalLstat = fs.lstat;
    const originalReaddir = fs.readdir;
    let active = 0;
    let peak = 0;
    async function trackOperation<T>(run: () => Promise<T>): Promise<T> {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        return await run();
      } finally {
        active--;
      }
    }
    const stat = vi
      .spyOn(fs, "lstat")
      .mockImplementation((...args) =>
        trackOperation(() => originalLstat(...args)),
      );
    const readdir = vi
      .spyOn(fs, "readdir")
      .mockImplementation((...args) =>
        trackOperation(() => originalReaddir(...args)),
      );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        measure(
          [
            { path: root, perChild: true },
            { path: root, perChild: false },
          ],
          { ...walkerOptions, walkerConcurrency: 32 },
        ),
      ),
    );
    expect(stat).toHaveBeenCalled();
    expect(readdir).toHaveBeenCalled();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(active).toBe(0);
  });

  it.runIf(isPosix)(
    "serializes du across simultaneous requests and releases slots",
    async () => {
      const root = await makeTempDir();
      const target = path.join(root, "target");
      await fs.mkdir(target);
      const log = path.join(root, "runs");
      const duCommand = await writeFakeDu(
        root,
        [
          `echo start >> '${log}'`,
          "sleep 0.05",
          `echo end >> '${log}'`,
          'printf "1\\t%s\\n" "$4"',
        ].join("\n"),
      );
      await Promise.all(
        Array.from({ length: 3 }, () =>
          measure(
            [
              { path: target, perChild: false },
              { path: target, perChild: false },
            ],
            { ...duOptions, duCommand },
          ),
        ),
      );
      expect((await fs.readFile(log, "utf8")).trim().split("\n")).toEqual(
        Array.from({ length: 6 }, () => ["start", "end"]).flat(),
      );
    },
  );

  it.runIf(isPosix)(
    "expires queued requests without starting du or delaying later scans",
    async () => {
      const root = await makeTempDir();
      const target = path.join(root, "target");
      await fs.mkdir(target);
      const marker = path.join(root, "started");
      const duCommand = await writeFakeDu(
        root,
        `echo started > '${marker}'\nsleep 0.3\nprintf '1\\t%s\\n' "$4"`,
      );
      const first = measure([{ path: target, perChild: false }], {
        ...duOptions,
        duCommand,
      });
      await expect
        .poll(() => fs.readFile(marker, "utf8").catch(() => ""))
        .toBe("started\n");
      const queuedMarker = path.join(root, "queued");
      const queuedDu = await writeFakeDu(
        await makeTempDir(),
        `echo unexpected > '${queuedMarker}'`,
      );
      await expect(
        measure(
          [{ path: target, perChild: false }],
          { ...duOptions, duCommand: queuedDu },
          20,
        ),
      ).rejects.toMatchObject({ code: "disk_usage_timeout" });
      await first;
      expect(await fs.stat(queuedMarker).catch(() => null)).toBeNull();
      const next = await measure(
        [{ path: target, perChild: false }],
        duOptions,
      );
      expect(next.targets[0]?.outcome).toBe("measured");
    },
  );

  it("rejects relative target paths", async () => {
    await expect(
      measure([{ path: "relative/path", perChild: false }], duOptions),
    ).rejects.toMatchObject({
      constructor: DiskUsageError,
      code: "invalid_path",
    });
  });

  it.runIf(isPosix)(
    "walks entries du does not report and keeps what it does report",
    async () => {
      const root = await makeTempDir();
      const target = path.join(root, "target");
      await writeFile(path.join(target, "a", "file.txt"), 2_000);
      await writeFile(path.join(target, "b", "file.txt"), 30_000);
      await writeFile(path.join(target, "top.txt"), 5_000);
      const duCommand = await writeFakeDu(
        root,
        [
          "operands=0",
          "for operand; do",
          '  if [ "$operands" = 1 ]; then',
          `    case "$operand" in */a) printf '4\t%s\n' "$operand" ;; esac`,
          "  fi",
          '  [ "$operand" = "--" ] && operands=1',
          "done",
          "echo 'du: b: Permission denied' >&2",
          "exit 1",
        ].join("\n"),
      );

      const result = await measure(
        [
          { path: target, perChild: true },
          { path: target, perChild: false },
        ],
        { ...duOptions, duCommand },
      );

      const b = await allocatedBytes(
        path.join(target, "b"),
        path.join(target, "b", "file.txt"),
      );
      const top = await allocatedBytes(path.join(target, "top.txt"));
      const own = await allocatedBytes(target);
      expect(result).toEqual({
        targets: [
          {
            outcome: "measured",
            path: target,
            sizeBytes: own + 4 * 1024 + b + top,
            children: [
              { name: "a", sizeBytes: 4 * 1024 },
              { name: "b", sizeBytes: b },
              { name: "top.txt", sizeBytes: top },
            ],
          },
          {
            outcome: "measured",
            path: target,
            sizeBytes:
              own +
              b +
              top +
              (await allocatedBytes(
                path.join(target, "a"),
                path.join(target, "a", "file.txt"),
              )),
            children: null,
          },
        ],
      });
    },
  );

  it.runIf(isPosix)("fails when du exits abnormally", async () => {
    const root = await makeTempDir();
    await fs.mkdir(path.join(root, "child"));
    const duCommand = await writeFakeDu(
      root,
      "echo 'du: fts_open: Operation not permitted' >&2\nexit 2",
    );

    for (const perChild of [false, true]) {
      await expect(
        measure([{ path: root, perChild }], { ...duOptions, duCommand }),
      ).rejects.toMatchObject({
        constructor: DiskUsageError,
        code: "disk_usage_failed",
        message: `du failed for "${root}" (exit code 2): du: fts_open: Operation not permitted`,
      });
    }
  });

  it.runIf(isPosix)(
    "batches child directories and walks names du output cannot carry",
    async () => {
      const root = await makeTempDir();
      const target = path.join(root, "target");
      for (const name of ["one", "two", "three", "line\nbreak"]) {
        await writeFile(path.join(target, name, "file.txt"), 2_000);
      }
      const argsFile = path.join(root, "args");
      const duCommand = await writeFakeDu(
        root,
        [
          `printf '%s\\0' "$@" >> '${argsFile}'`,
          `printf '\\n' >> '${argsFile}'`,
          "exit 1",
        ].join("\n"),
      );

      const result = await measure([{ path: target, perChild: true }], {
        ...duOptions,
        duCommand,
        duConcurrency: 1,
        duBatchMaxEntries: 2,
      });

      const invocations = (await fs.readFile(argsFile, "utf8"))
        .split("\0\n")
        .filter((invocation) => invocation !== "")
        .map((invocation) => invocation.split("\0"));
      const operands = invocations.flatMap((args) => {
        expect(args.slice(0, 3)).toEqual(["-k", "-s", "--"]);
        return args.slice(3);
      });
      expect(invocations.map((args) => args.length - 3).sort()).toEqual([1, 2]);
      expect(operands.sort()).toEqual(
        ["one", "three", "two"].map((name) => path.join(target, name)),
      );
      const childSize = (name: string) =>
        allocatedBytes(
          path.join(target, name),
          path.join(target, name, "file.txt"),
        );
      expect(result.targets[0]).toMatchObject({
        outcome: "measured",
        children: expect.arrayContaining([
          { name: "line\nbreak", sizeBytes: await childSize("line\nbreak") },
          { name: "one", sizeBytes: await childSize("one") },
        ]),
      });
    },
  );

  it.runIf(isPosix)(
    "kills every running du and fails the command when the timeout elapses",
    async () => {
      const root = await makeTempDir();
      const target = path.join(root, "target");
      for (let index = 0; index < 6; index++) {
        await fs.mkdir(path.join(target, `child-${index}`), {
          recursive: true,
        });
      }
      const pidFile = path.join(root, "du.pid");
      const duCommand = await writeFakeDu(
        root,
        `echo $$ >> '${pidFile}'\nexec sleep 30`,
      );

      const startedAt = Date.now();
      await expect(
        measure(
          [{ path: target, perChild: true }],
          { ...duOptions, duCommand, duBatchMaxEntries: 1 },
          500,
        ),
      ).rejects.toMatchObject({
        constructor: DiskUsageError,
        code: "disk_usage_timeout",
        message: "Disk usage measurement timed out after 500 ms",
      });
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const pids = (await fs.readFile(pidFile, "utf8"))
        .trim()
        .split("\n")
        .map(Number);
      expect(pids).toHaveLength(1);
      await expect
        .poll(() => pids.some(isProcessAlive), { timeout: 2_000 })
        .toBe(false);
    },
  );
});
