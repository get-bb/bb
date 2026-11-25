import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type ThreadBackgroundTask,
} from "@bb/server-contract";
import type { ThreadEventBackgroundTaskItem } from "@bb/domain";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import {
  operationComplete,
  operationInProgress,
} from "../../services/lib/operation-response.js";
import { listOpenThreadBackgroundTasks } from "../../services/threads/background-task-reconciliation.js";
import { requireThreadHostCommandEnvironment } from "../../services/threads/thread-command-environment.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../../services/hosts/live-command.js";

function toThreadBackgroundTask(
  item: ThreadEventBackgroundTaskItem,
): ThreadBackgroundTask {
  return {
    itemId: item.id,
    taskType: item.taskType,
    description: item.description,
    taskStatus: item.taskStatus,
    stoppable: item.stoppable === true,
  };
}

export function registerThreadBackgroundTaskRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.backgroundTasks, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json({
      backgroundTasks: listOpenThreadBackgroundTasks(deps.db, {
        threadId: thread.id,
      }).map(toThreadBackgroundTask),
    });
  });

  post(routes.stopBackgroundTask, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const itemId = context.req.param("itemId");
    const isOpenTask = (item: ThreadEventBackgroundTaskItem) =>
      item.id === itemId;
    const task = listOpenThreadBackgroundTasks(deps.db, {
      threadId: thread.id,
    }).find(isOpenTask);
    if (task === undefined) {
      throw new ApiError(
        404,
        "background_task_not_running",
        `Background task ${itemId} is not running in thread ${thread.id}`,
      );
    }
    if (task.stoppable !== true) {
      throw new ApiError(
        409,
        "invalid_request",
        "This thread's provider cannot stop a single background task",
      );
    }
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    const result = await runLiveHostCommand(deps, {
      command: {
        type: "thread.background_task.stop",
        environmentId: environment.id,
        threadId: thread.id,
        itemId,
      },
      hostId: environment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    });
    if (!result.stopped) {
      throw new ApiError(
        404,
        "background_task_not_running",
        `Background task ${itemId} is not running in thread ${thread.id}`,
      );
    }
    const stillOpen = listOpenThreadBackgroundTasks(deps.db, {
      threadId: thread.id,
    }).some(isOpenTask);
    return context.json(
      stillOpen ? operationInProgress() : operationComplete(),
    );
  });
}
