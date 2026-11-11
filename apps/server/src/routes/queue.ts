import { listQueuedThreadMessagesForApi } from "@bb/db";
import { publicApiRoutes } from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";
import type { AppDeps } from "../types.js";
import { toThreadQueuedMessage } from "../services/threads/thread-queued-messages.js";

/**
 * The cross-thread queue list.
 *
 * A thread's own rows are served by `GET /threads/:id/queued-messages`, which
 * is also where every per-row operation lives. This route exists for the one
 * question that list cannot answer: "what is queued right now, anywhere" — a
 * workspace-wide pending view, a limiter plugin's bookkeeping, or a plugin
 * recovering the rows it is holding after a restart. It replaced `GET /holds`,
 * which existed for exactly the same reason.
 */
export function registerQueueRoutes(
  routes: OperationRoutes,
  deps: AppDeps,
): void {
  routes.implement(publicApiRoutes.queue.list, (query) =>
    listQueuedThreadMessagesForApi(deps.db, {
      ...(query.threadId !== undefined ? { threadId: query.threadId } : {}),
      ...(query.waitHolder !== undefined
        ? { waitHolder: query.waitHolder }
        : {}),
    }).map(toThreadQueuedMessage),
  );
}
