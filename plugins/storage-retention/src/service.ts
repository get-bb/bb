import { readThreads, readThreadsById } from "./sdk-data.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { policySchema, runSchema, type Policy, type Run } from "./contract.js";
import { selectCandidates } from "./policy.js";

const DEFAULT_POLICY: Policy = {
  archiveAfterDays: null,
  deleteAfterDays: null,
  deleteStorageOnArchive: false,
  deleteDevDataOnCheckoutRemoval: false,
};
const BATCH_LIMIT = 50;
const SNAPSHOT_MAX_AGE_MS = 60_000;

export function createService(bb: BbPluginApi) {
  let disposed = false;
  let running = false;
  bb.onDispose(() => {
    disposed = true;
  });
  function requireActive() {
    if (disposed) throw new Error("Storage & retention plugin is disabled.");
  }
  async function readPolicy() {
    const stored = await bb.storage.kv.get("policy");
    return stored === null || stored === undefined
      ? DEFAULT_POLICY
      : policySchema.parse(stored);
  }
  async function state() {
    const [policy, lastRun] = await Promise.all([
      readPolicy(),
      bb.storage.kv.get("lastRun"),
    ]);
    return {
      policy,
      lastRun: lastRun == null ? null : runSchema.parse(lastRun),
    };
  }
  async function candidates(policy: Policy) {
    const threads = await readThreads(bb);
    return selectCandidates(threads, policy, Date.now());
  }
  async function preview(policy: Policy) {
    requireActive();
    const result = await candidates(policy);
    const count = (groups: typeof result.archive) =>
      new Set(groups.flatMap((group) => group.memberIds)).size;
    return {
      archiveCount: count(result.archive),
      deleteCount: count(result.delete),
    };
  }
  async function configure(policy: Policy) {
    requireActive();
    await bb.storage.kv.set("policy", policySchema.parse(policy));
    bb.realtime.publish("policy-changed", null);
    return state();
  }
  async function sweep() {
    if (running || disposed) return;
    running = true;
    try {
      const policy = await readPolicy();
      if (policy.archiveAfterDays === null && policy.deleteAfterDays === null)
        return;
      const stats = {
        fullReads: 0,
        fullReadMs: 0,
        byIdReads: 0,
        cascadeCalls: 0,
        archiveCalls: 0,
        deleteCalls: 0,
        cascadeSkips: 0,
      };
      async function takeSnapshot() {
        const takenAt = Date.now();
        stats.fullReads++;
        try {
          const rows = await readThreads(bb);
          return {
            takenAt,
            byId: new Map(rows.map((thread) => [thread.id, thread])),
          };
        } finally {
          stats.fullReadMs += Date.now() - takenAt;
        }
      }
      let snapshot = await takeSnapshot();
      const selected = selectCandidates(
        [...snapshot.byId.values()],
        policy,
        Date.now(),
      );
      const run: Run = {
        ranAt: Date.now(),
        archivedCount: 0,
        deletedCount: 0,
        failedCount: 0,
      };
      for (const action of ["archive", "delete"] as const) {
        for (const candidate of selected[action].slice(0, BATCH_LIMIT)) {
          if (disposed) return;
          const current = await readPolicy();
          if (disposed) return;
          if (
            current.archiveAfterDays !== policy.archiveAfterDays ||
            current.deleteAfterDays !== policy.deleteAfterDays
          )
            break;
          try {
            if (Date.now() - snapshot.takenAt >= SNAPSHOT_MAX_AGE_MS) {
              snapshot = await takeSnapshot();
              if (disposed) return;
            }
            const derived = selectCandidates(
              [...snapshot.byId.values()],
              current,
              Date.now(),
            )[action].find((entry) => entry.rootId === candidate.rootId);
            const root = snapshot.byId.get(candidate.rootId);
            if (derived === undefined || root === undefined) continue;
            const requested = [
              ...new Set(
                [
                  ...derived.memberIds,
                  root.parentThreadId,
                  root.sourceThreadId,
                ].filter((id): id is string => id !== null),
              ),
            ];
            stats.byIdReads++;
            const rereads = await readThreadsById(bb, requested);
            if (disposed) return;
            const overlay = new Map(snapshot.byId);
            for (const id of requested) {
              const row = rereads.get(id);
              if (row === undefined) overlay.delete(id);
              else overlay.set(id, row);
            }
            const fresh = selectCandidates(
              [...overlay.values()],
              current,
              Date.now(),
            )[action].find((entry) => entry.rootId === candidate.rootId);
            if (fresh === undefined) continue;
            if (action === "archive") {
              stats.cascadeCalls++;
              const cascade = await bb.sdk.threads.experimental_listCascade({
                threadIds: [candidate.rootId],
                action: "archive",
              });
              if (disposed) return;
              const members = new Set(fresh.memberIds);
              const unexpected = cascade.threads
                .flatMap((entry) => entry.cascadeThreadIds)
                .find((id) => !members.has(id));
              if (unexpected !== undefined) {
                stats.cascadeSkips++;
                bb.log.info(
                  `Skipped archiving ${candidate.rootId}: core would also archive ${unexpected}.`,
                );
                continue;
              }
            }
            if (disposed) return;
            if (action === "archive") {
              stats.archiveCalls++;
              const result = await bb.sdk.threads.archive({
                threadId: candidate.rootId,
              });
              run.archivedCount += result.archivedThreadIds.length;
            } else {
              stats.deleteCalls++;
              await bb.sdk.threads.delete({
                threadId: candidate.rootId,
                childThreadsConfirmed: true,
              });
              run.deletedCount += fresh.memberIds.length;
            }
          } catch (error) {
            run.failedCount++;
            bb.log.warn(
              `Could not ${action} ${candidate.rootId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      if (!disposed) {
        bb.log.info(
          `Retention sweep: ${stats.fullReads} full reads in ${stats.fullReadMs} ms, ${stats.byIdReads} by-ID reads, ${stats.cascadeCalls} cascade calls, ${stats.archiveCalls} archive calls, ${stats.deleteCalls} delete calls, ${stats.cascadeSkips} cascade skips.`,
        );
        await bb.storage.kv.set("lastRun", run);
        bb.realtime.publish("changed", null);
      }
    } finally {
      running = false;
    }
  }
  return { state, preview, configure, sweep };
}
export type Service = ReturnType<typeof createService>;
