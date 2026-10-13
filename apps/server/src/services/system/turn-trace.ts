import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { getExperiments } from "@bb/db";
import type { ThreadEvent } from "@bb/domain";
import {
  parseHostDaemonCommandResultForCommand,
  type HostDaemonCommand,
  type HostDaemonRpcCommand,
  type TurnSubmitTrace,
} from "@bb/host-daemon-contract";
import { roundDurationMs } from "@bb/process-utils";
import type { AppDeps, ServerLogger } from "../../types.js";

const TURN_TRACE_OUTPUT_WAIT_MS = 120_000;
const FIRST_OUTPUT_EVENT_TYPES: ReadonlySet<ThreadEvent["type"]> = new Set([
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
]);

type TurnTraceSpanName =
  | "send.received"
  | "dispatch.checkpoint.done"
  | "runtimeConfig.started"
  | "runtimeConfig.workspaceRead"
  | "runtimeConfig.pluginConfig"
  | "runtimeConfig.env"
  | "runtimeConfig.built"
  | "command.sent"
  | "send.responded"
  | "command.settled"
  | "firstOutput.batchReceived"
  | "firstOutput.committed"
  | "firstOutput.notified";

interface TurnTraceRpc {
  durationMs: number;
  ok: boolean;
  startMs: number;
  type: HostDaemonRpcCommand["type"];
}

interface TurnTrace {
  commandType: HostDaemonRpcCommand["type"] | null;
  daemon: TurnSubmitTrace | null;
  hostId: string | null;
  logged: boolean;
  logger: Pick<ServerLogger, "info">;
  outputTimer: ReturnType<typeof setTimeout> | null;
  rpcs: TurnTraceRpc[];
  spans: Map<TurnTraceSpanName, number>;
  startedAt: number;
  threadId: string;
}

interface TurnTraceEventBatch {
  committedAt: number;
  events: readonly { event: ThreadEvent; threadId: string }[];
  notifiedAt: number;
  receivedAt: number;
}

const currentTrace = new AsyncLocalStorage<TurnTrace>();
const tracesAwaitingOutput = new Map<string, TurnTrace>();

function isTurnTraceEnabled(deps: Pick<AppDeps, "config" | "db">): boolean {
  return (
    deps.config.performanceDiagnosticsAvailable &&
    getExperiments(deps.db).performanceDiagnostics
  );
}

function elapsedSince(trace: TurnTrace, at: number): number {
  return roundDurationMs(at - trace.startedAt);
}

function setSpan(trace: TurnTrace, name: TurnTraceSpanName, at: number): void {
  if (!trace.spans.has(name)) {
    trace.spans.set(name, elapsedSince(trace, at));
  }
}

function logTurnTrace(trace: TurnTrace, outcome: string): void {
  if (trace.logged) {
    return;
  }
  trace.logged = true;
  if (trace.outputTimer !== null) {
    clearTimeout(trace.outputTimer);
  }
  if (tracesAwaitingOutput.get(trace.threadId) === trace) {
    tracesAwaitingOutput.delete(trace.threadId);
  }
  trace.logger.info(
    {
      turnTrace: {
        threadId: trace.threadId,
        hostId: trace.hostId,
        commandType: trace.commandType,
        outcome,
        spans: Object.fromEntries(trace.spans),
        rpcs: trace.rpcs,
        daemon: trace.daemon,
      },
    },
    "Turn trace",
  );
}

function logWhenComplete(trace: TurnTrace): void {
  if (
    trace.spans.has("command.settled") &&
    trace.spans.has("firstOutput.notified") &&
    trace.spans.has("send.responded")
  ) {
    logTurnTrace(trace, "output");
  }
}

