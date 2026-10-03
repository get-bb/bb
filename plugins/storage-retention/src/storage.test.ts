import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { resolveDevInstanceConfig } from "../../../packages/config/src/runtime.js";
import hostEntry from "./host.js";
import plugin from "./server.js";
import { hostStorageContract } from "./host-contract.js";
import { hostStorageResponseSchema } from "./storage-types.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function directory() {
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bb-storage-plugin-")),
  );
  directories.push(dir);
  return dir;
}

it("clears different threads concurrently, excludes overlapping maintenance and releases locks after success or failure", async () => {
  const threads = ["thr_one", "thr_two"].map((id) =>
    makeThreadResponse({ id, status: "idle", environmentId: "env_test" }),
  );
  const pending = new Map<
    string,
    { resolve: () => void; reject: () => void }
  >();
  let hold = true;
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      if (call.method === "homeDirectory") return "/missing-home";
      if (call.method === "capacity")
        return { totalBytes: 10000, freeBytes: 5000 };
      if (call.method === "measure")
        return {
          targets: [
            {
              outcome: "measured",
              path: "/storage",
              sizeBytes: 2000,
              children: threads.map((thread) => ({
                name: thread.id,
                sizeBytes: 1000,
              })),
            },
          ],
          largeFiles: [],
        };
      if (call.method === "discard") {
        const { names } = hostStorageContract.discard.input.parse(call.input);
        const name = names[0]!;
        if (hold)
          await new Promise<void>((resolve, reject) =>
            pending.set(name, {
              resolve,
              reject: () => reject(new Error("host disconnected")),
            }),
          );
        return { removed: names };
      }
      throw new Error("Unexpected host method");
    },
    sdk: {
      projects: { list: async () => [] },
      hosts: {
        get: async () => ({
          ...makeHostResponse({ id: "host_test", status: "connected" }),
          threadStorageRootPath: "/storage",
        }),
      },
      threads: {
        list: async () => threads,
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            status: "idle",
            environmentId: "env_test",
          }),
        storageLocation: async ({ threadId }) => ({
          hostId: "host_test",
          storageRootPath: `/storage/${threadId}`,
        }),
      },
      environments: { list: async () => [] },
    },
  });
  try {
    plugin(host.bb);
    await host.harness.callRpc("scanHost", { hostId: "host_test" });
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).report?.threadsWithStorageCount,
      )
      .toBe(2);
    const first = host.harness.callRpc("clearThread", { threadId: "thr_one" });
    const second = host.harness.callRpc("clearThread", { threadId: "thr_two" });
    const secondFailure = expect(second).rejects.toThrow("host disconnected");
    await expect.poll(() => pending.size).toBe(2);
    await expect(
      host.harness.callRpc("clearThread", { threadId: "thr_one" }),
    ).rejects.toThrow("already being cleared");
    await expect(
      host.harness.callRpc("removeOrphans", { hostId: "host_test" }),
    ).rejects.toThrow("already running");
    pending.get("thr_one")!.resolve();
    await first;
    await expect(
      host.harness.callRpc("scanHost", { hostId: "host_test" }),
    ).rejects.toThrow("already running");
    expect(
      hostStorageResponseSchema
        .parse(await host.harness.callRpc("host", { hostId: "host_test" }))
        .report?.largestThreads.map((thread) => thread.threadId),
    ).toEqual(["thr_two"]);
    pending.get("thr_two")!.reject();
    await secondFailure;
    hold = false;
    await host.harness.callRpc("clearThread", { threadId: "thr_two" });
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).report?.threadsWithStorageCount,
    ).toBe(0);
    await host.harness.callRpc("scanHost", { hostId: "host_test" });
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).scan.state,
      )
      .toBe("idle");
  } finally {
    for (const work of pending.values()) work.resolve();
    await host.harness.dispose();
  }
});

