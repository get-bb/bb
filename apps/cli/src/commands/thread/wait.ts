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
import { getErrorMessage, outputJson, requireThreadId } from "../helpers.js";
import {
  DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS,
  parseThreadWaitPollIntervalMs,
  parseThreadWaitTimeoutSeconds,
  THREAD_WAIT_EXIT_CODE_INVALID_REQUEST,
  THREAD_WAIT_EXIT_CODE_TIMEOUT,
  THREAD_WAIT_EXIT_CODE_UNREACHABLE,
} from "./helpers.js";

interface ThreadWaitCommandOptions {
  status?: string;
  event?: string;
  timeout?: string;
  pollInterval?: string;
  output?: boolean;
  json?: boolean;
}

type CliBbSdk = ReturnType<typeof createCliBbSdk>;

interface ParsedThreadWaitOptions {
  output: boolean;
  pollIntervalMs: number;
  target: ThreadWaitTarget;
  timeoutMs: number;
}

interface SuccessfulThreadWait {
  output: string | null | undefined;
  result: Awaited<ReturnType<CliBbSdk["threads"]["wait"]>>;
  target: ThreadWaitTarget;
  threadId: string;
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
      "--timeout <seconds>",
      `Timeout in seconds (default: ${DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS})`,
    )
    .option(
      "--poll-interval <ms>",
      `Polling interval in milliseconds (default: ${DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS})`,
    )
    .option("--output", "Get the final thread output after a status match")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadWaitCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const threadId = requireThreadId(id);
        const parsed = parseThreadWaitOptions(opts);
        printPollIntervalDeprecation(opts);
        let success: SuccessfulThreadWait;
        try {
          success = await executeThreadWait(sdk, threadId, parsed);
        } catch (error) {
          throw toThreadWaitCliError(error);
        }
        printSuccessfulWait(success, opts);
      }),
    );

  parent
    .command("wait-many <ids...>")
    .description("Wait for several threads in one process")
    .option("--status <status>", "Wait until each thread reaches this status")
    .option(
      "--event <type>",
      "Wait until each thread log includes this event type",
    )
    .option(
      "--timeout <seconds>",
      `Timeout in seconds (default: ${DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS})`,
    )
    .option(
      "--poll-interval <ms>",
      `Polling interval in milliseconds (default: ${DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS})`,
    )
    .option("--output", "Get final output after each status match")
    .option("--json", "Print one JSON line per completed wait")
    .action(
      action(async (ids: string[], opts: ThreadWaitCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const parsed = parseThreadWaitOptions(opts);
        printPollIntervalDeprecation(opts);
        const exitCodes = await Promise.all(
          ids.map(async (threadId) => {
            try {
              const success = await executeThreadWait(sdk, threadId, parsed);
              printSuccessfulWait(success, opts, true);
              return 0;
            } catch (error) {
              const cliError = toThreadWaitCliError(error);
              printFailedWait(threadId, cliError, opts);
              return cliError.exitCode;
            }
          }),
        );
        const worstExitCode = Math.max(...exitCodes);
        if (worstExitCode > 0) process.exit(worstExitCode);
      }),
    );
}

async function executeThreadWait(
  sdk: CliBbSdk,
  threadId: string,
  options: ParsedThreadWaitOptions,
): Promise<SuccessfulThreadWait> {
  const result = await sdk.threads.wait({
    threadId,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    ...(options.target.kind === "status"
      ? { status: options.target.status }
      : { event: options.target.eventType }),
  });
  const output = options.output
    ? (await sdk.threads.output({ threadId })).output
    : undefined;
  return { output, result, target: options.target, threadId };
}

function parseThreadWaitOptions(
  opts: ThreadWaitCommandOptions,
): ParsedThreadWaitOptions {
  const target = parseThreadWaitTarget(opts);
  const output = opts.output === true;
  if (output && target.kind === "event") {
    throw new CliExitError(
      "Cannot combine --output with --event because the event may precede final output.",
      THREAD_WAIT_EXIT_CODE_INVALID_REQUEST,
    );
  }
  return {
    output,
    pollIntervalMs: parseThreadWaitPollIntervalMs(opts.pollInterval),
    target,
    timeoutMs: parseThreadWaitTimeoutSeconds(opts.timeout) * 1000,
  };
}

function printFailedWait(
  threadId: string,
  error: CliExitError,
  opts: ThreadWaitCommandOptions,
): void {
  if (opts.json) {
    console.log(
      JSON.stringify({
        threadId,
        error: error.message,
        exitCode: error.exitCode,
      }),
    );
    return;
  }
  console.error(`Error: ${error.message}`);
}

function printPollIntervalDeprecation(opts: ThreadWaitCommandOptions): void {
  if (opts.pollInterval === undefined) return;
  console.error(
    "Warning: --poll-interval is deprecated on event-driven servers. It now controls fallback polling and pauses between long-poll rounds.",
  );
}

function printSuccessfulWait(
  success: SuccessfulThreadWait,
  opts: ThreadWaitCommandOptions,
  compactJson = false,
): void {
  if (opts.json) {
    const payload =
      success.output !== undefined && !("event" in success.result)
        ? {
            threadId: success.threadId,
            status: success.result.thread.status,
            output: success.output,
          }
        : {
            threadId: success.threadId,
            matched: true,
            target: success.target,
          };
    if (compactJson) {
      console.log(JSON.stringify(payload));
      return;
    }
    outputJson(opts, payload);
    return;
  }
  if (!("event" in success.result)) {
    console.log(
      `Thread ${success.threadId} reached status ${success.result.target.status}.`,
    );
  } else {
    console.log(
      `Thread ${success.threadId} observed event ${success.result.target.eventType} at seq ${success.result.event.seq}.`,
    );
  }
  if (success.output !== undefined) {
    console.log(success.output || "(no output)");
  }
}

function toThreadWaitCliError(error: unknown): CliExitError {
  if (error instanceof CliExitError) return error;
  if (error instanceof ThreadWaitTimeoutError) {
    return new CliExitError(error.message, THREAD_WAIT_EXIT_CODE_TIMEOUT);
  }
  if (error instanceof ThreadWaitUnreachableError) {
    return new CliExitError(error.message, THREAD_WAIT_EXIT_CODE_UNREACHABLE);
  }
  return new CliExitError(getErrorMessage(error), 1);
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
