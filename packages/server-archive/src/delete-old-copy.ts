import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { writeServerMovedFile, type ServerMovedFile } from "./markers.js";

const OLD_COPY_PROTECTED_ENTRIES: ReadonlySet<string> = new Set([
  "auth.json",
  "bb-app-runtime.json",
  "checkouts",
  "config.json",
  "daemon.lock",
  "env.json",
  "host-id",
  "last-server-move.json",
  "logs",
  "npm",
  "personal-workspaces",
  "runtime",
  "server-moved.json",
  "thread-storage",
  "worktrees",
]);

export async function deleteOldServerCopy(
  dataDir: string,
  lock: ServerMovedFile,
  onSkippedEntry: (entry: string) => void = () => {},
): Promise<{ dataDir: string; deleted: boolean; deletedEntries: string[] }> {
  const root = resolve(dataDir);
  const deletedEntries: string[] = [];
  for (const entry of lock.oldCopyEntries) {
    const target = resolve(root, ...entry.split("/"));
    const topLevel = entry.split("/")[0] ?? entry;
    if (
      !target.startsWith(`${root}${sep}`) ||
      OLD_COPY_PROTECTED_ENTRIES.has(topLevel)
    ) {
      onSkippedEntry(entry);
      continue;
    }
    await rm(target, { recursive: true, force: true });
    if (entry.endsWith(".db")) {
      await Promise.all(
        ["-wal", "-shm", "-journal"].map((suffix) =>
          rm(`${target}${suffix}`, { force: true }),
        ),
      );
    }
    deletedEntries.push(entry);
  }
  await writeServerMovedFile(dataDir, { ...lock, oldCopyEntries: [] });
  return { dataDir, deleted: true, deletedEntries };
}
