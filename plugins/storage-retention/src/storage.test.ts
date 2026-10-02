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
    const size = 11 * 1024 * 1024;
    await fs.mkdir(path.join(root, "thr_live"));
    await fs.writeFile(path.join(root, "thr_live", "data"), Buffer.alloc(size));
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
      });
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
      await blocked;
      if (fail) throw new Error("machine disconnected");
      if (call.method === "capacity")
        return { totalBytes: 2048, freeBytes: 1024 };
      return { targets: [], largeFiles: [] };
    },
    sdk: {
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
