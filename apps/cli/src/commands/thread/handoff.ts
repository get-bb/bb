import { randomUUID } from "node:crypto";
import { Command } from "commander";
import type { ThreadHandoffStatus } from "@bb/server-contract";
import { action, CliExitError } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  outputJson,
  parseReasoningLevel,
  prependErrorContext,
  requireThreadIdOrSelf,
} from "../helpers.js";
import {
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
  parsePermissionMode,
  parseServiceTier,
  PERMISSION_MODE_HELP,
} from "./helpers.js";

const DEFAULT_HANDOFF_REASONING_LEVEL = "medium";
const DEFAULT_HANDOFF_PERMISSION_MODE = "auto";

interface ThreadHandoffCommandOptions {
  archiveSource?: boolean;
  continuation?: string;
  idempotencyKey?: string;
  json?: boolean;
  model: string;
  permissionMode?: string;
  provider: string;
  reasoningLevel?: string;
  self?: boolean;
  serviceTier?: string;
}

function createHandoffIdempotencyKey(): string {
  return `cli-handoff-${randomUUID()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printHandoffStatus(status: ThreadHandoffStatus): void {
  console.log(`Thread handoff: ${status.state}`);
  console.log(`Source: ${status.sourceThreadId}`);
  console.log(`Replacement: ${status.replacementThreadId}`);
  console.log(`Source archived: ${status.sourceArchived ? "yes" : "no"}`);
  if (status.failure) {
    console.log(`Failure: ${status.failure.code} — ${status.failure.message}`);
  }
}

async function waitForHandoffSettlement(args: {
  getStatus: (replacementThreadId: string) => Promise<ThreadHandoffStatus>;
  status: ThreadHandoffStatus;
}): Promise<ThreadHandoffStatus> {
  const deadline = Date.now() + DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS * 1000;
  let status = args.status;
  while (status.state === "provisioning") {
    if (Date.now() >= deadline) {
      throw new CliExitError("Thread handoff is still provisioning", 2);
    }
    status = await args.getStatus(status.replacementThreadId);
    if (status.state === "provisioning") {
      await sleep(DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS);
    }
  }
  return status;
}

export function registerHandoffCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("handoff [source-thread-id]")
    .description(
      "Move a thread to another provider or model and archive the source after the replacement starts",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .requiredOption("--provider <id>", "Replacement provider ID")
    .requiredOption("--model <id>", "Replacement model ID")
    .option(
      "--reasoning-level <level>",
      "Reasoning level: low, medium, high, xhigh, max (provider-dependent)",
    )
    .option("--service-tier <tier>", "Service tier: fast or default")
    .option("--permission-mode <mode>", PERMISSION_MODE_HELP)
    .option(
      "--continuation <text>",
      "Optional continuation text for the replacement opening turn",
    )
    .option("--no-archive-source", "Keep the source thread live after takeover")
    .option(
      "--idempotency-key <key>",
      "Reuse an explicit takeover key instead of generating one",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          sourceThreadIdValue: string | undefined,
          opts: ThreadHandoffCommandOptions,
        ) => {
          const sourceThreadId = requireThreadIdOrSelf(
            sourceThreadIdValue,
            opts,
          );
          const reasoningLevel =
            parseReasoningLevel(opts.reasoningLevel) ??
            DEFAULT_HANDOFF_REASONING_LEVEL;
          const serviceTier = parseServiceTier(opts.serviceTier);
          const permissionMode =
            parsePermissionMode(opts.permissionMode) ??
            DEFAULT_HANDOFF_PERMISSION_MODE;
          const continuationText = opts.continuation?.trim();
          const sdk = createCliBbSdk(getUrl());

          let status: ThreadHandoffStatus;
          try {
            status = await sdk.threads.handoff({
              sourceThreadId,
              providerId: opts.provider,
              model: opts.model,
              reasoningLevel,
              permissionMode,
              archiveSource: opts.archiveSource ?? true,
              idempotencyKey:
                opts.idempotencyKey ?? createHandoffIdempotencyKey(),
              origin: "cli",
              ...(serviceTier === undefined ? {} : { serviceTier }),
              ...(continuationText
                ? { continuationText }
                : {}),
            });
            status = await waitForHandoffSettlement({
              getStatus: (replacementThreadId) =>
                sdk.threads.handoffStatus({ replacementThreadId }),
              status,
            });
          } catch (error: unknown) {
            if (error instanceof CliExitError) {
              throw error;
            }
            throw prependErrorContext(
              `Failed to hand off thread ${sourceThreadId}`,
              error,
            );
          }

          if (outputJson(opts, status)) {
            if (status.state === "failed") {
              throw new CliExitError("Thread handoff failed", 1);
            }
            return;
          }

          printHandoffStatus(status);
          if (status.state === "failed") {
            throw new CliExitError("Thread handoff failed", 1);
          }
        },
      ),
    );
}
