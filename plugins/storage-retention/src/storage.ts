import { ARCHIVE_UNDO_GRACE_MS } from "@bb/domain";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  diskCapacitySchema,
  hostStorageContract,
  type MeasuredTarget,
} from "./host-contract.js";
import { readThreads } from "./sdk-data.js";
import { LARGE_FILE_MIN_BYTES } from "./rules.js";
import { developerStorageScanSchema } from "./storage-types.js";
import type {
  HostStorageReport,
  HostStorageResponse,
  HostStorageScanStatus,
  LargeFileCleanupStatus,
  ArchivedFileCleanupStatus,
  MaintenanceStatus,
} from "./storage-types.js";

type Thread = Awaited<ReturnType<typeof readThreads>>[number];
type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["list"]>
>[number];
const cachedScanSchema = z.object({
  scannedAt: z.number(),
  developerStorage: developerStorageScanSchema.nullable().default(null),
  disk: diskCapacitySchema.nullable().default(null),
  largeFiles: z
    .array(
      z.object({
        name: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        count: z.number().int().nonnegative(),
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
type Removal = {
  entries: Set<string>;
  largeFiles: Set<string>;
  developer: Set<string>;
};
function withoutRemoved(scan: Scan, removal: Removal): Scan {
  const largeBytes = new Map(
    scan.largeFiles.map((entry) => [entry.name, entry.sizeBytes]),
  );
  const developer = scan.developerStorage;
  const developerBytes = (developer?.entries ?? [])
    .filter((entry) => removal.developer.has(entry.name))
    .reduce((total, entry) => total + entry.sizeBytes, 0);
  return {
    ...scan,
    entries: scan.entries
      .filter((entry) => !removal.entries.has(entry.name))
      .map((entry) =>
        removal.largeFiles.has(entry.name)
          ? {
              ...entry,
              sizeBytes: Math.max(
                0,
                entry.sizeBytes - (largeBytes.get(entry.name) ?? 0),
              ),
            }
          : entry,
      ),
    largeFiles: scan.largeFiles.filter(
      (entry) =>
        !removal.entries.has(entry.name) &&
        !removal.largeFiles.has(entry.name),
    ),
    developerStorage: developer && {
      ...developer,
      sizeBytes: Math.max(0, developer.sizeBytes - developerBytes),
      entries: developer.entries.filter(
        (entry) => !removal.developer.has(entry.name),
      ),
    },
  };
}
const clearableArchived = (
  thread: Pick<Thread, "archivedAt" | "pinnedAt" | "status">,
) =>
  thread.archivedAt !== null &&
  thread.archivedAt + ARCHIVE_UNDO_GRACE_MS <= Date.now() &&
  thread.pinnedAt === null &&
  !["starting", "active", "stopping"].includes(thread.status);
const isStorageEntry = (name: string) =>
  /^(thr_[a-zA-Z0-9]+|\.bb-trash-[a-zA-Z0-9_-]+)$/.test(name);

export function createStorage(
  bb: BbPluginApi,
  devCleanupEnabled: () => Promise<boolean>,
) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    "CREATE TABLE scans (host_id TEXT PRIMARY KEY, result_json TEXT NOT NULL)",
    "CREATE TABLE archive_cleanup (thread_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL)",
  ]);
  const worker = bb.hosts.experimental_client({
    contract: hostStorageContract,
  });
  const lifecycle = new AbortController();
  const busy = new Set<string>();
  const pendingDevelopmentCleanups = new Set<string>();
  const entryClears = new Map<
    string,
    { keys: Set<string>; release: () => void }
  >();
  const maintenance = new Map<string, MaintenanceStatus>();
  const scans = new Map<string, HostStorageScanStatus>();
  const archivedFileCleanups = new Map<string, ArchivedFileCleanupStatus>();
  const largeFileCleanups = new Map<string, LargeFileCleanupStatus>();
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
  const scanRemovals = new Map<string, Removal>();
  function forget(hostId: string, removed: Partial<Removal>) {
    const removal = {
      entries: removed.entries ?? new Set<string>(),
      largeFiles: removed.largeFiles ?? new Set<string>(),
      developer: removed.developer ?? new Set<string>(),
    };
    const pending = scanRemovals.get(hostId);
    if (pending)
      for (const key of ["entries", "largeFiles", "developer"] as const)
        for (const name of removal[key]) pending[key].add(name);
    const cached = read(hostId);
    if (cached) store(hostId, withoutRemoved(cached, removal));
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
      if (pendingDevelopmentCleanups.has(hostId))
        void cleanDevelopmentStorage(hostId);
    };
  }
  function acquireEntries(
    hostId: string,
    keys: string[],
    duplicateMessage: string,
  ) {
    const existing = entryClears.get(hostId);
    if (existing && keys.some((key) => existing.keys.has(key)))
      throw new Error(duplicateMessage);
    const group = existing ?? {
      keys: new Set<string>(),
      release: acquire(hostId),
    };
    entryClears.set(hostId, group);
    for (const key of keys) group.keys.add(key);
    return () => {
      for (const key of keys) group.keys.delete(key);
      if (group.keys.size === 0) {
        entryClears.delete(hostId);
        group.release();
      }
    };
  }
  async function readEnvironments(hostId: string) {
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
    return environments;
  }
  function leftoverEnvironments(
    environments: Environment[],
    threads: Thread[],
  ) {
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
  async function readReportContext() {
    const [threads, projects] = await Promise.all([
      readThreads(bb, lifecycle.signal),
      bb.sdk.projects.list({ signal: lifecycle.signal }),
    ]);
    return { threads, projects };
  }
  function sharedReportContext() {
    let pending: ReturnType<typeof readReportContext> | null = null;
    return () => (pending ??= readReportContext());
  }
  async function report(
    hostId: string,
    scan: Scan,
    context: () => ReturnType<typeof readReportContext>,
  ): Promise<HostStorageReport> {
    const [{ threads, projects }, allEnvironments] = await Promise.all([
      context(),
      readEnvironments(hostId),
    ]);
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const environments = new Map(
      leftoverEnvironments(allEnvironments, threads).map((env) => [
        env.id,
        env,
      ]),
    );
    const projectCounts = new Map<
      string,
      { paths: Set<string>; pendingPaths: Set<string> }
    >();
    for (const env of allEnvironments) {
      if (
        !env.managed ||
        !env.isWorktree ||
        env.path === null ||
        env.status === "destroyed" ||
        env.lifecycle.teardown?.status === "removed"
      )
        continue;
      const counts = projectCounts.get(env.projectId) ?? {
        paths: new Set<string>(),
        pendingPaths: new Set<string>(),
      };
      counts.paths.add(env.path);
      if (environments.has(env.id)) counts.pendingPaths.add(env.path);
      projectCounts.set(env.projectId, counts);
    }
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
    const hiddenActive = owned.filter(
      (entry) =>
        entry.thread.visibility === "hidden" &&
        entry.thread.archivedAt === null,
    );
    const hiddenArchived = archived.filter(
      (entry) => entry.thread.visibility === "hidden",
    );
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
      hiddenThreads: {
        activeCount: hiddenActive.length,
        activeBytes: sum(hiddenActive),
        archivedCount: hiddenArchived.length,
        archivedBytes: sum(hiddenArchived),
      },
      archivedFiles: {
        threadCount: owned.filter((entry) => clearableArchived(entry.thread))
          .length,
        bytes: sum(owned.filter((entry) => clearableArchived(entry.thread))),
      },
      archivedLargeFiles: {
        threadCount: clearable.length,
        fileCount: clearable.reduce((total, entry) => total + entry.count, 0),
        bytes: sum(clearable),
      },
      largestThreads: owned
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 20)
        .map(({ thread, sizeBytes }) => ({
          threadId: thread.id,
          projectId: thread.projectId,
          title: thread.title ?? thread.titleFallback ?? thread.id,
          archivedAt: thread.archivedAt,
          updatedAt: thread.updatedAt,
          hidden: thread.visibility === "hidden",
          pinned: thread.pinnedAt !== null,
          running: ["starting", "active", "stopping"].includes(thread.status),
          sizeBytes,
        })),
      leftoverWorktrees: worktrees,
      projectWorktrees: projects
        .filter(
          (project) =>
            project.sources.some((source) => source.hostId === hostId) ||
            projectCounts.has(project.id),
        )
        .map((project) => ({
          projectId: project.id,
          projectName: project.name,
          worktreeCount: projectCounts.get(project.id)?.paths.size ?? 0,
          cleanupPendingCount:
            projectCounts.get(project.id)?.pendingPaths.size ?? 0,
        }))
        .sort(
          (a, b) =>
            b.worktreeCount - a.worktreeCount ||
            a.projectName.localeCompare(b.projectName),
        ),
      developerStorage: scan.developerStorage
        ? {
            ...scan.developerStorage,
            entries: scan.developerStorage.entries.map((entry) => {
              const sourcePath = entry.sourcePath
                ?.replaceAll("\\", "/")
                .replace(/\/$/, "");
              const environmentIds = new Set(
                allEnvironments
                  .filter(
                    (env) =>
                      sourcePath !== undefined &&
                      env.path?.replaceAll("\\", "/").replace(/\/$/, "") ===
                        sourcePath,
                  )
                  .map((env) => env.id),
              );
              const encodedThreadId = sourcePath?.match(
                /\/(?:worktrees|thread-storage)\/(thr_[a-zA-Z0-9]+)(?:-[^/]*)?\//,
              )?.[1];
              const linked = threads.filter(
                (thread) =>
                  (thread.environmentId !== null &&
                    environmentIds.has(thread.environmentId)) ||
                  thread.id === encodedThreadId,
              );
              return {
                ...entry,
                threads: linked.map((thread) => ({
                  threadId: thread.id,
                  title: thread.title ?? thread.titleFallback ?? thread.id,
                  archived: thread.archivedAt !== null,
                })),
              };
            }),
          }
        : null,
    };
  }
  async function host({
    hostId,
  }: {
    hostId: string;
  }): Promise<HostStorageResponse> {
    await requireHost(hostId);
    return hostResponse(hostId, sharedReportContext());
  }
  async function hostResponse(
    hostId: string,
    context: () => ReturnType<typeof readReportContext>,
  ): Promise<HostStorageResponse> {
    const cached = read(hostId);
    return {
      maintenance: maintenance.get(hostId) ?? { state: "idle" },
      report: cached ? await report(hostId, cached, context) : null,
      scan: scans.get(hostId) ?? { state: "idle" },
      largeFileCleanup: largeFileCleanups.get(hostId) ?? { state: "idle" },
      archivedFileCleanup: archivedFileCleanups.get(hostId) ?? {
        state: "idle",
      },
    };
  }
  async function hosts() {
    lifecycle.signal.throwIfAborted();
    const machines = await bb.sdk.hosts.list({ type: "persistent" });
    const context = sharedReportContext();
    return {
      hosts: await Promise.all(
        machines.map(async (machine) => ({
          hostId: machine.id,
          ...(await hostResponse(machine.id, context)),
        })),
      ),
    };
  }
  function developerCandidatePaths(
    hostId: string,
    environments: Environment[],
    projects: Awaited<ReturnType<BbPluginApi["sdk"]["projects"]["list"]>>,
  ) {
    return [
      ...new Set([
        ...environments.flatMap((env) => (env.path === null ? [] : [env.path])),
        ...projects.flatMap((project) =>
          project.sources
            .filter((source) => source.hostId === hostId)
            .map((source) => source.path),
        ),
      ]),
    ];
  }
  async function measureDeveloperStorage(
    hostId: string,
    homeDirectory: string,
    environments: Environment[],
    projects: Awaited<ReturnType<BbPluginApi["sdk"]["projects"]["list"]>>,
  ): Promise<Scan["developerStorage"]> {
    const developerRoot = `${homeDirectory.replace(/[\\/]$/, "")}/.bb-dev`;
    const result = await worker.call(
      "measure",
      {
        targets: [{ path: developerRoot, perChild: true }],
        largeFileMinBytes: null,
        timeoutMs: 29 * 60_000,
      },
      { hostId, timeoutMs: 30 * 60_000, signal: lifecycle.signal },
    );
    lifecycle.signal.throwIfAborted();
    const developer = result.targets.find(
      (target) => target.path === developerRoot,
    );
    if (developer?.outcome !== "measured") return null;
    const developerEntries = (developer.children ?? []).filter(
      (entry) => !entry.name.startsWith(".bb-trash-"),
    );
    const inspected = new Map<
      string,
      z.infer<
        typeof hostStorageContract.inspectDeveloperEntries.output
      >["entries"][number]
    >();
    const candidatePaths = developerCandidatePaths(
      hostId,
      environments,
      projects,
    );
    for (let offset = 0; offset < developerEntries.length; offset += 500) {
      const inspection = await worker.call(
        "inspectDeveloperEntries",
        {
          rootPath: developerRoot,
          names: developerEntries
            .slice(offset, offset + 500)
            .map((entry) => entry.name),
          candidatePaths,
        },
        { hostId, signal: lifecycle.signal },
      );
      for (const entry of inspection.entries) inspected.set(entry.name, entry);
    }
    return {
      path: developer.path,
      sizeBytes: developer.sizeBytes,
      entries: developerEntries
        .map((entry) => ({
          ...entry,
          sourcePath: inspected.get(entry.name)?.sourcePath ?? null,
          sourcePathState:
            inspected.get(entry.name)?.sourcePathState ?? "unknown",
          running: inspected.get(entry.name)?.running ?? false,
        }))
        .sort((a, b) => b.sizeBytes - a.sizeBytes),
    };
  }
  async function scanHost({ hostId }: { hostId: string }) {
    await requireHost(hostId, true);
    if (scans.get(hostId)?.state === "scanning") return host({ hostId });
    const removal: Removal = {
      entries: new Set(),
      largeFiles: new Set(),
      developer: new Set(),
    };
    scanRemovals.set(hostId, removal);
    scans.set(hostId, { state: "scanning", startedAt: Date.now() });
    changed();
    const job = (async () => {
      let completed = false;
      try {
        const [rootPath, threads, allEnvironments, projects] =
          await Promise.all([
            storageRoot(hostId),
            readThreads(bb, lifecycle.signal),
            readEnvironments(hostId),
            bb.sdk.projects.list({ signal: lifecycle.signal }),
          ]);
        const environments = leftoverEnvironments(allEnvironments, threads);
        const homeDirectory = await worker.call("homeDirectory", null, {
          hostId,
          signal: lifecycle.signal,
        });
        const disk = await worker.call(
          "capacity",
          { path: rootPath },
          { hostId, signal: lifecycle.signal },
        );
        const measured = new Map<string, MeasuredTarget>();
        const largeFiles = new Map<
          string,
          { sizeBytes: number; count: number }
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
            const total = largeFiles.get(name) ?? { sizeBytes: 0, count: 0 };
            total.sizeBytes += file.sizeBytes;
            total.count++;
            largeFiles.set(name, total);
          }
        }
        const root = measured.get(rootPath);
        const developerStorage = await measureDeveloperStorage(
          hostId,
          homeDirectory,
          allEnvironments,
          projects,
        );
        scans.delete(hostId);
        const scan: Scan = {
          scannedAt: Date.now(),
          developerStorage,
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
        };
        store(hostId, withoutRemoved(scan, removal));
        completed = true;
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
        if (scanRemovals.get(hostId) === removal) scanRemovals.delete(hostId);
        if (completed) void cleanDevelopmentStorage(hostId);
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return host({ hostId });
  }
  async function discard(
    hostId: string,
    rootPath: string,
    entries: Scan["entries"],
    progress: ((count: number, bytes: number) => void) | null = null,
    eligibility: "archived" | "orphan" = "orphan",
  ) {
    let count = 0;
    let bytes = 0;
    for (let offset = 0; offset < entries.length; offset += 100) {
      lifecycle.signal.throwIfAborted();
      const current = await readThreads(bb, lifecycle.signal);
      const byId = new Map(current.map((thread) => [thread.id, thread]));
      const batch = entries.slice(offset, offset + 100).filter((entry) => {
        const thread = byId.get(entry.name);
        return eligibility === "orphan"
          ? thread === undefined
          : thread !== undefined && clearableArchived(thread);
      });
      if (batch.length === 0) continue;
      await worker.call(
        "discard",
        {
          rootPath,
          names: batch.map((entry) => entry.name),
          recreate: false,
        },
        { hostId, timeoutMs: 30 * 60_000, signal: lifecycle.signal },
      );
      forget(hostId, {
        entries: new Set(batch.map((entry) => entry.name)),
      });
      count += batch.length;
      bytes += batch.reduce((total, entry) => total + entry.sizeBytes, 0);
      progress?.(count, bytes);
    }
    return { count, bytes };
  }
  async function removeOrphans(
    { hostId }: { hostId: string },
    reserved: (() => void) | null = null,
  ) {
    const release = reserved ?? acquire(hostId);
    try {
      await requireHost(hostId, true);
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
        cached.entries.filter((entry) => !ids.has(entry.name)),
      );
      return {
        removedCount: removed.count,
        removedBytes: removed.bytes,
        report: await report(hostId, read(hostId) ?? cached, readReportContext),
      };
    } finally {
      release();
    }
  }
  async function clearLargeFilesOn(hostId: string, release = acquire(hostId)) {
    try {
      await requireHost(hostId, true);
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
      for (let offset = 0; offset < names.length; offset += 100) {
        lifecycle.signal.throwIfAborted();
        const current = await readThreads(bb, lifecycle.signal);
        const eligible = new Set(
          current.filter(clearableArchived).map((thread) => thread.id),
        );
        const batch = names
          .slice(offset, offset + 100)
          .filter((name) => eligible.has(name));
        if (batch.length === 0) continue;
        const { removed } = await worker.call(
          "discardLargeFiles",
          {
            rootPath,
            names: batch,
            minBytes: LARGE_FILE_MIN_BYTES,
          },
          { hostId, timeoutMs: 30 * 60_000, signal: lifecycle.signal },
        );
        forget(hostId, {
          largeFiles: new Set(removed.map((entry) => entry.name)),
        });
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
  async function clearArchivedFiles({ hostId }: { hostId: string }) {
    await requireHost(hostId, true);
    return clearArchivedFilesOn(hostId, acquire(hostId), null);
  }
  async function startClearArchivedFiles({ hostId }: { hostId: string }) {
    await requireHost(hostId, true);
    if (!read(hostId))
      throw new Error("Scan the machine before clearing archived thread files");
    const release = acquire(hostId);
    let clearedThreads = 0;
    let clearedBytes = 0;
    archivedFileCleanups.set(hostId, {
      state: "running",
      clearedThreads,
      clearedBytes,
    });
    changed();
    const job = (async () => {
      try {
        const result = await clearArchivedFilesOn(
          hostId,
          release,
          (count, bytes) => {
            clearedThreads = count;
            clearedBytes = bytes;
            archivedFileCleanups.set(hostId, {
              state: "running",
              clearedThreads,
              clearedBytes,
            });
          },
        );
        archivedFileCleanups.set(hostId, { state: "completed", ...result });
      } catch (error) {
        if (!lifecycle.signal.aborted)
          archivedFileCleanups.set(hostId, {
            state: "failed",
            clearedThreads,
            clearedBytes,
            message: error instanceof Error ? error.message : String(error),
          });
      } finally {
        changed();
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return null;
  }
  async function clearArchivedFilesOn(
    hostId: string,
    release: () => void,
    progress: ((count: number, bytes: number) => void) | null,
  ) {
    try {
      const cached = read(hostId);
      if (!cached)
        throw new Error(
          "Scan the machine before clearing archived thread files",
        );
      const [rootPath, threads] = await Promise.all([
        storageRoot(hostId),
        readThreads(bb, lifecycle.signal),
      ]);
      const eligible = new Set(
        threads.filter(clearableArchived).map((thread) => thread.id),
      );
      const removed = await discard(
        hostId,
        rootPath,
        cached.entries.filter((entry) => eligible.has(entry.name)),
        progress,
        "archived",
      );
      return { clearedThreads: removed.count, clearedBytes: removed.bytes };
    } finally {
      release();
    }
  }
  async function removeDevInstances(
    input:
      | { hostId: string; names: null }
      | { hostId: string; names: string[]; stopRunning: boolean },
    reserved: (() => void) | null = null,
  ) {
    const { hostId, names } = input;
    const release =
      reserved ??
      (names === null
        ? acquire(hostId)
        : acquireEntries(
            hostId,
            names.map((name) => `dev:${name}`),
            "This development instance is already being removed",
          ));
    try {
      await requireHost(hostId, true);
      const developer = read(hostId)?.developerStorage;
      if (!developer)
        throw new Error(
          "Scan the machine before removing development instances",
        );
      const [environments, projects] = await Promise.all([
        readEnvironments(hostId),
        bb.sdk.projects.list({ signal: lifecycle.signal }),
      ]);
      const candidatePaths = developerCandidatePaths(
        hostId,
        environments,
        projects,
      );
      const targets = developer.entries.filter((entry) =>
        names === null
          ? entry.sourcePathState === "missing"
          : names.includes(entry.name),
      );
      const unknown = (names ?? []).filter(
        (name) => !targets.some((entry) => entry.name === name),
      );
      if (unknown.length > 0)
        throw new Error(
          `Not a development instance in the last scan: ${unknown.join(", ")}`,
        );
      const running: string[] = [];
      let removedCount = 0;
      let removedBytes = 0;
      let stoppedProcessCount = 0;
      for (let offset = 0; offset < targets.length; offset += 100) {
        lifecycle.signal.throwIfAborted();
        const result = await worker.call(
          "removeDeveloperEntries",
          {
            rootPath: developer.path,
            names: targets
              .slice(offset, offset + 100)
              .map((entry) => entry.name),
            candidatePaths,
            mode:
              input.names === null
                ? { condition: "checkoutMissing" }
                : { condition: "any", stopRunning: input.stopRunning },
          },
          { hostId, timeoutMs: 30 * 60_000, signal: lifecycle.signal },
        );
        const removed = new Set(result.removed);
        const bytes = developer.entries
          .filter((entry) => removed.has(entry.name))
          .reduce((total, entry) => total + entry.sizeBytes, 0);
        forget(hostId, { developer: removed });
        removedCount += removed.size;
        removedBytes += bytes;
        stoppedProcessCount += result.stoppedProcessCount;
        running.push(...result.running);
      }
      return {
        removedCount,
        removedBytes,
        skippedCount: targets.length - removedCount - running.length,
        stoppedProcessCount,
        running,
      };
    } finally {
      release();
    }
  }
  async function largeFileTargets(hostId: string | null) {
    lifecycle.signal.throwIfAborted();
    return hostId === null
      ? (await bb.sdk.hosts.list({ type: "persistent" }))
          .filter(
            (machine) =>
              machine.status === "connected" && read(machine.id) !== null,
          )
          .map((machine) => machine.id)
      : [hostId];
  }
  async function startClearLargeFiles({ hostId }: { hostId: string | null }) {
    const candidates = await largeFileTargets(hostId);
    const threads = await readThreads(bb, lifecycle.signal);
    const eligible = new Set(
      threads.filter(clearableArchived).map((thread) => thread.id),
    );
    const targets = candidates.filter((target) =>
      read(target)?.largeFiles.some((entry) => eligible.has(entry.name)),
    );
    for (const target of candidates) {
      await requireHost(target, true);
      if (!read(target))
        throw new Error("Scan the machine before clearing large files");
    }
    if (targets.some((target) => busy.has(target)))
      throw new Error("Storage maintenance is already running on this machine");
    for (const target of targets) {
      const release = acquire(target);
      largeFileCleanups.set(target, {
        state: "running",
        startedAt: Date.now(),
      });
      const job = (async () => {
        try {
          const result = await clearLargeFilesOn(target, release);
          largeFileCleanups.set(target, {
            state: "completed",
            clearedFiles: result.fileCount,
            clearedBytes: result.bytes,
          });
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            largeFileCleanups.set(target, {
              state: "failed",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          changed();
        }
      })();
      jobs.add(job);
      void job.finally(() => jobs.delete(job));
    }
    changed();
    return null;
  }
  async function clearLargeFiles({ hostId }: { hostId: string | null }) {
    const targets = await largeFileTargets(hostId);
    let clearedFiles = 0;
    let clearedBytes = 0;
    for (const target of targets) {
      const cleared = await clearLargeFilesOn(target);
      clearedFiles += cleared.fileCount;
      clearedBytes += cleared.bytes;
    }
    return { clearedFiles, clearedBytes };
  }
  let cleaningDevelopment = false;
  function cleanDevelopmentStorage(hostId: string) {
    pendingDevelopmentCleanups.add(hostId);
    if (cleaningDevelopment || lifecycle.signal.aborted)
      return Promise.resolve();
    cleaningDevelopment = true;
    const job = (async () => {
      try {
        for (;;) {
          if (lifecycle.signal.aborted) return;
          if (!(await devCleanupEnabled())) {
            pendingDevelopmentCleanups.clear();
            return;
          }
          const next = [...pendingDevelopmentCleanups].find(
            (id) => !busy.has(id),
          );
          if (next === undefined) return;
          pendingDevelopmentCleanups.delete(next);
          try {
            if (read(next) === null) await scanHost({ hostId: next });
            else await removeMissingDevelopment(next, acquire(next));
          } catch (error) {
            if (!lifecycle.signal.aborted)
              bb.log.warn(
                `Could not clean development storage on ${next}: ${error instanceof Error ? error.message : String(error)}`,
              );
          }
        }
      } finally {
        cleaningDevelopment = false;
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return job;
  }
  async function removeMissingDevelopment(
    hostId: string,
    release: () => void,
  ) {
    let handedOff = false;
    try {
      await requireHost(hostId, true);
      const [homeDirectory, environments, projects] = await Promise.all([
        worker.call("homeDirectory", null, {
          hostId,
          signal: lifecycle.signal,
        }),
        readEnvironments(hostId),
        bb.sdk.projects.list({ signal: lifecycle.signal }),
      ]);
      const developerStorage = await measureDeveloperStorage(
        hostId,
        homeDirectory,
        environments,
        projects,
      );
      const cached = read(hostId);
      if (cached === null) return;
      store(hostId, { ...cached, developerStorage });
      changed();
      if (
        !developerStorage?.entries.some(
          (entry) => entry.sourcePathState === "missing",
        )
      )
        return;
      handedOff = true;
      await removeDevInstances({ hostId, names: null }, release);
    } finally {
      if (!handedOff) release();
    }
  }
  let reconcilingDevelopment = false;
  function reconcileDevelopmentStorage() {
    if (reconcilingDevelopment || lifecycle.signal.aborted)
      return Promise.resolve();
    reconcilingDevelopment = true;
    const job = (async () => {
      try {
        if (await devCleanupEnabled()) await scanAll();
      } catch (error) {
        if (!lifecycle.signal.aborted)
          bb.log.warn(
            `Could not reconcile development storage: ${error instanceof Error ? error.message : String(error)}`,
          );
      } finally {
        reconcilingDevelopment = false;
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return job;
  }
  async function scanAll() {
    lifecycle.signal.throwIfAborted();
    const machines = await bb.sdk.hosts.list({ type: "persistent" });
    for (const machine of machines)
      if (
        machine.status === "connected" &&
        scans.get(machine.id)?.state !== "scanning"
      )
        await scanHost({ hostId: machine.id });
    return hosts();
  }
  async function clearThread({ threadId }: { threadId: string }) {
    return clearThreadStorage(threadId, null);
  }
  async function clearThreadStorage(
    threadId: string,
    archivedAt: number | null,
  ) {
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
    const release = acquireEntries(
      hostId,
      [threadId],
      "This thread’s files are already being cleared",
    );
    try {
      const rootPath = await storageRoot(hostId);
      if (archivedAt !== null) {
        const current = await bb.sdk.threads.get({ threadId });
        if (
          current.archivedAt !== archivedAt ||
          current.deletedAt !== null ||
          current.pinnedAt !== null ||
          current.archivedAt + ARCHIVE_UNDO_GRACE_MS > Date.now()
        )
          return { ok: true as const };
        if (["starting", "active", "stopping"].includes(current.status))
          throw new Error("Stop the thread before clearing its storage");
      }
      await worker.call(
        "discard",
        { rootPath, names: [threadId], recreate: true },
        { hostId, signal: lifecycle.signal },
      );
      forget(hostId, { entries: new Set([threadId]) });
      return { ok: true as const };
    } finally {
      release();
    }
  }
  let cleaningArchives = false;
  function queueArchivedStorage(threadId: string, archivedAt: number) {
    db.prepare(
      "INSERT INTO archive_cleanup (thread_id, archived_at) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET archived_at = excluded.archived_at",
    ).run(threadId, archivedAt);
  }
  function cancelArchivedStorage(threadId: string) {
    db.prepare("DELETE FROM archive_cleanup WHERE thread_id = ?").run(threadId);
  }
  function clearPendingArchives(enabled: () => Promise<boolean>) {
    if (cleaningArchives || lifecycle.signal.aborted) return Promise.resolve();
    cleaningArchives = true;
    const job = drainPendingArchives(enabled).finally(() => {
      cleaningArchives = false;
    });
    jobs.add(job);
    void job.then(
      () => jobs.delete(job),
      () => jobs.delete(job),
    );
    return job;
  }
  async function drainPendingArchives(enabled: () => Promise<boolean>) {
    const pending = db
      .prepare<[], { thread_id: string; archived_at: number }>(
        "SELECT thread_id, archived_at FROM archive_cleanup ORDER BY archived_at",
      )
      .all();
    for (const entry of pending) {
      if (lifecycle.signal.aborted) return;
      if (!(await enabled())) {
        db.prepare("DELETE FROM archive_cleanup").run();
        return;
      }
      try {
        const thread = await bb.sdk.threads.get({
          threadId: entry.thread_id,
        });
        if (
          thread.archivedAt !== entry.archived_at ||
          thread.deletedAt !== null ||
          thread.pinnedAt !== null
        ) {
          cancelArchivedStorage(entry.thread_id);
          continue;
        }
        if (!clearableArchived(thread)) continue;
        await clearThreadStorage(thread.id, entry.archived_at);
        db.prepare(
          "DELETE FROM archive_cleanup WHERE thread_id = ? AND archived_at = ?",
        ).run(entry.thread_id, entry.archived_at);
      } catch (error) {
        if (error instanceof Error && "status" in error && error.status === 404) {
          cancelArchivedStorage(entry.thread_id);
          continue;
        }
        bb.log.warn(
          `Could not clear archived storage for ${entry.thread_id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  async function retryWorktreeCleanup(
    { hostId }: { hostId: string },
    reserved: (() => void) | null = null,
  ) {
    const release = reserved ?? acquire(hostId);
    try {
      await requireHost(hostId, true);
      const [allEnvironments, threads] = await Promise.all([
        readEnvironments(hostId),
        readThreads(bb, lifecycle.signal),
      ]);
      const environments = leftoverEnvironments(allEnvironments, threads);
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
    } finally {
      release();
    }
  }
  async function startCleanup({
    hostId,
    kind,
  }: {
    hostId: string;
    kind: "orphans" | "development" | "worktrees";
  }) {
    await requireHost(hostId, true);
    if (!read(hostId))
      throw new Error("Scan the machine before cleaning up storage");
    const release = acquire(hostId);
    maintenance.set(hostId, { state: "running", kind });
    changed();
    const job = (async () => {
      try {
        let message: string;
        if (kind === "orphans") {
          const result = await removeOrphans({ hostId }, release);
          message = `Removed ${result.removedCount} orphaned storage folders`;
        } else if (kind === "development") {
          const result = await removeDevInstances(
            { hostId, names: null },
            release,
          );
          message = `Removed ${result.removedCount} development instances; ${result.skippedCount} skipped`;
        } else {
          const result = await retryWorktreeCleanup({ hostId }, release);
          message = `Retried cleanup for ${result.retriedCount} worktrees`;
        }
        maintenance.set(hostId, { state: "completed", kind, message });
      } catch (error) {
        if (!lifecycle.signal.aborted)
          maintenance.set(hostId, {
            state: "failed",
            kind,
            message: error instanceof Error ? error.message : String(error),
          });
      } finally {
        changed();
      }
    })();
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return null;
  }
  return {
    startCleanup,
    host,
    hosts,
    scanHost,
    scanAll,
    reconcileDevelopmentStorage,
    cleanDevelopmentStorage,
    removeOrphans,
    clearLargeFiles,
    startClearLargeFiles,
    clearArchivedFiles,
    startClearArchivedFiles,
    removeDevInstances,
    clearThread,
    queueArchivedStorage,
    cancelArchivedStorage,
    clearPendingArchives,
    retryWorktreeCleanup,
  };
}
export type Storage = ReturnType<typeof createStorage>;
