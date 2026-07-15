import type { BbPluginApi } from "@bb/plugin-sdk";
import type { TasksStore } from "../db";

export interface DeliverCommentInput {
  taskId: string;
  commentId: string;
  body: string;
  authorName: string;
}

function steerPrompt(
  taskKey: string,
  authorName: string,
  body: string,
): string {
  return (
    `New comment on task ${taskKey} from ${authorName}: ${body}\n\n` +
    "This is a steer — fold it into your current work on this task; " +
    `reply via bb tasks comment ${taskKey} when relevant.`
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function deliverCommentToAgents(
  bb: BbPluginApi,
  store: TasksStore,
  input: DeliverCommentInput,
): Promise<number> {
  const task = store.getTask(input.taskId);
  if (!task) throw new Error(`Task not found: ${input.taskId}`);

  const activeThreads = store
    .listTaskThreads(input.taskId)
    .filter(
      (thread) =>
        thread.liveStatus === "starting" || thread.liveStatus === "working",
    );
  const prompt = steerPrompt(task.key, input.authorName, input.body);
  const results = await Promise.allSettled(
    activeThreads.map((thread) =>
      Promise.resolve().then(() =>
        bb.sdk.threads.send({
          threadId: thread.threadId,
          input: [{ type: "text", text: prompt, mentions: [] }],
          mode: "steer",
        }),
      ),
    ),
  );

  let deliveredCount = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      deliveredCount += 1;
      return;
    }
    const thread = activeThreads[index];
    bb.log.warn(
      `failed to steer comment ${input.commentId} to thread ${thread?.threadId ?? "unknown"}: ${errorMessage(result.reason)}`,
    );
  });
  return deliveredCount;
}
