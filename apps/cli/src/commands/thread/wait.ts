import type { Command } from "commander";
import { threadStatusSchema, threadStatusValues } from "@bb/domain";
import {
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  type ThreadWaitTarget,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
} from "@bb/sdk";
import { CliExitError } from "../../action.js";
import { arg, flag } from "../../cli-door.js";
import { clientCommand, mountCommand } from "../../operation-doors.js";
import { durationHelp } from "../../duration.js";
import { requireThreadId } from "../helpers.js";
import {
  DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
  parseThreadWaitPollIntervalMs,
  parseThreadWaitTimeoutMs,
  THREAD_WAIT_EXIT_CODE_INVALID_REQUEST,
  THREAD_WAIT_EXIT_CODE_TIMEOUT,
  THREAD_WAIT_EXIT_CODE_UNREACHABLE,
} from "./helpers.js";

interface ThreadWaitCommandOptions {
  status: string | undefined;
  event: string | undefined;
}

export const threadWaitCommand = clientCommand({
  path: ["thread", "wait"],
  summary: "Wait for a thread status or event (defaults to --status idle)",
  positionals: { id: arg("<id>") },
  options: {
    status: flag(
      "--status <status>",
      "Wait until the thread reaches this status",
    ),
    event: flag(
      "--event <type>",
      "Wait until the thread log includes this event type",
    ),
    timeout: flag(
      "--timeout <duration>",
      `Timeout as ${durationHelp("s")} (default: ${DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS}s)`,
    ),
    pollInterval: flag(
      "--poll-interval <duration>",
      `Polling interval as ${durationHelp("ms")} (default: ${DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS}ms)`,
    ),
  },
  run: async ({ positionals, options }, client) => {
    const threadId = requireThreadId(positionals.id);
    const target = parseThreadWaitTarget(options);
    const timeoutMs = parseThreadWaitTimeoutMs(options.timeout);
    const pollIntervalMs = parseThreadWaitPollIntervalMs(options.pollInterval);
    try {
      return await client.sdk().threads.wait({
        threadId,
        timeoutMs,
        pollIntervalMs,
        ...(target.kind === "status"
          ? { status: target.status }
          : { event: target.eventType }),
      });
    } catch (error) {
      if (error instanceof ThreadWaitTimeoutError) {
        throw new CliExitError(error.message, THREAD_WAIT_EXIT_CODE_TIMEOUT);
      }
      if (error instanceof ThreadWaitUnreachableError) {
        throw new CliExitError(
          error.message,
          THREAD_WAIT_EXIT_CODE_UNREACHABLE,
        );
      }
      throw error;
    }
  },
  json: (result) => ({
    threadId: result.threadId,
    matched: true,
    target: result.target,
  }),
  print: (result) => {
    if (!("event" in result)) {
      return `Thread ${result.threadId} reached status ${result.target.status}.`;
    }
    return `Thread ${result.threadId} observed event ${result.target.eventType} at seq ${result.event.seq}.`;
  },
});

export function registerWaitCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadWaitCommand, { getUrl });
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
