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
      ).toEqual({ report: null, scan: { state: "idle" } });
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
      expect(scanned.report!.largestThreads[0]?.largeFiles).toEqual({
        count: 1,
        bytes: size,
        files: [{ path: "data", sizeBytes: size }],
      });
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
  ] as const) {
    await fs.mkdir(path.join(root, name), { recursive: true });
    await fs.writeFile(path.join(root, name, file), Buffer.alloc(size, 1));
  }
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
    await host.harness.callRpc("scanAll", null);
    await expect
      .poll(
        async () =>
          hostStorageResponseSchema.parse(
            await host.harness.callRpc("host", { hostId: "host_test" }),
          ).report?.archivedLargeFiles,
      )
      .toEqual({ threadCount: 1, fileCount: 1, bytes: large });
    const cleared = await host.harness.callRpc("clearLargeFiles", {
      hostId: null,
    });
    expect(cleared).toEqual({ clearedFiles: 1, clearedBytes: large });
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
      threadsWithStorageCount: 4,
      archivedThreadCount: 3,
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

it("keeps the ten largest file paths while retaining complete totals and reads older scans without file details", async () => {
  const files = Array.from({ length: 13 }, (_, index) => ({
    path: `/storage/thr_old/file-${index}.db`,
    sizeBytes: (index + 11) * 1024 * 1024,
  }));
  const bytes = files.reduce((total, file) => total + file.sizeBytes, 0);
  const host = createFakePluginHost({
    pluginId: "storage-retention",
    experimental_hostEntry: true,
    experimental_callHostRpc: async (call) => {
      if (call.method === "capacity")
        return { totalBytes: bytes * 2, freeBytes: bytes };
      if (call.method === "measure")
        return {
          targets: [
            {
              outcome: "measured",
              path: "/storage",
              sizeBytes: bytes,
              children: [{ name: "thr_old", sizeBytes: bytes }],
            },
          ],
          largeFiles: files,
        };
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
        list: async () => [
          makeThreadResponse({ id: "thr_old", status: "idle", archivedAt: 1 }),
        ],
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
          ).report?.largestThreads[0]?.largeFiles,
      )
      .toEqual({
        count: 13,
        bytes,
        files: files
          .slice(3)
          .reverse()
          .map((file) => ({
            path: file.path.slice("/storage/thr_old/".length),
            sizeBytes: file.sizeBytes,
          })),
      });
    host.bb.storage
      .database()
      .prepare(
        "UPDATE scans SET result_json = json_remove(result_json, '$.largeFiles[0].files') WHERE host_id = ?",
      )
      .run("host_test");
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).report?.largestThreads[0]?.largeFiles,
    ).toEqual({ count: 13, bytes, files: null });
  } finally {
    await host.harness.dispose();
  }
});
