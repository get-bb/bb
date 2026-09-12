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
  createBridgeLineHandler,
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
import { z } from "zod";
import { parseBenchDirective, type BenchDirective } from "./directives.js";
import { openEmissionLog, type EmissionLog } from "./emission-log.js";
import { streamDocumentText } from "./fixtures/index.js";
import { agentMessageClose, agentMessageOpen } from "./presentation.js";
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
  timer: ReturnType<typeof setTimeout> | undefined;
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
    agentMessageOpen(key),
    { kind: "item.textDelta", key, channel: "agentMessage", text },
    agentMessageClose(key, text),
  ];
}

function cancelStream(session: Session): ActiveStream | null {
  const stream = session.activeStream;
  if (stream !== null) {
    clearTimeout(stream.timer);
    session.activeStream = null;
  }
  return stream;
}

function interruptStream(session: Session): void {
  const stream = cancelStream(session);
  if (stream === null) {
    return;
  }
  emitDeltas(session.threadId, [
    agentMessageClose(
      stream.messageKey,
      stream.text.slice(0, stream.emitted),
      "interrupted",
    ),
    { kind: "turn.boundary", status: "interrupted" },
  ]);
}

function tickStream(session: Session, stream: ActiveStream): void {
  const end = Math.min(stream.text.length, stream.emitted + stream.chunk);
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
    agentMessageClose(stream.messageKey, stream.text),
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
    timer: undefined,
    log: openEmissionLog(session.threadId),
  };
  emitDeltas(session.threadId, [
    ...args.opening,
    ...(directive.prelude
      ? buildStreamPrelude({ cwd: session.cwd, idPrefix: args.idPrefix })
      : []),
    agentMessageOpen(stream.messageKey),
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

function runTurn(args: {
  session: Session;
  input: readonly PromptInput[];
  clientRequestId: ClientTurnRequestId;
}): void {
  const { session } = args;
  interruptStream(session);
  session.turnCount += 1;
  const idPrefix = `bench-${session.providerThreadId}-t${session.turnCount}`;
  const accepted: ThreadDelta = {
    kind: "input.accepted",
    clientRequestId: args.clientRequestId,
  };
  const opening: ThreadDelta[] = [accepted, { kind: "turn.open" }];
  const prompt = promptText(args.input);
  const directive = parseBenchDirective(prompt);
  switch (directive.kind) {
    case "noop":
      emitDeltas(session.threadId, [
        accepted,
        { kind: "turn.boundary", status: "completed", claimIfIdle: true },
      ]);
      return;
    case "history": {
      const batches = buildHistoryTurn({
        seed: directive.seed,
        tools: directive.tools,
        cwd: session.cwd,
        idPrefix,
      });
      batches[0].unshift(...opening);
      batches[batches.length - 1].push({
        kind: "turn.boundary",
        status: "completed",
      });
      for (const batch of batches) {
        emitDeltas(session.threadId, batch);
      }
      return;
    }
    case "stream":
      startStream({ session, opening, idPrefix, directive });
      return;
    case "echo":
      emitDeltas(session.threadId, [
        ...opening,
        ...echoMessageDeltas(`${idPrefix}-message`, prompt),
        { kind: "turn.boundary", status: "completed" },
      ]);
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
}): void {
  const previous = sessions.get(args.threadId);
  if (previous !== undefined) {
    interruptStream(previous);
  }
  sessions.set(args.threadId, { ...args, turnCount: 0, activeStream: null });
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
  });
  emitDeltas(args.threadId, [{ kind: "session.reset" }]);
}

