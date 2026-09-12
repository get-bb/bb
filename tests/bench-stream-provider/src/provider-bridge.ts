import {
  type ClientTurnRequestId,
  type PromptInput,
  type ProviderHealthResult,
  type ProviderRecoveryHint,
  type ThreadDelta,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  createBridgeIo,
  experimental_defineProviderBridge,
  initializeParamsSchema,
  modelListParamsSchema,
  providerMaintenanceParamsSchema,
  runBridgeRequest,
  threadArchiveParamsSchema,
  threadDiscardParamsSchema,
  threadForkParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  threadUnarchiveParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { parseBenchDirective, type BenchDirective } from "./directives.js";
import { openEmissionLog, type EmissionLog } from "./emission-log.js";
import { streamDocumentText } from "./fixtures/index.js";
import { AGENT_MESSAGE_PRESENTATION } from "./presentation.js";
import { buildHistoryTurn, buildStreamPrelude } from "./turn-content.js";
import { BENCH_STREAM_MODEL, BENCH_STREAM_MODEL_ID } from "./vocabulary.js";

type JsonRpcId = string | number;

type OutboundMessage = { jsonrpc: "2.0" } & Record<string, unknown>;

interface ActiveStream {
  idPrefix: string;
  messageKey: { providerItemId: string };
  steers: string[];
  text: string;
  chunk: number;
  interval: number;
  emitted: number;
  timer: ReturnType<typeof setTimeout> | null;
  log: EmissionLog | null;
}

interface Session {
  threadId: string;
  providerThreadId: string;
  cwd: string;
  turnCount: number;
  activeStream: ActiveStream | null;
}

const instanceNonce = randomUUID().replaceAll("-", "").slice(0, 12);
let providerThreadCounter = 0;

const sessions = new Map<string, Session>();
const archivedProviderThreadIds = new Set<string>();

const io = createBridgeIo<OutboundMessage>();

function notify(method: string, params: Record<string, unknown>): void {
  io.send({ jsonrpc: "2.0", method, params });
}

function emitDeltas(threadId: string, deltas: ThreadDelta[]): void {
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas });
}