it.each([false, true])(
  "scans through the host entry, preserves live storage, cleans orphans and clears only stopped threads (detached: %s)",
  async (detached) => {
    const root = await directory();
    const fakeHome = await directory();
    if (!detached) {
      await fs.mkdir(path.join(fakeHome, ".bb-dev", "checkout-a"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(fakeHome, ".bb-dev", "checkout-a", "bb.db"),
        Buffer.alloc(32768),
      );
    }
    if (!detached)
      await fs.writeFile(
        path.join(fakeHome, ".bb-dev", "checkout-a", "bb-dev-instance.json"),
        JSON.stringify({
          repoRoot: path.join(fakeHome, "worktrees", "thr_live-1", "bb"),
        }),
      );
    const size = 11 * 1024 * 1024;
    await fs.mkdir(path.join(root, "thr_live"));
    await fs.writeFile(path.join(root, "thr_live", "data"), Buffer.alloc(size));
    await fs.writeFile(path.join(root, "thr_live", "small.txt"), "keep me");
    await fs.mkdir(path.join(root, ".bb-trash-orphan"));
    await fs.writeFile(
      path.join(root, ".bb-trash-orphan", "data"),
      Buffer.alloc(32768),
    );
    const worker = experimental_createHostEntryHarness(hostEntry);
    let active = true;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      experimental_hostEntry: true,
      experimental_callHostRpc: async (call) => {
        if (call.method === "homeDirectory") return fakeHome;
        if (call.method === "inspectDeveloperEntries")
          return worker.experimental_call(
            "inspectDeveloperEntries",
            hostStorageContract.inspectDeveloperEntries.input.parse(call.input),
          );
        if (call.method === "measure")
          return worker.experimental_call(
            "measure",
            hostStorageContract.measure.input.parse(call.input),
          );
        if (call.method === "capacity")
          return worker.experimental_call(
            "capacity",
            hostStorageContract.capacity.input.parse(call.input),
          );
        if (call.method === "discardLargeFiles")
          return worker.experimental_call(
            "discardLargeFiles",
            hostStorageContract.discardLargeFiles.input.parse(call.input),
          );
        if (call.method === "discard")
          return worker.experimental_call(
            "discard",
            hostStorageContract.discard.input.parse(call.input),
          );
        throw new Error("Unexpected host method");
      },
      sdk: {
        projects: { list: async () => [] },
        hosts: {
          get: async () => ({
            ...makeHostResponse({ id: "host_test", status: "connected" }),
            threadStorageRootPath: root,
          }),
        },
        environments: { list: async () => [] },
        threads: {
          list: async () => [
            makeThreadResponse({
              id: "thr_live",
              status: active ? "active" : "idle",
              archivedAt: 1,
              visibility: "hidden",
            }),
          ],
          get: async () =>
            makeThreadResponse({
              id: "thr_live",
              status: active ? "active" : "idle",
              environmentId: detached ? null : "env_test",
            }),
          storageLocation: async () => {
            if (detached) throw new Error("Thread environment is unavailable");
            return {
              hostId: "host_test",
              storageRootPath: path.join(root, "thr_live"),
            };
          },
        },
      },
    });
    try {
      plugin(host.bb);
      expect(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).toEqual({
        report: null,
        scan: { state: "idle" },
        largeFileCleanup: { state: "idle" },
      });
      await expect(
        host.harness.callRpc("clearThread", { threadId: "thr_live" }),
      ).rejects.toThrow("Stop the thread");
      if (detached) {
        active = false;
        await expect(
          host.harness.callRpc("clearThread", { threadId: "thr_live" }),
        ).rejects.toThrow("Scan the machine");
        expect((await fs.stat(path.join(root, "thr_live", "data"))).size).toBe(
          size,
        );
        active = true;
      }
      await host.harness.callRpc("scanHost", { hostId: "host_test" });
      await expect
        .poll(
          async () =>
            hostStorageResponseSchema.parse(
              await host.harness.callRpc("host", { hostId: "host_test" }),
            ).scan.state,
        )
        .toBe("idle");
      const scanned = hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      );
      expect(scanned.report).toMatchObject({
        threadsWithStorageCount: 1,
        orphanCount: 1,
        hiddenThreads: { activeCount: 0, archivedCount: 1 },
        largestThreads: [{ threadId: "thr_live", hidden: true }],
      });
      if (detached) expect(scanned.report!.developerStorage).toBeNull();
      else {
        expect(path.normalize(scanned.report!.developerStorage!.path)).toBe(
          path.join(fakeHome, ".bb-dev"),
        );
        expect(scanned.report!.developerStorage).toMatchObject({
          entries: [
            {
              name: "checkout-a",
              sourcePath: path.join(fakeHome, "worktrees", "thr_live-1", "bb"),
              sourcePathState: "missing",
              threads: [{ threadId: "thr_live", archived: true }],
            },
          ],
        });
        expect(
          scanned.report!.developerStorage!.sizeBytes,
        ).toBeGreaterThanOrEqual(32768);
        expect(
          scanned.report!.developerStorage!.entries[0]!.sizeBytes,
        ).toBeGreaterThanOrEqual(32768);
      }
      expect(scanned.report!.orphanBytes).toBeGreaterThanOrEqual(32768);
      expect(scanned.report!.disk!.totalBytes).toBeGreaterThan(
        scanned.report!.disk!.freeBytes,
      );
      await host.harness.callRpc("removeOrphans", { hostId: "host_test" });
      await expect
        .poll(async () =>
          fs.stat(path.join(root, ".bb-trash-orphan")).catch(() => null),
        )
        .toBeNull();
      expect((await fs.stat(path.join(root, "thr_live", "data"))).size).toBe(
        size,
      );
      active = false;
      await host.harness.callRpc("clearThread", { threadId: "thr_live" });
      expect(await fs.readdir(path.join(root, "thr_live"))).toEqual([]);
      expect(
        hostStorageResponseSchema.parse(
          await host.harness.callRpc("host", { hostId: "host_test" }),
        ).report,
      ).toMatchObject({
        orphanCount: 0,
        threadsWithStorageCount: 0,
        archivedLargeFiles: { threadCount: 0, fileCount: 0, bytes: 0 },
      });
      await expect
        .poll(() => worker.experimental_getRetainedWorkerLeaseCount())
        .toBe(0);
    } finally {
      await host.harness.dispose();
      await worker.experimental_dispose();
    }
  },
);

