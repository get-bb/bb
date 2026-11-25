import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, reportOperation } from "../../command-result.js";
import { printBorderlessTable } from "../../table.js";
import { requireThreadIdOrSelf } from "../helpers.js";

interface ThreadBackgroundTaskOptions {
  self?: boolean;
  json?: boolean;
}

export function registerBackgroundTaskCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const backgroundTasks = parent
    .command("background-tasks")
    .description(
      "List and stop the background commands and agents running in a thread",
    );

  backgroundTasks
    .command("list [id]")
    .description("List a thread's running background tasks")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadBackgroundTaskOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.experimental_backgroundTasks.list({ threadId });
          if (outputJson(opts, result)) {
            return;
          }
          if (result.backgroundTasks.length === 0) {
            console.log("No background tasks running");
            return;
          }
          printBorderlessTable(
            {
              head: ["ID", "Type", "Stoppable", "Description"],
              colWidths: [24, 16, 11, 70],
              trimTrailingWhitespace: true,
            },
            result.backgroundTasks.map((task) => [
              task.itemId,
              task.taskType,
              task.stoppable ? "yes" : "no",
              task.description,
            ]),
          );
        },
      ),
    );

  backgroundTasks
    .command("stop <taskId> [id]")
    .description(
      "Stop one background task without stopping the thread or its other tasks",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          taskId: string,
          id: string | undefined,
          opts: ThreadBackgroundTaskOptions,
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.experimental_backgroundTasks.stop({
            threadId,
            itemId: taskId,
          });
          reportOperation(
            opts,
            { ...result, threadId, taskId },
            {
              complete: `Background task ${taskId} stopped`,
              inProgress: `Background task ${taskId} is stopping; check it with bb thread background-tasks list ${threadId}`,
            },
          );
        },
      ),
    );
}