function promptText(input: readonly PromptInput[]): string {
  return input
    .filter(
      (item): item is Extract<PromptInput, { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join("\n");
}

function echoMessageDeltas(
  providerItemId: string,
  prompt: string,
): ThreadDelta[] {
  const text =
    prompt.length > 0 ? `Response to: ${prompt}` : "Response complete";
  const key = { providerItemId };
  return [
    {
      kind: "item.open",
      key,
      item: { type: "agentMessage", text: "" },
      presentation: AGENT_MESSAGE_PRESENTATION,
    },
    { kind: "item.textDelta", key, channel: "agentMessage", text },
    {
      kind: "item.close",
      key,
      status: "completed",
      item: { type: "agentMessage", text },
      presentation: AGENT_MESSAGE_PRESENTATION,
    },
  ];
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function nextChunkEnd(
  text: string,
  start: number,
  chunk: number,
): number {
  const end = Math.min(text.length, start + chunk);
  return end < text.length && isHighSurrogate(text.charCodeAt(end - 1))
    ? end + 1
    : end;
}

function cancelStream(session: Session): ActiveStream | null {
  const stream = session.activeStream;
  if (stream === null) {
    return null;
  }
  if (stream.timer !== null) {
    clearTimeout(stream.timer);
    stream.timer = null;
  }
  session.activeStream = null;
  return stream;
}

function interruptStream(session: Session): void {
  const stream = cancelStream(session);
  if (stream === null) {
    return;
  }
  emitDeltas(session.threadId, [
    {
      kind: "item.close",
      key: stream.messageKey,
      status: "interrupted",
      item: {
        type: "agentMessage",
        text: stream.text.slice(0, stream.emitted),
      },
      presentation: AGENT_MESSAGE_PRESENTATION,
    },
    { kind: "turn.boundary", status: "interrupted" },
  ]);
}

function tickStream(session: Session, stream: ActiveStream): void {
  if (session.activeStream !== stream) {
    return;
  }
  stream.timer = null;
  const end = nextChunkEnd(stream.text, stream.emitted, stream.chunk);
  const text = stream.text.slice(stream.emitted, end);
  stream.emitted = end;
  const emittedAt = Date.now();
  emitDeltas(session.threadId, [
    {
      kind: "item.textDelta",
      key: stream.messageKey,
      channel: "agentMessage",
      text,
    },
  ]);
  stream.log?.append({ event: "delta", t: emittedAt, chars: stream.emitted });
  if (stream.emitted < stream.text.length) {
    stream.timer = setTimeout(
      () => tickStream(session, stream),
      stream.interval,
    );
    return;
  }
  session.activeStream = null;
  emitDeltas(session.threadId, [
    {
      kind: "item.close",
      key: stream.messageKey,
      status: "completed",
      item: { type: "agentMessage", text: stream.text },
      presentation: AGENT_MESSAGE_PRESENTATION,
    },
    ...stream.steers.flatMap((steer, index) =>
      echoMessageDeltas(`${stream.idPrefix}-steer-${index + 1}`, steer),
    ),
    { kind: "turn.boundary", status: "completed" },
  ]);
  stream.log?.append({ event: "complete", t: Date.now() });
}

function startStream(args: {
  session: Session;
  opening: ThreadDelta[];
  idPrefix: string;
  directive: Extract<BenchDirective, { kind: "stream" }>;
}): void {
  const { session, directive } = args;
  const stream: ActiveStream = {
    idPrefix: args.idPrefix,
    messageKey: { providerItemId: `${args.idPrefix}-message` },
    steers: [],
    text: streamDocumentText(directive.doc, directive.repeat),
    chunk: directive.chunk,
    interval: directive.interval,
    emitted: 0,
    timer: null,
    log: openEmissionLog(session.threadId),
  };
  emitDeltas(session.threadId, [
    ...args.opening,
    ...(directive.prelude
      ? buildStreamPrelude({ cwd: session.cwd, idPrefix: args.idPrefix })
      : []),
    {
      kind: "item.open",
      key: stream.messageKey,
      item: { type: "agentMessage", text: "" },
      presentation: AGENT_MESSAGE_PRESENTATION,
    },
  ]);
  session.activeStream = stream;
  stream.log?.append({
    event: "start",
    t: Date.now(),
    doc: directive.doc,
    docChars: stream.text.length,
    chunk: stream.chunk,
    interval: stream.interval,
  });
  stream.timer = setTimeout(() => tickStream(session, stream), stream.interval);
}

function emitHistoryTurn(args: {
  session: Session;
  opening: ThreadDelta[];
  idPrefix: string;
  directive: Extract<BenchDirective, { kind: "history" }>;
}): void {
  const batches = buildHistoryTurn({
    seed: args.directive.seed,
    tools: args.directive.tools,
    cwd: args.session.cwd,
    idPrefix: args.idPrefix,
  });
  batches.forEach((batch, index) => {
    emitDeltas(args.session.threadId, [
      ...(index === 0 ? args.opening : []),
      ...batch,
      ...(index === batches.length - 1
        ? [{ kind: "turn.boundary", status: "completed" } satisfies ThreadDelta]
        : []),
    ]);
  });
}

function emitEchoTurn(args: {
  session: Session;
  opening: ThreadDelta[];
  idPrefix: string;
  prompt: string;
}): void {
  emitDeltas(args.session.threadId, [
    ...args.opening,
    ...echoMessageDeltas(`${args.idPrefix}-message`, args.prompt),
    { kind: "turn.boundary", status: "completed" },
  ]);
}

function runTurn(args: {
  session: Session;
  input: readonly PromptInput[];
  clientRequestId?: ClientTurnRequestId;
}): void {
  const { session } = args;
  interruptStream(session);
  session.turnCount += 1;
  const idPrefix = `bench-${session.providerThreadId}-t${session.turnCount}`;
  const accepted: ThreadDelta[] =
    args.clientRequestId === undefined
      ? []
      : [{ kind: "input.accepted", clientRequestId: args.clientRequestId }];
  const opening: ThreadDelta[] = [...accepted, { kind: "turn.open" }];
  const prompt = promptText(args.input);
  const directive = parseBenchDirective(prompt);
  switch (directive.kind) {
    case "noop":
      emitDeltas(session.threadId, [
        ...accepted,
        { kind: "turn.boundary", status: "completed", claimIfIdle: true },
      ]);
      return;
    case "history":
      emitHistoryTurn({ session, opening, idPrefix, directive });
      return;
    case "stream":
      startStream({ session, opening, idPrefix, directive });
      return;
    case "echo":
      emitEchoTurn({ session, opening, idPrefix, prompt });
      return;
    case "invalid":
      emitDeltas(session.threadId, [
        ...opening,
        {
          kind: "provider.error",
          message: "Invalid bench directive",
          detail: directive.problem,
          settlesTurn: true,
        },
      ]);
      return;
  }
}

function openSession(args: {
  threadId: string;
  providerThreadId: string;
  cwd: string;
}): Session {
  const previous = sessions.get(args.threadId);
  if (previous !== undefined) {
    interruptStream(previous);
  }
  const session: Session = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    cwd: args.cwd,
    turnCount: 0,
    activeStream: null,
  };
  sessions.set(args.threadId, session);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
  });
  emitDeltas(args.threadId, [{ kind: "session.reset" }]);
  return session;
}

