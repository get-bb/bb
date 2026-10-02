import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  diskCapacitySchema,
  hostStorageContract,
  type MeasuredTarget,
} from "./host-contract.js";
import { readThreads } from "./sdk-data.js";
import { LARGE_FILE_MIN_BYTES } from "./rules.js";
import {
  HOST_STORAGE_FILE_DETAILS_LIMIT,
  storageFileSchema,
} from "./storage-types.js";
import type {
  HostStorageReport,
  HostStorageResponse,
  HostStorageScanStatus,
} from "./storage-types.js";

type Thread = Awaited<ReturnType<typeof readThreads>>[number];
type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["list"]>
>[number];
const cachedScanSchema = z.object({
  scannedAt: z.number(),
  disk: diskCapacitySchema.nullable().default(null),
  largeFiles: z
    .array(
      z.object({
        name: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        count: z.number().int().nonnegative(),
        files: z
          .array(storageFileSchema)
          .max(HOST_STORAGE_FILE_DETAILS_LIMIT)
          .nullable()
          .default(null),
      }),
    )
    .default([]),
  entries: z.array(
    z.object({ name: z.string(), sizeBytes: z.number().int().nonnegative() }),
  ),
  worktrees: z.array(
    z.object({
      environmentId: z.string(),
      path: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
});
type Scan = z.infer<typeof cachedScanSchema>;
const clearableArchived = (thread: Thread) =>
  thread.archivedAt !== null &&
  thread.pinnedAt === null &&
  !["starting", "active", "stopping"].includes(thread.status);
const isStorageEntry = (name: string) =>
  /^(thr_[a-zA-Z0-9]+|\.bb-trash-[a-zA-Z0-9_-]+)$/.test(name);

export function createStorage(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE scans (host_id TEXT PRIMARY KEY, result_json TEXT NOT NULL)",
  ]);
  const worker = bb.hosts.experimental_client({
    contract: hostStorageContract,
  });
  const lifecycle = new AbortController();
  const busy = new Set<string>();
  const scans = new Map<string, HostStorageScanStatus>();
  const jobs = new Set<Promise<void>>();
  bb.onDispose(async () => {
    lifecycle.abort();
    await Promise.allSettled(jobs);
  });
  const changed = () => {
    if (!lifecycle.signal.aborted) bb.realtime.publish("changed", null);
  };
  function read(hostId: string): Scan | null {
    const row = db
      .prepare<[string], { result_json: string }>(
        "SELECT result_json FROM scans WHERE host_id = ?",
      )
      .get(hostId);
    return row ? cachedScanSchema.parse(JSON.parse(row.result_json)) : null;
  }
  function store(hostId: string, scan: Scan) {
    db.prepare(
      "INSERT INTO scans (host_id, result_json) VALUES (?, ?) ON CONFLICT(host_id) DO UPDATE SET result_json = excluded.result_json",
    ).run(hostId, JSON.stringify(scan));
    changed();
  }
  async function requireHost(hostId: string, online = false) {
    lifecycle.signal.throwIfAborted();
    const host = await bb.sdk.hosts.get({ hostId });
    if (host.type !== "persistent")
      throw new Error("Storage is only tracked for persistent machines");
    if (online && host.status !== "connected")
      throw new Error("The machine must be online");
  }
  async function storageRoot(hostId: string) {
    const host = await bb.sdk.hosts.get({ hostId });
    if (host.threadStorageRootPath === null)
      throw new Error("The machine has not reported its filesystem locations");
    return host.threadStorageRootPath;
  }
  function acquire(hostId: string) {
    if (busy.has(hostId))
      throw new Error("Storage maintenance is already running on this machine");
    busy.add(hostId);
    return () => {
      busy.delete(hostId);
    };
  }
  async function leftovers(hostId: string, threads: Thread[]) {
    const environments: Environment[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await bb.sdk.environments.list({
        hostId,
        limit: 500,
        offset,
        signal: lifecycle.signal,
      });
      environments.push(...page);
      if (page.length < 500) break;
    }
    const occupied = new Set(
      threads
        .filter(
          (thread) =>
            thread.archivedAt === null ||
            thread.status === "active" ||
            thread.status === "stopping",
        )
        .map((thread) => thread.environmentId),
    );
    return environments.filter(
      (env) =>
        env.managed &&
        env.path !== null &&
        env.status !== "destroyed" &&
        env.lifecycle.teardown?.status !== "removed" &&
        !occupied.has(env.id) &&
        (env.lifecycle.teardown?.status === "failed" ||
          (env.lifecycle.retireAt !== null &&
            env.lifecycle.retireAt < Date.now() - 10 * 60_000)),
    );
  }
  async function report(
    hostId: string,
    scan: Scan,
  ): Promise<HostStorageReport> {
    const threads = await readThreads(bb, lifecycle.signal);
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const environments = new Map(
      (await leftovers(hostId, threads)).map((env) => [env.id, env]),
    );
    const owned = scan.entries.flatMap((entry) => {
      const thread = byId.get(entry.name);
      return thread ? [{ ...entry, thread }] : [];
    });
    const orphans = scan.entries.filter((entry) => !byId.has(entry.name));
    const worktrees = scan.worktrees.flatMap((entry) => {
      const env = environments.get(entry.environmentId);
      return env && env.path === entry.path
        ? [
            {
              ...entry,
              projectId: env.projectId,
              teardownMessage: env.lifecycle.teardown?.message ?? null,
            },
          ]
        : [];
    });
    const sum = (entries: { sizeBytes: number }[]) =>
      entries.reduce((total, entry) => total + entry.sizeBytes, 0);
    const archived = owned.filter((entry) => entry.thread.archivedAt !== null);
    const clearable = scan.largeFiles.filter((entry) => {
      const thread = byId.get(entry.name);
      return thread !== undefined && clearableArchived(thread);
    });
    return {
      hostId,
      scannedAt: scan.scannedAt,
      disk: scan.disk,
      activeThreadBytes: sum(
        owned.filter((entry) => entry.thread.archivedAt === null),
      ),
      archivedThreadBytes: sum(archived),
      orphanBytes: sum(orphans),
      leftoverWorktreeBytes: sum(worktrees),
      threadsWithStorageCount: owned.length,
      archivedThreadCount: archived.length,
      orphanCount: orphans.length,
      archivedLargeFiles: {
        threadCount: clearable.length,
        fileCount: clearable.reduce((total, entry) => total + entry.count, 0),
        bytes: sum(clearable),
      },
      largestThreads: owned
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 20)
        .map(({ thread, sizeBytes }) => {
          const large = scan.largeFiles.find(
            (entry) => entry.name === thread.id,
          );
          return {
            threadId: thread.id,
            projectId: thread.projectId,
            title: thread.title ?? thread.titleFallback ?? thread.id,
            archivedAt: thread.archivedAt,
            updatedAt: thread.updatedAt,
            running: ["starting", "active", "stopping"].includes(thread.status),
            sizeBytes,
            largeFiles: {
              count: large?.count ?? 0,
              bytes: large?.sizeBytes ?? 0,
              files: large ? large.files : [],
            },
          };
        }),
      leftoverWorktrees: worktrees,
    };
  }
  async function host({
    hostId,
  }: {
    hostId: string;
  }): Promise<HostStorageResponse> {
    await requireHost(hostId);
    const cached = read(hostId);
    return {
      report: cached ? await report(hostId, cached) : null,
      scan: scans.get(hostId) ?? { state: "idle" },
    };
  }
  async function hosts() {
    lifecycle.signal.throwIfAborted();
    const machines = await bb.sdk.hosts.list({ type: "persistent" });
    return {
      hosts: await Promise.all(
        machines.map(async (machine) => ({
          hostId: machine.id,
          ...(await host({ hostId: machine.id })),
        })),
      ),
    };
  }
  async function scanHost({ hostId }: { hostId: string }) {
    await requireHost(hostId, true);
    if (scans.get(hostId)?.state === "scanning") return host({ hostId });
    const release = acquire(hostId);
    scans.set(hostId, { state: "scanning", startedAt: Date.now() });
    changed();
    const job = (async () => {
      try {
        const [rootPath, threads] = await Promise.all([
          storageRoot(hostId),
          readThreads(bb, lifecycle.signal),
        ]);
        const environments = await leftovers(hostId, threads);
        const disk = await worker.call(
          "capacity",
          { path: rootPath },
          { hostId, signal: lifecycle.signal },
        );
        const measured = new Map<string, MeasuredTarget>();
        const largeFiles = new Map<
          string,
          {
            sizeBytes: number;
            count: number;
            files: z.infer<typeof storageFileSchema>[];
          }
        >();
        const batches: {
          targets: { path: string; perChild: boolean }[];
          largeFileMinBytes: number | null;
        }[] = [
          {
            targets: [{ path: rootPath, perChild: true }],
            largeFileMinBytes: LARGE_FILE_MIN_BYTES,
          },
        ];
        const worktreeTargets = environments.flatMap((env) =>
          env.path === null ? [] : [{ path: env.path, perChild: false }],
        );
        for (let offset = 0; offset < worktreeTargets.length; offset += 500)
          batches.push({
            targets: worktreeTargets.slice(offset, offset + 500),
            largeFileMinBytes: null,
          });
        for (const batch of batches) {
          const result = await worker.call(
            "measure",
            { ...batch, timeoutMs: 29 * 60_000 },
            { hostId, timeoutMs: 30 * 60_000, signal: lifecycle.signal },
          );
          lifecycle.signal.throwIfAborted();
          for (const target of result.targets)
            measured.set(target.path, target);
          for (const file of result.largeFiles) {
            const [name] = file.path.slice(rootPath.length + 1).split(/[\\/]/);
            if (
              !file.path.startsWith(rootPath) ||
              name === undefined ||
              !isStorageEntry(name)
            )
              continue;
            const total = largeFiles.get(name) ?? {
              sizeBytes: 0,
              count: 0,
              files: [],
            };
            total.sizeBytes += file.sizeBytes;
            total.count++;
            total.files.push({
              path: file.path.slice(rootPath.length + name.length + 2),
              sizeBytes: file.sizeBytes,
            });
            total.files.sort((a, b) => b.sizeBytes - a.sizeBytes);
            total.files.length = Math.min(
              total.files.length,
              HOST_STORAGE_FILE_DETAILS_LIMIT,
            );
            largeFiles.set(name, total);
          }
        }
        const root = measured.get(rootPath);
        scans.delete(hostId);
        store(hostId, {
          scannedAt: Date.now(),
          disk,
          largeFiles: [...largeFiles].map(([name, total]) => ({
            name,
            ...total,
          })),
          entries:
            root?.outcome === "measured"
              ? (root.children ?? []).filter((entry) =>
                  isStorageEntry(entry.name),
                )
              : [],
          worktrees: environments.flatMap((env) => {
            const entry =
              env.path === null ? undefined : measured.get(env.path);
            return entry?.outcome === "measured"
              ? [
                  {
                    environmentId: env.id,
                    path: entry.path,
                    sizeBytes: entry.sizeBytes,
                  },
                ]
              : [];
          }),
        });
      } catch (error) {
        if (!lifecycle.signal.aborted) {
          scans.set(hostId, {
            state: "failed",
            failedAt: Date.now(),
            message: error instanceof Error ? error.message : String(error),
          });
          changed();
        }
      } finally {
        release();
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return host({ hostId });
  }
  async function discard(
    hostId: string,
    rootPath: string,
    cached: Scan,
    entries: Scan["entries"],
  ) {
    let count = 0;
    let bytes = 0;
    for (let offset = 0; offset < entries.length; offset += 500) {
      lifecycle.signal.throwIfAborted();
      const batch = entries.slice(offset, offset + 500);
      await worker.call(
        "discard",
        {
          rootPath,
          names: batch.map((entry) => entry.name),
          recreate: false,
        },
        { hostId, signal: lifecycle.signal },
      );
      const names = new Set(batch.map((entry) => entry.name));
      cached.entries = cached.entries.filter((entry) => !names.has(entry.name));
      store(hostId, cached);
      count += batch.length;
      bytes += batch.reduce((total, entry) => total + entry.sizeBytes, 0);
    }
    return { count, bytes };
  }
  async function removeOrphans({ hostId }: { hostId: string }) {
    await requireHost(hostId, true);
    const release = acquire(hostId);
    try {
      const cached = read(hostId);
      if (!cached)
        throw new Error("Scan the machine before removing orphaned storage");
      const [rootPath, threads] = await Promise.all([
        storageRoot(hostId),
        readThreads(bb, lifecycle.signal),
      ]);
      const ids = new Set(threads.map((thread) => thread.id));
      const removed = await discard(
        hostId,
        rootPath,
        cached,
        cached.entries.filter((entry) => !ids.has(entry.name)),
      );
      return {
        removedCount: removed.count,
        removedBytes: removed.bytes,
        report: await report(hostId, cached),
      };
    } finally {
      release();
    }
  }
  async function clearLargeFilesOn(hostId: string) {
    await requireHost(hostId, true);
    const release = acquire(hostId);
    try {
      const cached = read(hostId);
      if (!cached)
        throw new Error("Scan the machine before clearing large files");
      const [rootPath, threads] = await Promise.all([
        storageRoot(hostId),
        readThreads(bb, lifecycle.signal),
      ]);
      const byId = new Map(threads.map((thread) => [thread.id, thread]));
      const names = cached.largeFiles
        .filter((entry) => {
          const thread = byId.get(entry.name);
          return thread !== undefined && clearableArchived(thread);
        })
        .map((entry) => entry.name);
      let fileCount = 0;
      let bytes = 0;
      for (let offset = 0; offset < names.length; offset += 500) {
        lifecycle.signal.throwIfAborted();
        const { removed } = await worker.call(
          "discardLargeFiles",
          {
            rootPath,
            names: names.slice(offset, offset + 500),
            minBytes: LARGE_FILE_MIN_BYTES,
          },
          { hostId, timeoutMs: 30 * 60_000, signal: lifecycle.signal },
        );
        const freed = new Map(
          removed.map((entry) => [entry.name, entry.sizeBytes]),
        );
        cached.entries = cached.entries.map((entry) => ({
          ...entry,
          sizeBytes: Math.max(
            0,
            entry.sizeBytes - (freed.get(entry.name) ?? 0),
          ),
        }));
        cached.largeFiles = cached.largeFiles.filter(
          (entry) => !freed.has(entry.name),
        );
        store(hostId, cached);
        for (const entry of removed) {
          fileCount += entry.count;
          bytes += entry.sizeBytes;
        }
      }
      return { fileCount, bytes };
    } finally {
      release();
    }
  }
  async function clearLargeFiles({ hostId }: { hostId: string | null }) {
    lifecycle.signal.throwIfAborted();
    const targets =
      hostId === null
        ? (await bb.sdk.hosts.list({ type: "persistent" }))
            .filter(
              (machine) =>
                machine.status === "connected" && read(machine.id) !== null,
            )
            .map((machine) => machine.id)
        : [hostId];
    let clearedFiles = 0;
    let clearedBytes = 0;
    for (const target of targets) {
      const cleared = await clearLargeFilesOn(target);
      clearedFiles += cleared.fileCount;
      clearedBytes += cleared.bytes;
    }
    return { clearedFiles, clearedBytes };
  }
  async function scanAll() {
    lifecycle.signal.throwIfAborted();
    const machines = await bb.sdk.hosts.list({ type: "persistent" });
    for (const machine of machines)
      if (
        machine.status === "connected" &&
        !busy.has(machine.id) &&
        scans.get(machine.id)?.state !== "scanning"
      )
        await scanHost({ hostId: machine.id });
    return hosts();
  }
  async function clearThread({ threadId }: { threadId: string }) {
    lifecycle.signal.throwIfAborted();
    const thread = await bb.sdk.threads.get({ threadId });
    if (["starting", "active", "stopping"].includes(thread.status))
      throw new Error("Stop the thread before clearing its storage");
    let hostId: string;
    if (thread.environmentId !== null) {
      hostId = (await bb.sdk.threads.storageLocation({ threadId })).hostId;
    } else {
      const matches = db
        .prepare<[string], { host_id: string }>(
          "SELECT host_id FROM scans WHERE EXISTS (SELECT 1 FROM json_each(scans.result_json, '$.entries') WHERE json_extract(value, '$.name') = ?)",
        )
        .all(threadId);
      const match = matches[0];
      if (matches.length !== 1 || match === undefined)
        throw new Error(
          "Scan the machine to identify a unique storage location for this thread",
        );
      hostId = match.host_id;
    }
    await requireHost(hostId, true);
    const release = acquire(hostId);
    try {
      const rootPath = await storageRoot(hostId);
      await worker.call(
        "discard",
        { rootPath, names: [threadId], recreate: true },
        { hostId, signal: lifecycle.signal },
      );
      const cached = read(hostId);
      if (cached) {
        cached.entries = cached.entries.filter(
          (entry) => entry.name !== threadId,
        );
        cached.largeFiles = cached.largeFiles.filter(
          (entry) => entry.name !== threadId,
        );
        store(hostId, cached);
      }
      return { ok: true as const };
    } finally {
      release();
    }
  }
  async function retryWorktreeCleanup({ hostId }: { hostId: string }) {
    await requireHost(hostId);
    const environments = await leftovers(
      hostId,
      await readThreads(bb, lifecycle.signal),
    );
    let retriedCount = 0;
    for (const env of environments) {
      lifecycle.signal.throwIfAborted();
      await bb.sdk.environments.experimental_cleanup({
        environmentId: env.id,
      });
      retriedCount++;
    }
    changed();
    return { retriedCount };
  }
  return {
    host,
    hosts,
    scanHost,
    scanAll,
    removeOrphans,
    clearLargeFiles,
    clearThread,
    retryWorktreeCleanup,
  };
}
export type Storage = ReturnType<typeof createStorage>;