it("deletes only large files from archived threads on scanned online machines, keeping small files, pinned and live threads", async () => {
  const root = await directory();
  const large = 11 * 1024 * 1024;
  for (const [name, file, size] of [
    ["thr_live", "dump.db", large],
    ["thr_small", "report.md", 16384],
    ["thr_old", "dump.db", large],
    ["thr_old", "report.md", 16384],
    ["thr_pinned", "dump.db", large],
    ["thr_running", "dump.db", large],
  ] as const) {
    await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, name, file), Buffer.alloc(size, 1));
  }
  let pendingCleanup: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  const worker = experimental_createHostEntryHarness(hostEntry);
  const threads = [
    makeThreadResponse({ id: "thr_live", status: "idle" }),
    makeThreadResponse({ id: "thr_small", status: "idle", archivedAt: 1 }),
    makeThreadResponse({ id: "thr_old", status: "idle", archivedAt: 1 }),
    makeThreadResponse({
      id: "thr_pinned",
      status: "idle",
      archivedAt: 1,
      pinnedAt: 1,
    }),
    makeThreadResponse({ id: "thr_running", status: "active", archivedAt: 1 }),
  ];
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      if (call.method === "homeDirectory") return "/missing-home";
      if (call.method === "measure")
        return worker.experimental_call(
          "measure",
          hostStorageContract.measure.input.parse(call.input),
        );
      if (call.method === "capacity")
        return worker.experimental_call(
          "capacity",
          hostStorageContract.capacity.input.parse(call.input),
        );
      if (call.method === "discardLargeFiles") {
        await new Promise<void>((resolve, reject) => {
          pendingCleanup = { resolve, reject };
        });
        return worker.experimental_call(
          "discardLargeFiles",
          hostStorageContract.discardLargeFiles.input.parse(call.input),
        );
      }
      if (call.method === "discard")
        return worker.experimental_call(
          "discard",
          hostStorageContract.discard.input.parse(call.input),
        );
      throw new Error("Unexpected host method");
    },
    sdk: {
      projects: { list: async () => [] },
      hosts: {
        list: async () => [
          makeHostResponse({ id: "host_test", status: "connected" }),
        ],
        get: async () => ({
          ...makeHostResponse({ id: "host_test", status: "connected" }),
          threadStorageRootPath: root,
        }),
      },
      environments: { list: async () => [] },
      threads: { list: async () => threads },
    },
  });
  try {
    plugin(host.bb);
    await expect(
      host.harness.callRpc("clearArchivedFiles", { hostId: "host_test" }),
    ).rejects.toThrow("Scan the machine");
    await host.harness.callRpc("scanAll", null);
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).report?.archivedLargeFiles,
      )
      .toEqual({ threadCount: 1, fileCount: 1, bytes: large });
    await expect(
      host.harness.callRpc("startClearLargeFiles", { hostId: null }),
    ).resolves.toBeNull();
    await expect.poll(() => pendingCleanup).not.toBeNull();
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).largeFileCleanup.state,
    ).toBe("running");
    await expect(
      host.harness.callRpc("startClearLargeFiles", { hostId: "host_test" }),
    ).rejects.toThrow("already running");
    await expect(
      host.harness.callRpc("scanHost", { hostId: "host_test" }),
    ).rejects.toThrow("already running");
    pendingCleanup!.reject(new Error("host disconnected"));
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).largeFileCleanup,
      )
      .toEqual({ state: "failed", message: "host disconnected" });
    pendingCleanup = null;
    await host.harness.callRpc("startClearLargeFiles", { hostId: "host_test" });
    await expect.poll(() => pendingCleanup).not.toBeNull();
    pendingCleanup!.resolve();
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).largeFileCleanup,
      )
      .toEqual({ state: "completed", clearedFiles: 1, clearedBytes: large });
    pendingCleanup = null;
    await host.harness.callRpc("startClearLargeFiles", { hostId: null });
    expect(pendingCleanup).toBeNull();
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).largeFileCleanup,
    ).toEqual({ state: "completed", clearedFiles: 1, clearedBytes: large });
    expect(
      await host.harness.callRpc("clearLargeFiles", { hostId: null }),
    ).toEqual({ clearedFiles: 0, clearedBytes: 0 });
    expect(await fs.readdir(path.join(root, "thr_old"))).toEqual(["report.md"]);
    expect(await fs.readdir(path.join(root, "thr_pinned"))).toEqual([
      "dump.db",
    ]);
    expect(await fs.readdir(path.join(root, "thr_small"))).toEqual([
      "report.md",
    ]);
    expect(await fs.readdir(path.join(root, "thr_live"))).toEqual(["dump.db"]);
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).report,
    ).toMatchObject({
      threadsWithStorageCount: 5,
      archivedThreadCount: 4,
      archivedLargeFiles: { threadCount: 0, fileCount: 0, bytes: 0 },
    });
    expect(
      await host.harness.callRpc("clearArchivedFiles", { hostId: "host_test" }),
    ).toMatchObject({ clearedThreads: 2 });
    await expect
      .poll(async () => fs.stat(path.join(root, "thr_old")).catch(() => null))
      .toBeNull();
    await expect
      .poll(async () => fs.stat(path.join(root, "thr_small")).catch(() => null))
      .toBeNull();
    for (const name of ["thr_live", "thr_pinned", "thr_running"]) {
      expect((await fs.stat(path.join(root, name, "dump.db"))).size).toBe(
        large,
      );
    }
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).report,
    ).toMatchObject({
      threadsWithStorageCount: 3,
      archivedFiles: { threadCount: 0, bytes: 0 },
      archivedLargeFiles: { threadCount: 0, fileCount: 0, bytes: 0 },
    });
    await expect
      .poll(() => worker.experimental_getRetainedWorkerLeaseCount())
      .toBe(0);
  } finally {
    await host.harness.dispose();
    await worker.experimental_dispose();
  }
});

