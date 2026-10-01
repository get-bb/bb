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

it("scans through the host entry, preserves live storage, cleans orphans and clears only stopped threads", async () => {
  const root = await directory();
  await fs.mkdir(path.join(root, "thr_live"));
  await fs.writeFile(path.join(root, "thr_live", "data"), Buffer.alloc(16384));
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
          }),
        ],
        get: async () =>
          makeThreadResponse({
            id: "thr_live",
            status: active ? "active" : "idle",
          }),
        storageLocation: async () => ({
          hostId: "host_test",
          storageRootPath: path.join(root, "thr_live"),
        }),
      },
    },
  });
  try {
    plugin(host.bb);
    expect(await host.harness.callRpc("host", { hostId: "host_test" })).toEqual(
      { report: null, scan: { state: "idle" } },
    );
    await expect(
      host.harness.callRpc("clearThread", { threadId: "thr_live" }),
    ).rejects.toThrow("Stop the thread");
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
      16384,
    );
    active = false;
    await host.harness.callRpc("clearThread", { threadId: "thr_live" });
    expect(await fs.readdir(path.join(root, "thr_live"))).toEqual([]);
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).report,
    ).toMatchObject({ orphanCount: 0, threadsWithStorageCount: 0 });
    await expect
      .poll(() => worker.experimental_getRetainedWorkerLeaseCount())
      .toBe(0);
  } finally {
    await host.harness.dispose();
    await worker.experimental_dispose();
  }
});

it("clears large archived thread storage on scanned online machines, keeping small, pinned and live threads", async () => {
  const root = await directory();
  for (const [name, size] of [
    ["thr_live", 16384],
    ["thr_small", 16384],
    ["thr_old", 101 * 1024 * 1024],
    ["thr_pinned", 101 * 1024 * 1024],
  ] as const) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, "data"), Buffer.alloc(size, 1));
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
          ).report?.clearableArchived.count,
      )
      .toBe(1);
    const cleared = await host.harness.callRpc("clearArchived", {
      hostId: null,
    });
    expect(cleared).toMatchObject({ clearedCount: 1 });
    expect(await fs.readdir(path.join(root, "thr_old"))).toEqual([]);
    expect(await fs.readdir(path.join(root, "thr_pinned"))).toEqual(["data"]);
    expect(await fs.readdir(path.join(root, "thr_small"))).toEqual(["data"]);
    expect(await fs.readdir(path.join(root, "thr_live"))).toEqual(["data"]);
    expect(
      hostStorageResponseSchema.parse(
        await host.harness.callRpc("host", { hostId: "host_test" }),
      ).report,
    ).toMatchObject({
      archivedThreadCount: 2,
      threadsWithStorageCount: 3,
      clearableArchived: { count: 0, bytes: 0 },
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
      return call.method === "capacity"
        ? { totalBytes: 2048, freeBytes: 1024 }
        : { targets: [] };
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
