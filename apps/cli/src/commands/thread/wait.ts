import { Command } from "commander";
import { threadStatusSchema, threadStatusValues } from "@bb/domain";
import {
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  type ThreadWaitTarget,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
} from "@bb/sdk";
import { action, CliExitError } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { durationHelp } from "../../duration.js";
import { outputJson, requireThreadId } from "../helpers.js";
import {
  DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
  parseThreadWaitPollIntervalMs,
  parseThreadWaitTimeoutMs,
  THREAD_WAIT_EXIT_CODE_INVALID_REQUEST,
  THREAD_WAIT_EXIT_CODE_TIMEOUT,
  THREAD_WAIT_EXIT_CODE_UNREACHABLE,
} from "./helpers.js";

interface ThreadWaitCommandOptions {
  status?: string;
  event?: string;
  timeout?: string;
  pollInterval?: string;
  json?: boolean;
}

export function registerWaitCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("wait <id>")
    .description(
      "Wait for a thread status or event (defaults to --status idle)",
    )
    .option("--status <status>", "Wait until the thread reaches this status")
    .option(
      "--event <type>",
      "Wait until the thread log includes this event type",
    )
    .option(
      "--timeout <duration>",
      `Timeout as ${durationHelp("s")} (default: ${DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS}s)`,
    )
    .option(
      "--poll-interval <duration>",
      `Polling interval as ${durationHelp("ms")} (default: ${DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS}ms)`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadWaitCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const threadId = requireThreadId(id);
        const target = parseThreadWaitTarget(opts);
        const timeoutMs = parseThreadWaitTimeoutMs(opts.timeout);
        const pollIntervalMs = parseThreadWaitPollIntervalMs(opts.pollInterval);
        const waitArgs = {
          threadId,
          timeoutMs,
          pollIntervalMs,
          ...(target.kind === "status"
            ? { status: target.status }
            : { event: target.eventType }),
        };
        let result: Awaited<ReturnType<typeof sdk.threads.wait>>;
        try {
          result = await sdk.threads.wait(waitArgs);
        } catch (error) {
          if (error instanceof ThreadWaitTimeoutError) {
            throw new CliExitError(
              error.message,
              THREAD_WAIT_EXIT_CODE_TIMEOUT,
            );
          }
          if (error instanceof ThreadWaitUnreachableError) {
            throw new CliExitError(
              error.message,
              THREAD_WAIT_EXIT_CODE_UNREACHABLE,
            );
          }
          throw error;
        }

        if (outputJson(opts, { threadId, matched: true, target })) return;
        if (!("event" in result)) {
          console.log(
            `Thread ${threadId} reached status ${result.target.status}.`,
          );
          return;
        }
        console.log(
          `Thread ${threadId} observed event ${result.target.eventType} at seq ${result.event.seq}.`,
        );
      }),
    );
}

function parseThreadWaitTarget(
  opts: ThreadWaitCommandOptions,
): ThreadWaitTarget {
  const hasStatus = Boolean(opts.status);
  const hasEvent = Boolean(opts.event);
  if (hasStatus && hasEvent) {
    throw new CliExitError(
      "Provide only one of --status or --event.",
      THREAD_WAIT_EXIT_CODE_INVALID_REQUEST,
    );
  }

  if (!hasEvent) {
    const status = opts.status ?? "idle";
    const parsed = threadStatusSchema.safeParse(status);
    if (parsed.success) {
      return { kind: "status", status: parsed.data };
    }
    throw new CliExitError(
      `Invalid thread status '${status}'. Expected one of ${threadStatusValues.join(", ")}.`,
      THREAD_WAIT_EXIT_CODE_INVALID_REQUEST,
    );
  }

  return {
    kind: "event",
    eventType: opts.event ?? "",
  };
}
