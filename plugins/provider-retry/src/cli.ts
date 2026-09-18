import {
  experimental_CliError,
  experimental_cliCommand,
  experimental_defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  findQueuedRetry,
  listQueuedRetries,
  type QueuedRetry,
} from "./queued-retries.js";

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const THREAD_ID_POSITIONAL = {
  name: "thread-id",
  description: "Thread whose pending retry to act on; defaults to this thread",
} as const;

function textQueuedRetry(queued: QueuedRetry): string {
  const retry =
    queued.sendAt === null
      ? "pending"
      : `retrying ${new Date(queued.sendAt).toISOString()}`;
  return `${queued.threadId}\t${queued.id}\t${retry}`;
}

function requiredThreadId(
  requested: string | undefined,
  context: PluginCliContext,
  command: "cancel" | "retry",
): string {
  const threadId = requested ?? context.threadId;
  if (threadId === undefined) {
    throw new experimental_CliError(
      `A thread id is required: bb provider-retry ${command} <thread-id>`,
      { code: "missing_thread_id", exitCode: 2 },
    );
  }
  return threadId;
}

async function act(
  bb: BbPluginApi,
  threadId: string,
  json: boolean,
  command: "cancel" | "retry",
): Promise<PluginCliResult> {
  const queued = await findQueuedRetry(bb, threadId);
  if (queued === null) {
    throw new experimental_CliError(
      `No pending provider retry exists for ${threadId}.`,
      {
        code: "no_pending_retry",
        hint: "Run `bb provider-retry status` for the threads with a pending retry.",
      },
    );
  }
  if (command === "cancel") {
    await bb.sdk.threads.queuedMessages.delete({
      threadId: queued.threadId,
      queuedMessageId: queued.id,
    });
  } else {
    await bb.sdk.threads.queuedMessages.send({
      threadId: queued.threadId,
      queuedMessageId: queued.id,
      mode: "auto",
    });
  }
  if (json) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ ok: true, threadId, queuedMessageId: queued.id }, null, 2)}\n`,
    };
  }
  return {
    exitCode: 0,
    stdout:
      command === "cancel"
        ? `Cancelled provider retry for ${threadId}.\n`
        : `Retrying ${threadId} now.\n`,
  };
}

export function registerProviderRetryCli(bb: BbPluginApi): void {
  bb.cli.register(
    experimental_defineCli({
      name: "provider-retry",
      summary: "Manage pending automatic provider retries",
      description:
        "A pending retry is an ordinary durable queued row: cancel deletes it, retry sends it now instead of waiting for its window.",
      usageErrorExitCode: 2,
      commands: {
        status: experimental_cliCommand({
          summary: "Show pending automatic provider retries",
          positionals: [
            {
              name: "thread-id",
              description:
                "Thread to scope the listing to; defaults to this thread, and lists every thread outside one",
            },
          ],
          options: { json: JSON_OPTION },
          async run(input, context) {
            const threadId =
              input.positionals["thread-id"] ?? context.threadId ?? null;
            const queued = await listQueuedRetries(
              bb,
              threadId === null ? undefined : threadId,
            );
            if (input.options.json) {
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ retries: queued }, null, 2)}\n`,
              };
            }
            return {
              exitCode: 0,
              stdout:
                queued.length === 0
                  ? "No provider retries are pending.\n"
                  : `${queued.map(textQueuedRetry).join("\n")}\n`,
            };
          },
        }),
        cancel: experimental_cliCommand({
          summary: "Cancel a pending automatic provider retry",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input, context) =>
            act(
              bb,
              requiredThreadId(
                input.positionals["thread-id"],
                context,
                "cancel",
              ),
              input.options.json,
              "cancel",
            ),
        }),
        retry: experimental_cliCommand({
          summary: "Send a pending provider retry now instead of waiting",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input, context) =>
            act(
              bb,
              requiredThreadId(
                input.positionals["thread-id"],
                context,
                "retry",
              ),
              input.options.json,
              "retry",
            ),
        }),
      },
    }),
  );
}
