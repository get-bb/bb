import { createStorage } from "./storage.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { storageRpc, type Policy } from "./contract.js";
import { createService } from "./service.js";
import { registerCli } from "./cli.js";

export default function plugin(bb: BbPluginApi) {
  const service = createService(bb);
  const devCleanupEnabled = async () =>
    (await service.state()).policy.deleteDevDataOnCheckoutRemoval;
  const cleanupEnabled = async () =>
    (await service.state()).policy.deleteStorageOnArchive;
  const storage = createStorage(bb, devCleanupEnabled, cleanupEnabled);
  const configure = async (policy: Policy) => {
    const before = (await service.state()).policy.deleteStorageOnArchive;
    const state = await service.configure(policy);
    if (!before && state.policy.deleteStorageOnArchive)
      void storage.backfillArchivedStorage();
    return state;
  };
  bb.events.on("experimental_environment.removed", ({ removal }) =>
    removal.hostId === null
      ? undefined
      : storage.cleanDevelopmentStorage(removal.hostId),
  );
  bb.background.schedule(
    "development-storage-cleanup",
    "0 * * * *",
    storage.reconcileDevelopmentStorage,
  );
  bb.background.service("development-storage-recovery", {
    async start(signal) {
      if (signal.aborted) return;
      const unsubscribe = bb.sdk.subscribe({
        event: "host:changed",
        callback: (event) => {
          if (event.changes.includes("host-connected"))
            void (event.id === undefined
              ? storage.reconcileDevelopmentStorage()
              : storage.reconcileHostDevelopmentStorage(event.id));
          if (
            event.changes.includes("host-connected") ||
            event.changes.includes("host-disconnected")
          )
            bb.realtime.publish("changed", null);
        },
      });
      const unsubscribeConnection = bb.sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          if (event.state === "connected" && event.reconnected)
            void storage.reconcileDevelopmentStorage();
        },
      });
      try {
        await storage.reconcileDevelopmentStorage();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else
            signal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        unsubscribe();
        unsubscribeConnection();
      }
    },
  });
  bb.events.on("thread.archived", async ({ thread }) => {
    if (
      thread.archivedAt === null ||
      thread.pinnedAt !== null ||
      !(await cleanupEnabled())
    )
      return;
    storage.queueArchivedStorage(thread.id, thread.archivedAt);
    await storage.clearPendingArchives(cleanupEnabled);
  });
  for (const event of ["thread.idle", "thread.failed"] as const)
    bb.events.on(event, () => storage.clearPendingArchives(cleanupEnabled));
  for (const event of ["thread.unarchived", "thread.deleted"] as const)
    bb.events.on(event, ({ thread }) =>
      storage.cancelArchivedStorage(thread.id),
    );
  bb.background.schedule("archive-storage-cleanup", "* * * * *", () =>
    storage.clearPendingArchives(cleanupEnabled),
  );
  bb.rpc.register(storageRpc, {
    startEntryCleanup: storage.startEntryCleanup,
    entryCleanup: storage.entryCleanup,
    startCleanup: storage.startCleanup,
    hosts: () => storage.hosts(),
    host: storage.host,
    scanHost: storage.scanHost,
    scanAll: () => storage.scanAll(),
    removeOrphans: (input) => storage.removeOrphans(input),
    clearLargeFiles: storage.clearLargeFiles,
    startClearLargeFiles: storage.startClearLargeFiles,
    retryWorktreeCleanup: (input) =>
      storage.retryWorktreeCleanup({ ...input, interruptedOnly: false }),
    clearThread: storage.clearThread,
    clearArchivedFiles: storage.clearArchivedFiles,
    startClearArchivedFiles: storage.startClearArchivedFiles,
    removeDevInstances: (input) => storage.removeDevInstances(input),
    removeExternalWorktrees: (input) => storage.removeExternalWorktrees(input),
    startRemoveExternalWorktree: storage.startRemoveExternalWorktree,
    state: () => service.state(),
    preview: (policy) => service.preview(policy),
    configure,
  });
  registerCli(bb, { ...service, configure }, storage);
  bb.background.schedule("retention", "0 * * * *", () => service.sweep());
  bb.background.schedule("leftover-worktree-recovery", "15 * * * *", () =>
    storage.recoverInterruptedWorktrees(),
  );
  bb.background.schedule("archived-storage-backfill", "30 * * * *", () =>
    storage.backfillArchivedStorage(),
  );
}
