import { flag } from "@bb/operations";
import type { Command } from "commander";
import { threadStatusSchema, threadStatusValues } from "@bb/domain";
import {
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  type BbSdk,
  type ThreadWaitTarget,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
} from "@bb/sdk";
import { CliExitError } from "../../action.js";
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
  status?: string;
  event?: string;
}

interface ThreadWaitInput {
  threadId: string;
  target: ThreadWaitTarget;
  timeoutMs: number;
  pollIntervalMs: number;
}

type ThreadWaitOutput = Awaited<ReturnType<BbSdk["threads"]["wait"]>>;

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const threadWaitCommand = clientCommand<
  ThreadWaitInput,
  ThreadWaitOutput
>({
  name: "cli.thread.wait",
  kind: "read",
  description:
    "Poll threads.get (or threads.events) until the thread reaches the target status or event",
  door: {
    path: ["thread", "wait"],
    summary: "Wait for a thread status or event (defaults to --status idle)",
    positionals: [{ name: "id" }],
    options: [
      flag("--status <status>", "Wait until the thread reaches this status"),
      flag(
        "--event <type>",
        "Wait until the thread log includes this event type",
      ),
      flag(
        "--timeout <duration>",
        `Timeout as ${durationHelp("s")} (default: ${DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS}s)`,
      ),
      flag(
        "--poll-interval <duration>",
        `Polling interval as ${durationHelp("ms")} (default: ${DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS}ms)`,
      ),
    ],
    prepare: ({ positionals, options }) => {
      const id = positionals.id;
      const threadId = requireThreadId(typeof id === "string" ? id : undefined);
      const target = parseThreadWaitTarget({
        status: stringOption(options.status),
        event: stringOption(options.event),
      });
      return {
        threadId,
        target,
        timeoutMs: parseThreadWaitTimeoutMs(stringOption(options.timeout)),
        pollIntervalMs: parseThreadWaitPollIntervalMs(
          stringOption(options["poll-interval"]),
        ),
      };
    },
    run: async ({ threadId, target, timeoutMs, pollIntervalMs }, client) => {
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
    json: (_result, { threadId, target }) => ({
      threadId,
      matched: true,
      target,
    }),
    print: (result, { threadId }) => {
      if (!("event" in result)) {
        return `Thread ${threadId} reached status ${result.target.status}.`;
      }
      return `Thread ${threadId} observed event ${result.target.eventType} at seq ${result.event.seq}.`;
    },
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