function mintProviderThreadId(): string {
  providerThreadCounter += 1;
  return `bench_${instanceNonce}_${providerThreadCounter}`;
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

function route<T>(
  method: string,
  schema: z.ZodType<T>,
  handle: (id: JsonRpcId, params: T) => void,
): [string, RequestHandler] {
  return [
    method,
    (id, params) => {
      const parsed = schema.safeParse(params);
      if (parsed.success) {
        handle(id, parsed.data);
        return;
      }
      io.send({
        jsonrpc: "2.0",
        id,
        error: {
          code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
          message: `Invalid params for ${method}`,
          data: parsed.error.issues,
        },
      });
    },
  ];
}

const handlers = new Map<string, RequestHandler>([
  route(BRIDGE_REQUEST_METHODS.initialize, initializeParamsSchema, (id) => {
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        threadArchive: true,
        fork: "tip",
      },
    });
  }),

  route(BRIDGE_REQUEST_METHODS.modelList, modelListParamsSchema, (id) => {
    io.sendResult(id, {
      models: [{ ...BENCH_STREAM_MODEL, model: BENCH_STREAM_MODEL_ID }],
      selectedOnlyModels: [],
    });
  }),

  route(
    BRIDGE_REQUEST_METHODS.providerHealth,
    providerMaintenanceParamsSchema,
    (id) => {
      io.sendResult(id, BENCH_HEALTH);
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadStart,
    threadStartParamsSchema,
    (id, params) => {
      const providerThreadId = mintProviderThreadId();
      openSession({
        threadId: params.threadId,
        providerThreadId,
        cwd: params.cwd,
      });
      io.sendResult(id, { providerThreadId, sessionRestorable: true });
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadResume,
    threadResumeParamsSchema,
    (id, params) => {
      if (rejectIfArchived(id, params.providerThreadId)) {
        return;
      }
      openSession({
        threadId: params.threadId,
        providerThreadId: params.providerThreadId,
        cwd: params.cwd,
      });
      io.sendResult(id, {
        providerThreadId: params.providerThreadId,
        sessionRestorable: true,
      });
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadFork,
    threadForkParamsSchema,
    (id, params) => {
      if (params.sourceProviderCheckpointId !== undefined) {
        io.sendError(
          id,
          BRIDGE_JSON_RPC_ERRORS.FORK_CHECKPOINT_UNSUPPORTED,
          "The bench stream provider forks only at the tip of a session",
        );
        return;
      }
      if (rejectIfArchived(id, params.sourceProviderThreadId)) {
        return;
      }
      const providerThreadId = mintProviderThreadId();
      openSession({
        threadId: params.threadId,
        providerThreadId,
        cwd: params.cwd,
      });
      io.sendResult(id, { providerThreadId, sessionRestorable: true });
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.turnStart,
    turnStartParamsSchema,
    (id, params) => {
      const session = sessions.get(params.threadId);
      if (session === undefined) {
        unknownThread(id, params.threadId);
        return;
      }
      if (rejectIfArchived(id, session.providerThreadId)) {
        return;
      }
      io.sendResult(id, {});
      runTurn({
        session,
        input: params.input,
        clientRequestId: params.clientRequestId,
      });
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.turnSteer,
    turnSteerParamsSchema,
    (id, params) => {
      const session = sessions.get(params.threadId);
      if (session === undefined) {
        unknownThread(id, params.threadId);
        return;
      }
      const stream = session.activeStream;
      if (stream === null) {
        const message = `No active bench turn to steer (expected ${params.expectedTurnId})`;
        io.sendError(id, BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN, message, {
          recovery: {
            kind: "staleTurn",
            message,
            retryable: false,
          } satisfies ProviderRecoveryHint,
        });
        return;
      }
      stream.steers.push(promptText(params.input));
      emitDeltas(session.threadId, [
        { kind: "input.accepted", clientRequestId: params.clientRequestId },
      ]);
      io.sendResult(id, {});
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadStop,
    threadStopParamsSchema,
    (id, params) => {
      const session = sessions.get(params.threadId);
      if (session !== undefined) {
        if (params.intent === "interrupt") {
          interruptStream(session);
        } else {
          cancelStream(session);
        }
        sessions.delete(params.threadId);
      }
      io.sendResult(id, {});
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadDiscard,
    threadDiscardParamsSchema,
    (id, params) => {
      const session = sessions.get(params.threadId);
      if (session !== undefined) {
        cancelStream(session);
        sessions.delete(params.threadId);
      }
      archivedProviderThreadIds.delete(params.providerThreadId);
      io.sendResult(id, {});
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadArchive,
    threadArchiveParamsSchema,
    (id, params) => {
      archivedProviderThreadIds.add(params.providerThreadId);
      io.sendResult(id, {});
    },
  ),

  route(
    BRIDGE_REQUEST_METHODS.threadUnarchive,
    threadUnarchiveParamsSchema,
    (id, params) => {
      archivedProviderThreadIds.delete(params.providerThreadId);
      io.sendResult(id, {});
    },
  ),
]);

const requestEnvelopeSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown(),
});

export const handleLine = createBridgeLineHandler({
  handleParsedMessage(message) {
    const envelope = requestEnvelopeSchema.safeParse(message);
    if (!envelope.success) {
      return;
    }
    const { id, method, params } = envelope.data;
    const handler = handlers.get(method);
    if (handler === undefined) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        `Method not found: ${method}`,
      );
      return;
    }
    runBridgeRequest({
      request: { id, method, params },
      sendError: io.sendError,
      handleRequest: async (request) => handler(request.id, request.params),
    });
  },
});

function cancelAllStreams(): void {
  for (const session of sessions.values()) {
    cancelStream(session);
  }
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onClose: cancelAllStreams,
});