it.runIf(process.platform !== "win32")(
  "clears large files with newlines and tabs without deleting truncated paths or symlink targets",
  async () => {
    const root = await directory();
    const outside = await directory();
    const target = path.join(root, "thr_test");
    const size = 32768;
    const names = ["large\n20480\tvictim", "tab\tfile"];
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "large"), "keep");
    await fs.writeFile(path.join(outside, "data"), Buffer.alloc(size, 1));
    await fs.symlink(outside, path.join(target, "directory-link"));
    await fs.symlink(
      path.join(outside, "data"),
      path.join(target, "file-link"),
    );
    for (const name of names)
      await fs.writeFile(path.join(target, name), Buffer.alloc(size, 1));
    const worker = experimental_createHostEntryHarness(hostEntry);
    try {
      const result = await worker.experimental_call("discardLargeFiles", {
        rootPath: root,
        names: ["thr_test"],
        minBytes: 16384,
      });
      expect(await fs.readFile(path.join(target, "large"), "utf8")).toBe(
        "keep",
      );
      expect((await fs.stat(path.join(outside, "data"))).size).toBe(size);
      expect(
        (await fs.lstat(path.join(target, "file-link"))).isSymbolicLink(),
      ).toBe(true);
      expect(await fs.readdir(target)).toEqual([
        "directory-link",
        "file-link",
        "large",
      ]);
      expect(result).toEqual({
        removed: [
          {
            name: "thr_test",
            sizeBytes: size * names.length,
            count: names.length,
          },
        ],
      });
    } finally {
      await worker.experimental_dispose();
    }
  },
);

