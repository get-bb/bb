import path from "node:path";
import { getHost, listExistingThreadIds } from "@bb/db";
import { isRawThreadId } from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { requireConnectedHostSession } from "../lib/entity-lookup.js";
import { isServerMoveFrozen } from "../server-move/freeze-state.js";

const THREAD_ID_LOOKUP_BATCH_SIZE = 1_000;

export function installThreadStorageOrphanCleanup(
  deps: LoggedWorkSessionDeps,
): { stop(): void } {
  const runningHosts = new Set<string>();
  let stopped = false;

  function request(hostId: string): void {
    if (stopped || runningHosts.has(hostId)) return;
    runningHosts.add(hostId);
    void removeOrphanedThreadStorage(deps, {
      hostId,
      isStopped: () => stopped,
    })
      .catch((error) => {
        deps.logger.warn(
          { err: error, hostId },
          "Thread storage orphan cleanup failed",
        );
      })
      .finally(() => {
        runningHosts.delete(hostId);
      });
  }

  const unsubscribe = deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "host" &&
      message.changes.includes("host-connected")
    ) {
      request(message.id);
    }
  });
  for (const hostId of deps.hub.listConnectedHostIds()) {
    request(hostId);
  }

  return {
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}

export async function removeOrphanedThreadStorage(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; isStopped: () => boolean },
): Promise<void> {
  const { hostId } = args;
  if (
    isServerMoveFrozen(deps.db) ||
    !deps.hub.hasDaemonForHost(hostId) ||
    getHost(deps.db, hostId)?.phase !== "active"
  ) {
    return;
  }
  const session = requireConnectedHostSession(deps, hostId);
  const rootPath = path.join(session.dataDir, "thread-storage");
  const listing = await callHostOnlineRpc(deps, {
    command: { type: "host.browse_directory", path: rootPath },
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  const storedThreadIds = listing.entries
    .filter((entry) => entry.kind === "directory" && isRawThreadId(entry.name))
    .map((entry) => entry.name);
  const existingThreadIds = new Set<string>();
  for (
    let start = 0;
    start < storedThreadIds.length;
    start += THREAD_ID_LOOKUP_BATCH_SIZE
  ) {
    for (const threadId of listExistingThreadIds(
      deps.db,
      storedThreadIds.slice(start, start + THREAD_ID_LOOKUP_BATCH_SIZE),
    )) {
      existingThreadIds.add(threadId);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  let removed = 0;
  for (const threadId of storedThreadIds) {
    if (existingThreadIds.has(threadId)) continue;
    if (
      args.isStopped() ||
      isServerMoveFrozen(deps.db) ||
      deps.hub.getDaemonSessionIdForHost(hostId) !== session.id
    ) {
      break;
    }
    try {
      await callHostOnlineRpc(deps, {
        command: {
          type: "host.remove_path",
          path: path.join(rootPath, threadId),
          recursive: true,
          rootPath,
        },
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      removed += 1;
    } catch (error) {
      deps.logger.warn(
        { err: error, hostId, threadId },
        "Failed to remove orphaned thread storage",
      );
      if (
        !(error instanceof ApiError) ||
        error.body.code === "command_timeout" ||
        error.body.code === "host_unavailable"
      ) {
        break;
      }
    }
  }
  if (removed > 0) {
    deps.logger.info(
      { hostId, removed },
      "Removed thread storage with no thread record",
    );
  }
}