function mintProviderThreadId(): string {
  providerThreadCounter += 1;
  return `bench_${instanceNonce}_${providerThreadCounter}`;
}

function invalidParams(id: JsonRpcId, method: string, issues: unknown): void {
  io.send({
    jsonrpc: "2.0",
    id,
    error: {
      code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      message: `Invalid params for ${method}`,
      data: issues,
    },
  });
}

function unknownThread(id: JsonRpcId, threadId: string): void {
  io.sendError(
    id,
    BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
    `No bench session for thread ${threadId}; send thread/start or thread/resume first`,
  );
}

function rejectIfArchived(id: JsonRpcId, providerThreadId: string): boolean {
  if (!archivedProviderThreadIds.has(providerThreadId)) {
    return false;
  }
  const message = `bench session ${providerThreadId} is archived; unarchive it first`;
  io.sendError(id, BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR, message, {
    recovery: {
      kind: "sessionArchived",
      message,
      retryable: true,
    } satisfies ProviderRecoveryHint,
  });
  return true;
}

const BENCH_HEALTH: ProviderHealthResult = {
  supported: true,
  health: {
    status: "ready",
    statusMessage: null,
    accountEmail: null,
    planLabel: null,
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
  },
};

type RequestHandler = (id: JsonRpcId, params: unknown) => void;

