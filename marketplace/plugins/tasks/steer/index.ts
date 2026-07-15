import type { BbPluginApi } from "@bb/plugin-sdk";
import type { TasksStore } from "../db";

export interface DeliverCommentInput {
  taskId: string;
  commentId: string;
  body: string;
  authorName: string;
}

export type CommentDeliveryOutcome =
  | { threadId: string; status: "delivered" }
  | { threadId: string; status: "skipped"; reason: string }
  | { threadId: string; status: "failed"; reason: string };

export interface CommentDeliveryResult {
  notifiedCount: number;
  outcomes: CommentDeliveryOutcome[];
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
): Promise<CommentDeliveryResult> {
  const task = store.getTask(input.taskId);
  if (!task) throw new Error(`Task not found: ${input.taskId}`);

  const activeThreads = store
    .listTaskThreads(input.taskId)
    .filter(
      (thread) =>
        thread.liveStatus === "starting" || thread.liveStatus === "working",
    );
  const prompt = steerPrompt(task.key, input.authorName, input.body);
  const outcomes = await Promise.all(
    activeThreads.map(async (thread): Promise<CommentDeliveryOutcome> => {
      try {
        const current = await bb.sdk.threads.get({
          threadId: thread.threadId,
        });
        if (current.status !== "active") {
          return {
            threadId: thread.threadId,
            status: "skipped",
            reason: `thread is ${current.status}`,
          };
        }

        // The status can change after this read. The SDK does not yet expose
        // an atomic active-only send, so send-time 409s remain possible and
        // are recorded below as non-deliveries.
        await bb.sdk.threads.send({
          threadId: thread.threadId,
          input: [{ type: "text", text: prompt, mentions: [] }],
          mode: "steer",
        });
        return { threadId: thread.threadId, status: "delivered" };
      } catch (error) {
        const reason = errorMessage(error);
        bb.log.warn(
          `failed to steer comment ${input.commentId} to thread ${thread.threadId}: ${reason}`,
        );
        return {
          threadId: thread.threadId,
          status: "failed",
          reason,
        };
      }
    }),
  );
  return {
    notifiedCount: outcomes.filter((outcome) => outcome.status === "delivered")
      .length,
    outcomes,
  };
}
