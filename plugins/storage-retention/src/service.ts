import { readThreads } from "./sdk-data.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { policySchema, runSchema, type Policy, type Run } from "./contract.js";
import { selectCandidates } from "./policy.js";

const DEFAULT_POLICY: Policy = {
  archiveAfterDays: null,
  deleteAfterDays: null,
};
const BATCH_LIMIT = 50;

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
    bb.realtime.publish("changed", null);
    return state();
  }
  async function sweep() {
    if (running || disposed) return;
    running = true;
    try {
      const policy = await readPolicy();
      if (policy.archiveAfterDays === null && policy.deleteAfterDays === null)
        return;
      const selected = await candidates(policy);
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
            if (action === "archive") {
              const result = await bb.sdk.threads.archive({
                threadId: candidate.rootId,
              });
              run.archivedCount += result.archivedThreadIds.length;
            } else {
              await bb.sdk.threads.delete({
                threadId: candidate.rootId,
                childThreadsConfirmed: true,
              });
              run.deletedCount += candidate.memberIds.length;
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