const handlers: Record<string, RequestHandler> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id, params) => {
    const parsed = initializeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.initialize, parsed.error.issues);
      return;
    }
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        threadArchive: true,
        threadRename: false,
        threadGoalClear: false,
        fork: "tip",
        approvalEnforcedBy: "runtime",
        steerMode: "queue",
        skills: { configure: false },
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.modelList]: (id, params) => {
    const parsed = modelListParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.modelList, parsed.error.issues);
      return;
    }
    io.sendResult(id, {
      models: [{ ...BENCH_STREAM_MODEL, model: BENCH_STREAM_MODEL_ID }],
      selectedOnlyModels: [],
    });
  },

  [BRIDGE_REQUEST_METHODS.providerHealth]: (id, params) => {
    const parsed = providerMaintenanceParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.providerHealth,
        parsed.error.issues,
      );
      return;
    }
    io.sendResult(id, BENCH_HEALTH);
  },

  [BRIDGE_REQUEST_METHODS.threadStart]: (id, params) => {
    const parsed = threadStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadStart,
        parsed.error.issues,
      );
      return;
    }
    const providerThreadId = mintProviderThreadId();
    const session = openSession({
      threadId: parsed.data.threadId,
      providerThreadId,
      cwd: parsed.data.cwd,
    });
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
    if (parsed.data.input !== undefined && parsed.data.input.length > 0) {
      runTurn({ session, input: parsed.data.input });
    }
  },

  [BRIDGE_REQUEST_METHODS.threadResume]: (id, params) => {
    const parsed = threadResumeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadResume,
        parsed.error.issues,
      );
      return;
    }
    if (rejectIfArchived(id, parsed.data.providerThreadId)) {
      return;
    }
    openSession({
      threadId: parsed.data.threadId,
      providerThreadId: parsed.data.providerThreadId,
      cwd: parsed.data.cwd,
    });
    io.sendResult(id, {
      providerThreadId: parsed.data.providerThreadId,
      sessionRestorable: true,
    });
  },

  [BRIDGE_REQUEST_METHODS.threadFork]: (id, params) => {
    const parsed = threadForkParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadFork, parsed.error.issues);
      return;
    }
    if (parsed.data.sourceProviderCheckpointId !== undefined) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.FORK_CHECKPOINT_UNSUPPORTED,
        "The bench stream provider forks only at the tip of a session",
      );
      return;
    }
    if (rejectIfArchived(id, parsed.data.sourceProviderThreadId)) {
      return;
    }
    const providerThreadId = mintProviderThreadId();
    openSession({
      threadId: parsed.data.threadId,
      providerThreadId,
      cwd: parsed.data.cwd,
    });
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
  },

  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const parsed = turnStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnStart, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (session === undefined) {
      unknownThread(id, parsed.data.threadId);
      return;
    }
    if (rejectIfArchived(id, session.providerThreadId)) {
      return;
    }
    io.sendResult(id, {});
    runTurn({
      session,
      input: parsed.data.input,
      clientRequestId: parsed.data.clientRequestId,
    });
  },

  [BRIDGE_REQUEST_METHODS.turnSteer]: (id, params) => {
    const parsed = turnSteerParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnSteer, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (session === undefined) {
      unknownThread(id, parsed.data.threadId);
      return;
    }
    const stream = session.activeStream;
    if (stream === null) {
      const message = `No active bench turn to steer (expected ${parsed.data.expectedTurnId})`;
      io.sendError(id, BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN, message, {
        recovery: {
          kind: "staleTurn",
          message,
          retryable: false,
        } satisfies ProviderRecoveryHint,
      });
      return;
    }
    stream.steers.push(promptText(parsed.data.input));
    emitDeltas(session.threadId, [
      { kind: "input.accepted", clientRequestId: parsed.data.clientRequestId },
    ]);
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadStop]: (id, params) => {
    const parsed = threadStopParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadStop, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (session !== undefined) {
      if (parsed.data.intent === "interrupt") {
        interruptStream(session);
      } else {
        cancelStream(session);
      }
      sessions.delete(parsed.data.threadId);
    }
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadDiscard]: (id, params) => {
    const parsed = threadDiscardParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadDiscard,
        parsed.error.issues,
      );
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (session !== undefined) {
      cancelStream(session);
      sessions.delete(parsed.data.threadId);
    }
    archivedProviderThreadIds.delete(parsed.data.providerThreadId);
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadArchive]: (id, params) => {
    const parsed = threadArchiveParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadArchive,
        parsed.error.issues,
      );
      return;
    }
    archivedProviderThreadIds.add(parsed.data.providerThreadId);
    io.sendResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadUnarchive]: (id, params) => {
    const parsed = threadUnarchiveParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadUnarchive,
        parsed.error.issues,
      );
      return;
    }
    archivedProviderThreadIds.delete(parsed.data.providerThreadId);
    io.sendResult(id, {});
  },
};

export function handleLine(line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return;
  }
  const id: unknown = Reflect.get(message, "id");
  const method: unknown = Reflect.get(message, "method");
  if (typeof method !== "string") {
    return;
  }
  if (typeof id !== "string" && typeof id !== "number") {
    return;
  }
  const handler = handlers[method];
  if (handler === undefined) {
    io.sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
    );
    return;
  }
  const params: unknown = Reflect.get(message, "params");
  runBridgeRequest({
    request: { id, method, params },
    sendError: io.sendError,
    handleRequest: async (request) => handler(request.id, request.params),
  });
}

function cancelAllStreams(): void {
  for (const session of sessions.values()) {
    cancelStream(session);
  }
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onClose: cancelAllStreams,
});