export async function runWithTurnTrace<T>(
  deps: Pick<AppDeps, "config" | "db" | "logger">,
  args: { threadId: string },
  work: () => Promise<T>,
): Promise<T> {
  if (!isTurnTraceEnabled(deps)) {
    return work();
  }
  const trace: TurnTrace = {
    commandType: null,
    daemon: null,
    hostId: null,
    logged: false,
    logger: deps.logger,
    outputTimer: null,
    rpcs: [],
    spans: new Map(),
    startedAt: performance.now(),
    threadId: args.threadId,
  };
  setSpan(trace, "send.received", trace.startedAt);
  try {
    return await currentTrace.run(trace, work);
  } finally {
    setSpan(trace, "send.responded", performance.now());
    if (trace.commandType === null) {
      logTurnTrace(trace, "not-sent");
    } else {
      logWhenComplete(trace);
    }
  }
}

export function markTurnTraceSpan(name: TurnTraceSpanName): void {
  const trace = currentTrace.getStore();
  if (trace !== undefined) {
    setSpan(trace, name, performance.now());
  }
}

export async function traceTurnRpc<T>(
  type: HostDaemonRpcCommand["type"],
  call: () => Promise<T>,
): Promise<T> {
  const trace = currentTrace.getStore();
  if (trace === undefined) {
    return call();
  }
  const startedAt = performance.now();
  let ok = false;
  try {
    const result = await call();
    ok = true;
    return result;
  } finally {
    trace.rpcs.push({
      type,
      startMs: elapsedSince(trace, startedAt),
      durationMs: roundDurationMs(performance.now() - startedAt),
      ok,
    });
  }
}

export function noteTurnTraceCommandSent(args: {
  command: HostDaemonCommand;
  hostId: string;
}): void {
  const trace = currentTrace.getStore();
  if (
    trace === undefined ||
    trace.commandType !== null ||
    (args.command.type !== "turn.submit" &&
      args.command.type !== "thread.start")
  ) {
    return;
  }
  trace.commandType = args.command.type;
  trace.hostId = args.hostId;
  setSpan(trace, "command.sent", performance.now());
  const previous = tracesAwaitingOutput.get(trace.threadId);
  if (previous !== undefined) {
    logTurnTrace(previous, "superseded");
  }
  tracesAwaitingOutput.set(trace.threadId, trace);
  trace.outputTimer = setTimeout(
    () => logTurnTrace(trace, "no-output"),
    TURN_TRACE_OUTPUT_WAIT_MS,
  );
  trace.outputTimer.unref?.();
}

export function noteTurnTraceCommandSettled(args: {
  command: HostDaemonCommand;
  result: unknown;
}): void {
  const trace = currentTrace.getStore();
  if (trace === undefined || trace.commandType !== args.command.type) {
    return;
  }
  setSpan(trace, "command.settled", performance.now());
  if (args.command.type === "turn.submit") {
    trace.daemon = parseHostDaemonCommandResultForCommand(
      args.command,
      args.result,
    ).trace;
  }
  logWhenComplete(trace);
}

export function noteTurnTraceCommandFailed(command: HostDaemonCommand): void {
  const trace = currentTrace.getStore();
  if (trace !== undefined && trace.commandType === command.type) {
    logTurnTrace(trace, "command-failed");
  }
}

export function observeTurnTraceEventBatch(batch: TurnTraceEventBatch): void {
  if (tracesAwaitingOutput.size === 0) {
    return;
  }
  for (const { event, threadId } of batch.events) {
    const trace = tracesAwaitingOutput.get(threadId);
    if (trace === undefined || trace.spans.has("firstOutput.notified")) {
      continue;
    }
    if (FIRST_OUTPUT_EVENT_TYPES.has(event.type)) {
      setSpan(trace, "firstOutput.batchReceived", batch.receivedAt);
      setSpan(trace, "firstOutput.committed", batch.committedAt);
      setSpan(trace, "firstOutput.notified", batch.notifiedAt);
      logWhenComplete(trace);
    } else if (event.type === "turn/completed") {
      logTurnTrace(trace, "completed-without-output");
    }
  }
}
