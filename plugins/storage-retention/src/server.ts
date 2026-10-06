import { createStorage } from "./storage.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { storageRpc } from "./contract.js";
import { createService } from "./service.js";
import { registerCli } from "./cli.js";

export default function plugin(bb: BbPluginApi) {
  const service = createService(bb);
  const devCleanupEnabled = async () =>
    (await service.state()).policy.deleteDevDataOnCheckoutRemoval;
  const storage = createStorage(bb, devCleanupEnabled);
  bb.events.on("experimental_environment.removed", () =>
    storage.reconcileEnvironmentRemovals(),
  );
  bb.background.schedule("environment-removal-feed", "* * * * *", () =>
    storage.reconcileEnvironmentRemovals(),
  );
  bb.background.schedule(
    "development-storage-cleanup",
    "0 * * * *",
    async () => {
      if (await devCleanupEnabled()) await storage.scanAll();
    },
  );
  const cleanupEnabled = async () =>
    (await service.state()).policy.deleteStorageOnArchive;
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
    startCleanup: storage.startCleanup,
    hosts: () => storage.hosts(),
    host: storage.host,
    scanHost: storage.scanHost,
    scanAll: () => storage.scanAll(),
    removeOrphans: (input) => storage.removeOrphans(input),
    clearLargeFiles: storage.clearLargeFiles,
    startClearLargeFiles: storage.startClearLargeFiles,
    retryWorktreeCleanup: (input) => storage.retryWorktreeCleanup(input),
    clearThread: storage.clearThread,
    clearArchivedFiles: storage.clearArchivedFiles,
    startClearArchivedFiles: storage.startClearArchivedFiles,
    removeDevInstances: (input) => storage.removeDevInstances(input),
    state: () => service.state(),
    preview: (policy) => service.preview(policy),
    configure: (policy) => service.configure(policy),
  });
  registerCli(bb, service, storage);
  bb.background.schedule("retention", "0 * * * *", () => service.sweep());
}