it("rejects traversal and symlinks without deleting their targets", async () => {
  const root = await directory();
  const outside = await directory();
  await fs.writeFile(path.join(outside, "keep"), "keep");
  await fs.symlink(outside, path.join(root, "thr_link"));
  const worker = experimental_createHostEntryHarness(hostEntry);
  try {
    await expect(
      worker.experimental_call("discard", {
        rootPath: root,
        names: ["../escape"],
        recreate: false,
      }),
    ).rejects.toThrow("Invalid storage entry");
    await expect(
      worker.experimental_call("discard", {
        rootPath: root,
        names: ["thr_link"],
        recreate: false,
      }),
    ).rejects.toThrow("symbolic link");
    expect(await fs.readFile(path.join(outside, "keep"), "utf8")).toBe("keep");
    expect(
      await worker.experimental_call("discard", {
        rootPath: root,
        names: ["thr_gone"],
        recreate: false,
      }),
    ).toEqual({ removed: [] });
  } finally {
    await worker.experimental_dispose();
  }
});

it("fails a scan visibly and releases its host lock so it can be retried", async () => {
  let root: string | null = null;
  let fail = true;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      if (call.method === "homeDirectory") return "/missing-home";
      await blocked;
      if (fail) throw new Error("machine disconnected");
      if (call.method === "capacity")
        return { totalBytes: 2048, freeBytes: 1024 };
      return { targets: [], largeFiles: [] };
    },
    sdk: {
      projects: { list: async () => [] },
      hosts: {
        get: async () => ({
          ...makeHostResponse({ id: "host_test", status: "connected" }),
          threadStorageRootPath: root,
        }),
      },
      threads: { list: async () => [] },
      environments: { list: async () => [] },
    },
  });
  try {
    plugin(host.bb);
    await host.harness.callRpc("scanHost", { hostId: "host_test" });
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).scan,
      )
      .toMatchObject({
        state: "failed",
        message: "The machine has not reported its filesystem locations",
      });
    root = "/unused";
    await host.harness.callRpc("scanHost", { hostId: "host_test" });
    await expect(
      host.harness.callRpc("removeOrphans", { hostId: "host_test" }),
    ).rejects.toThrow("already running");
    release();
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).scan.state,
      )
      .toBe("failed");
    fail = false;
    await host.harness.callRpc("scanHost", { hostId: "host_test" });
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).scan.state,
      )
      .toBe("idle");
  } finally {
    release();
    await host.harness.dispose();
  }
});

