import { Command } from "commander";
import {
  type PermissionMode,
  type ReasoningLevel,
  type ServiceTier,
} from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  confirmDestructiveAction,
  outputJson,
  parseReasoningLevel,
  prependErrorContext,
  requireThreadIdOrSelf,
} from "../helpers.js";
import { resolveExplicitIdFlag, resolveThreadId } from "../../context-env.js";
import {
  parsePermissionMode,
  parseServiceTier,
  PERMISSION_MODE_HELP,
} from "./helpers.js";

interface ThreadUpdateCommandOptions {
  self?: boolean;
  json?: boolean;
  title?: string;
  parentThread?: string;
  clearParentThread?: boolean;
  model?: string;
  reasoningLevel?: string;
}

interface ThreadArchiveCommandOptions {
  self?: boolean;
  json?: boolean;
}

interface ThreadUnarchiveCommandOptions {
  self?: boolean;
  json?: boolean;
}

interface ThreadPinCommandOptions {
  self?: boolean;
  json?: boolean;
}

interface ThreadDeleteCommandOptions {
  confirmChildThreads?: boolean;
  yes?: boolean;
  json?: boolean;
}

interface ThreadTellCommandOptions {
  json?: boolean;
  model?: string;
  permissionMode?: string;
  reasoningLevel?: string;
  serviceTier?: string;
  mode?: string;
}

interface ThreadStopCommandOptions {
  self?: boolean;
  json?: boolean;
}

type ThreadTellDeliveryMode = "auto" | "queue" | "steer";

interface PostThreadMessageArgs {
  getUrl: () => string;
  threadId: string;
  message: string;
  mode: ThreadTellDeliveryMode;
  model?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
  senderThreadId?: string;
}

interface PostThreadMessageResult {
  ok: true;
  mode: ThreadTellDeliveryMode;
}

interface ThreadUpdateBody {
  title?: string;
  parentThreadId?: string | null;
  model?: string;
  reasoningLevel?: ReasoningLevel;
}

