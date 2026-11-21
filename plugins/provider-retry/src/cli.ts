import { readRetryDiagnostic } from "./diagnostics.js";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  HandoffUnavailableError,
  noHandoffMessage,
  readHandoffOffer,
} from "./handoff.js";
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
  command: "cancel" | "retry" | "explain" | "continue",
): string {
  const threadId = requested ?? context.threadId;
  if (threadId === undefined) {
    throw new PluginCliError(
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
    throw new PluginCliError(
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

async function continueElsewhere(
  bb: BbPluginApi,
  threadId: string,
  json: boolean,
  handoff: (threadId: string) => Promise<{ threadId: string }>,
): Promise<PluginCliResult> {
  const refuse = (message: string) =>
    new PluginCliError(message, {
      code: "no_handoff",
      hint: "Set a fallback provider with `bb settings general fallbackProviderId <id>`, and run `bb provider-retry explain` for the last failure.",
    });
  const offer = await readHandoffOffer(bb, threadId);
  if (offer === null) throw refuse(noHandoffMessage(threadId));
  const created = await handoff(threadId).catch((error: unknown) => {
    if (error instanceof HandoffUnavailableError) throw refuse(error.message);
    throw error;
  });
  if (json) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ ok: true, threadId, continuedIn: created.threadId, providerId: offer.to.id }, null, 2)}\n`,
    };
  }
  return {
    exitCode: 0,
    stdout:
      offer.continuedIn === null
        ? `Continued ${threadId} in ${offer.to.name}: ${created.threadId}\n`
        : `${threadId} already continues in ${created.threadId}.\n`,
  };
}

export function registerProviderRetryCli(
  bb: BbPluginApi,
  handoff: (threadId: string) => Promise<{ threadId: string }>,
): void {
  bb.cli.register(
    defineCli({
      name: "provider-retry",
      summary: "Manage pending automatic provider retries",
      description:
        "A pending retry is an ordinary durable queued row: cancel deletes it, retry sends it now instead of waiting for its window.",
      usageErrorExitCode: 2,
      commands: {
        status: cliCommand({
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
        explain: cliCommand({
          summary: "Explain the last automatic retry decision for a thread",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          async run(input, context) {
            const threadId = requiredThreadId(
              input.positionals["thread-id"],
              context,
              "explain",
            );
            const diagnostic = await readRetryDiagnostic(bb, threadId);
            if (input.options.json)
              return {
                exitCode: 0,
                stdout: `${JSON.stringify({ threadId, diagnostic }, null, 2)}\n`,
              };
            if (diagnostic === null)
              return {
                exitCode: 0,
                stdout: `No automatic retry decision recorded for ${threadId}.\n`,
              };
            const { decision, availability } = diagnostic;
            return {
              exitCode: 0,
              stdout: `${threadId}: ${decision.kind === "retry" ? `Scheduled for ${new Date(decision.sendAt).toISOString()}` : "Skipped"}: ${decision.reason}${availability.kind === "unavailable" ? ` (${availability.reason})` : ""}.\n`,
            };
          },
        }),
        cancel: cliCommand({
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
        continue: cliCommand({
          summary:
            "Continue a thread that hit a usage limit in a new thread on the fallback provider",
          positionals: [THREAD_ID_POSITIONAL],
          options: { json: JSON_OPTION },
          run: (input, context) =>
            continueElsewhere(
              bb,
              requiredThreadId(
                input.positionals["thread-id"],
                context,
                "continue",
              ),
              input.options.json,
              handoff,
            ),
        }),
        retry: cliCommand({
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