it("counts distinct live managed worktrees for machine projects, including empty projects and pending cleanup", async () => {
  type Environment = Awaited<
    ReturnType<
      import("@get-bb/plugin-sdk").BbPluginApi["sdk"]["environments"]["list"]
    >
  >[number];
  const base: Environment = {
    id: "env_live",
    name: null,
    projectId: "proj_work",
    hostId: "host_test",
    path: "/work/live",
    isGitRepo: true,
    isWorktree: true,
    branchName: "feature",
    baseBranch: "main",
    defaultBranch: "main",
    mergeBaseBranch: "main",
    status: "ready",
    environmentProviderId: "bb--environment-git-worktree",
    environmentProviderSelection: null,
    environmentProviderInstanceKey: null,
    lifecycle: { phase: "active", retireAt: null, teardown: null },
    hostLifecycle: "active",
    managed: true,
    workspaceProvisionType: "managed-worktree",
    createdAt: 0,
    updatedAt: 0,
  };
  const environments: Environment[] = [
    base,
    { ...base, id: "env_duplicate" },
    {
      ...base,
      id: "env_pending",
      path: "/work/pending",
      lifecycle: {
        phase: "teardown",
        retireAt: 1,
        teardown: {
          status: "failed",
          attempt: 1,
          message: "Permission denied",
        },
      },
    },
    {
      ...base,
      id: "env_destroyed",
      path: "/work/destroyed",
      status: "destroyed",
    },
    {
      ...base,
      id: "env_removed",
      path: "/work/removed",
      lifecycle: {
        phase: "destroyed",
        retireAt: 1,
        teardown: { status: "removed", attempt: 1 },
      },
    },
    { ...base, id: "env_checkout", path: "/work/checkout", isWorktree: false },
    { ...base, id: "env_unmanaged", path: "/work/unmanaged", managed: false },
  ];
  const projects = ["work", "empty", "other"].map((name) => ({
    id: `proj_${name}`,
    name,
    kind: "standard" as const,
    gitRemoteUrl: null,
    createdAt: 0,
    updatedAt: 0,
    sources: [
      {
        id: `src_${name}`,
        projectId: `proj_${name}`,
        type: "local_path" as const,
        hostId: name === "other" ? "host_other" : "host_test",
        path: `/projects/${name}`,
        isDefault: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  }));
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      if (call.method === "homeDirectory") return "/missing-home";
      if (call.method === "capacity")
        return { totalBytes: 2048, freeBytes: 1024 };
      return { targets: [], largeFiles: [] };
    },
    sdk: {
      hosts: {
        get: async () => ({
          ...makeHostResponse({ id: "host_test", status: "connected" }),
          threadStorageRootPath: "/storage",
        }),
      },
      threads: { list: async () => [] },
      projects: { list: async () => projects },
      environments: { list: async () => environments },
    },
  });
  try {
    plugin(host.bb);
    await host.harness.callRpc("scanHost", { hostId: "host_test" });
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).report?.projectWorktrees,
      )
      .toEqual([
        {
          projectId: "proj_work",
          projectName: "work",
          worktreeCount: 2,
          cleanupPendingCount: 1,
        },
        {
          projectId: "proj_empty",
          projectName: "empty",
          worktreeCount: 0,
          cleanupPendingCount: 0,
        },
      ]);
  } finally {
    await host.harness.dispose();
  }
});

it("recovers developer checkout paths from launch records, old runtime records, known paths and verified managed names", async () => {
  const homeDir = await directory();
  const rootPath = path.join(homeDir, ".bb-dev");
  const managed = path.join(
    homeDir,
    ".bb",
    "plugins",
    "environment-git-worktree",
    "host-data",
    "worktrees",
    "thr_gone-1",
    "bb",
  );
  const known = path.join(homeDir, "Mixed Case", "bb");
  const existing = path.join(homeDir, "checkout");
  await fs.mkdir(existing);
  await fs.mkdir(known, { recursive: true });
  const managedName = resolveDevInstanceConfig({
    homeDir,
    repoRoot: managed,
  }).instanceId;
  const knownName = resolveDevInstanceConfig({
    homeDir,
    repoRoot: known,
  }).instanceId;
  const names = [
    "launch",
    "runtime",
    managedName,
    knownName,
    "unidentified",
    managedName.replace(/.$/, "z"),
  ];
  for (const name of names)
    await fs.mkdir(path.join(rootPath, name), { recursive: true });
  await fs.writeFile(
    path.join(rootPath, "launch", "bb-dev-instance.json"),
    JSON.stringify({ repoRoot: existing }),
  );
  await fs.writeFile(
    path.join(rootPath, "runtime", "bb-app-runtime.json"),
    JSON.stringify({
      entryPath: path.join(existing, "scripts", "start-bb.mjs"),
    }),
  );
  await fs.writeFile(
    path.join(rootPath, "unidentified", "bb-dev-instance.json"),
    "{bad json",
  );
  const worker = experimental_createHostEntryHarness(hostEntry);
  try {
    const result = await worker.experimental_call("inspectDeveloperEntries", {
      rootPath,
      names,
      candidatePaths: [known],
    });
    expect(result.entries).toEqual([
      { name: "launch", sourcePath: existing, sourcePathState: "exists" },
      { name: "runtime", sourcePath: existing, sourcePathState: "exists" },
      { name: managedName, sourcePath: managed, sourcePathState: "missing" },
      { name: knownName, sourcePath: known, sourcePathState: "exists" },
      { name: "unidentified", sourcePath: null, sourcePathState: "unknown" },
      { name: names[5], sourcePath: null, sourcePathState: "unknown" },
    ]);
    await expect(
      worker.experimental_call("inspectDeveloperEntries", {
        rootPath,
        names: ["../checkout"],
        candidatePaths: [],
      }),
    ).rejects.toThrow("Invalid developer storage path");
  } finally {
    await worker.experimental_dispose();
  }
});