export function registerActionsCommands(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("update [id]")
    .description("Update a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .option("--title <title>", "Set the thread title")
    .option("--parent-thread <id>", "Set the parent thread id")
    .option("--clear-parent-thread", "Clear the parent thread id")
    .option(
      "--model <model>",
      "Set the sticky model applied on the thread's next turn",
    )
    .option(
      "--reasoning-level <level>",
      "Set the sticky reasoning level applied on the thread's next turn: low, medium, high, xhigh, max (provider-dependent)",
    )
    .action(
      action(
        async (id: string | undefined, opts: ThreadUpdateCommandOptions) => {
          if (opts.parentThread && opts.clearParentThread) {
            throw new Error(
              "Cannot combine --parent-thread with --clear-parent-thread.",
            );
          }
          const reasoningLevel = parseReasoningLevel(opts.reasoningLevel);
          if (
            !opts.parentThread &&
            !opts.clearParentThread &&
            !opts.title &&
            !opts.model &&
            !reasoningLevel
          ) {
            throw new Error(
              "No changes requested. Provide --title, --parent-thread, --clear-parent-thread, --model, or --reasoning-level.",
            );
          }

          const threadId = requireThreadIdOrSelf(id, opts);
          const parentThreadId = resolveExplicitIdFlag({
            flagName: "--parent-thread",
            value: opts.parentThread,
          });
          const body: ThreadUpdateBody = {};
          if (opts.title) {
            body.title = opts.title;
          }
          if (parentThreadId) {
            body.parentThreadId = parentThreadId;
          } else if (opts.clearParentThread) {
            body.parentThreadId = null;
          }
          if (opts.model) {
            body.model = opts.model;
          }
          if (reasoningLevel) {
            body.reasoningLevel = reasoningLevel;
          }

          const sdk = createCliBbSdk(getUrl());
          const thread = await sdk.threads.update({ threadId, ...body });
          if (outputJson(opts, thread)) return;
          console.log(`Thread ${thread.id} updated`);
          if (opts.title) {
            console.log(`Title: ${thread.title ?? "<untitled>"}`);
          }
          if (opts.parentThread || opts.clearParentThread) {
            console.log(
              thread.parentThreadId
                ? `Parent: ${thread.parentThreadId}`
                : "No parent thread",
            );
          }
          if (opts.model) {
            console.log(`Model: ${opts.model}`);
          }
          if (reasoningLevel) {
            console.log(`Reasoning level: ${reasoningLevel}`);
          }
        },
      ),
    );

  parent
    .command("archive [id]")
    .description("Archive a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadArchiveCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          try {
            await sdk.threads.archive({ threadId });
          } catch (err: unknown) {
            throw prependErrorContext(
              `Failed to archive thread ${threadId}`,
              err,
            );
          }
          if (outputJson(opts, { ok: true, threadId })) return;
          console.log(`Thread ${threadId} archived`);
        },
      ),
    );

  parent
    .command("unarchive [id]")
    .description("Unarchive a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadUnarchiveCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          await sdk.threads.unarchive({ threadId });
          if (outputJson(opts, { ok: true, threadId })) return;
          console.log(`Thread ${threadId} unarchived`);
        },
      ),
    );

  parent
    .command("pin [id]")
    .description("Pin a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadPinCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const thread = await sdk.threads.pin({ threadId });
        if (outputJson(opts, thread)) return;
        console.log(`Thread ${thread.id} pinned`);
      }),
    );

  parent
    .command("unpin [id]")
    .description("Unpin a thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadPinCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const thread = await sdk.threads.unpin({ threadId });
        if (outputJson(opts, thread)) return;
        console.log(`Thread ${thread.id} unpinned`);
      }),
    );

  parent
    .command("delete <id>")
    .description("Delete a thread permanently")
    .option("--yes", "Skip the confirmation prompt")
    .option(
      "--confirm-child-threads",
      "Confirm deleting a thread with child threads",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ThreadDeleteCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        try {
          const thread = await sdk.threads.get({ threadId: id });

          if (!opts.yes) {
            const confirmed = await confirmDestructiveAction(
              `Delete thread "${thread.title ?? thread.titleFallback ?? thread.id}" permanently? This cannot be undone.`,
            );
            if (!confirmed) {
              console.log(`Thread ${id} deletion cancelled`);
              return;
            }
          }

          await sdk.threads.delete({
            threadId: id,
            childThreadsConfirmed: opts.confirmChildThreads === true,
          });
        } catch (err: unknown) {
          throw prependErrorContext(`Failed to delete thread ${id}`, err);
        }
        if (outputJson(opts, { ok: true, threadId: id })) return;
        console.log(`Thread ${id} deleted`);
      }),
    );

  parent
    .command("tell <id> <message>")
    .description("Send a follow-up message to a thread")
    .option("--json", "Print machine-readable JSON output")
    .option("--model <model>", "Model ID for this message")
    .option("--service-tier <tier>", "Service tier: fast or default")
    .option(
      "--reasoning-level <level>",
      "Reasoning level: low, medium, high, xhigh, max (provider-dependent)",
    )
    .option("--permission-mode <mode>", PERMISSION_MODE_HELP)
    .option("--mode <mode>", "Message mode: queue, steer, or auto")
    .action(
      action(
        async (id: string, message: string, opts: ThreadTellCommandOptions) => {
          const response = await postThreadMessage({
            getUrl,
            threadId: id,
            message,
            mode: resolveThreadMessageMode(opts.mode),
            model: opts.model,
            permissionMode: parsePermissionMode(opts.permissionMode),
            reasoningLevel: parseReasoningLevel(opts.reasoningLevel),
            serviceTier: parseServiceTier(opts.serviceTier),
            senderThreadId: resolveSenderThreadId(id),
          });
          if (outputJson(opts, { threadId: id, ...response })) return;
          console.log(
            response.mode === "steer"
              ? `Thread ${id} steered`
              : `Thread ${id} updated`,
          );
        },
      ),
    );

  parent
    .command("stop [id]")
    .description("Stop an active or provisioning thread")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadStopCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        await sdk.threads.stop({ threadId });
        if (outputJson(opts, { ok: true, threadId })) return;
        console.log(`Thread ${threadId} stopped`);
      }),
    );
}

async function postThreadMessage(
  args: PostThreadMessageArgs,
): Promise<PostThreadMessageResult> {
  const sdk = createCliBbSdk(args.getUrl());
  await sdk.threads.send({
    threadId: args.threadId,
    input: [{ type: "text", text: args.message, mentions: [] }],
    mode:
      args.mode === "steer"
        ? "steer-if-active"
        : args.mode === "auto"
          ? "auto"
          : "queue-if-active",
    ...(args.model ? { model: args.model } : {}),
    ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
    ...(args.reasoningLevel ? { reasoningLevel: args.reasoningLevel } : {}),
    ...(args.serviceTier ? { serviceTier: args.serviceTier } : {}),
    ...(args.senderThreadId ? { senderThreadId: args.senderThreadId } : {}),
  });
  return {
    ok: true,
    mode: args.mode,
  };
}

function resolveSenderThreadId(targetThreadId: string): string | undefined {
  const senderThreadId = resolveThreadId();
  if (!senderThreadId || senderThreadId === targetThreadId) {
    return undefined;
  }
  return senderThreadId;
}

function resolveThreadMessageMode(
  value: string | undefined,
): ThreadTellDeliveryMode {
  if (value === undefined) return "queue";
  const normalized = value.trim().toLowerCase();
  if (normalized === "steer") return "steer";
  if (normalized === "steer-if-active") return "steer";
  if (normalized === "queue") return "queue";
  if (normalized === "queue-if-active") return "queue";
  if (normalized === "auto") return "auto";
  throw new Error(
    `Invalid message mode '${value}'. Expected 'queue', 'steer', or 'auto'.`,
  );
}
