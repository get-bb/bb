/**
 * The echo-agent provider bridge: the smallest correct implementation of the
 * bb Provider Bridge Protocol (docs/provider-bridge-protocol.md).
 *
 * `bb plugin build` bundles this file into a fully self-contained
 * dist/provider-bridge.mjs; the host daemon downloads that artifact by
 * content hash, verifies it, and runs it with its own node for every thread
 * on this provider. Transport is line-delimited JSON-RPC 2.0 on
 * stdin/stdout.
 *
 * What "correct" means here, in protocol terms:
 * - Hygiene: an unknown method answers METHOD_NOT_FOUND (-32601); invalid
 *   params answer INVALID_PARAMS (-32602) carrying the validation issues; a
 *   non-JSON line and an unsolicited response-shaped line are ignored and
 *   the bridge stays alive. The dispatch table is keyed by the protocol
 *   package's own method vocabulary, so it cannot drift from the schemas.
 * - Handshake: initialize answers protocol version 2 — the narrow-grammar
 *   dialect — and grammar range [3, 3]. The runtime rejects any other
 *   protocol version, or a grammar range without 3, at spawn.
 * - Grammar: the bridge emits `thread/delta` semantic deltas, never finished
 *   timeline events — the runtime's assembler mints every turn and item id
 *   and constructs the canonical events. Every accepted turn settles
 *   (`input.accepted` → `turn.open` → `turn.boundary`); every session
 *   construction (start and resume) opens with `session.reset` so the
 *   assembler drops any prior id space for the thread; a release stop
 *   fabricates nothing.
 */
import {
  type ClientTurnRequestId,
  type PromptInput,
  type ThreadDelta,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  initializeParamsSchema,
  modelListParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  experimental_defineProviderBridge,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// State: one bridge process serves many threads; sessions are in-memory only
// (the echo agent has nothing to persist, so its handshake advertises no
// sessionRestore and every capability defaults to "no").
// ---------------------------------------------------------------------------

/** Per-instance entropy baked into minted provider thread ids. */
const instanceNonce = randomUUID().replaceAll("-", "").slice(0, 12);
let threadCounter = 0;

/** threadId → providerThreadId for sessions this instance has opened. */
const sessions = new Map<string, string>();

type JsonRpcId = string | number;

/** The single stdout writer — protocol traffic only, never stray logs. */
function writeMessage(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function respondResult(id: JsonRpcId, result: unknown): void {
  writeMessage({ id, result });
}

function respondError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): void {
  writeMessage({
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

function notify(method: string, params: Record<string, unknown>): void {
  writeMessage({ method, params });
}

/** Emit one batched `thread/delta` notification for a thread. */
function emitDeltas(threadId: string, deltas: ThreadDelta[]): void {
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas });
}

// ---------------------------------------------------------------------------
// The echo turn, in deltas: input.accepted → turn.open → a streamed assistant
// message → turn.boundary. The runtime's assembler turns this into the
// canonical accepted/started/item/completed event sequence with ids it mints
// itself. Turns settle synchronously — echoing needs no provider round-trip.
// ---------------------------------------------------------------------------

function promptText(input: readonly PromptInput[]): string {
  return input
    .filter(
      (item): item is Extract<PromptInput, { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join("");
}

function runEchoTurn(args: {
  threadId: string;
  input: readonly PromptInput[];
  /** Present only for turn/start; thread/start input has no request id. */
  clientRequestId?: ClientTurnRequestId;
}): void {
  const text = `echo: ${promptText(args.input)}`;
  const deltas: ThreadDelta[] = [];
  // The provider consumed the input. thread/start input carries no
  // clientRequestId, so a first-turn-on-start emits no acceptance.
  if (args.clientRequestId !== undefined) {
    deltas.push({
      kind: "input.accepted",
      clientRequestId: args.clientRequestId,
    });
  }
  deltas.push(
    { kind: "turn.open" },
    // A streamed assistant message on an anonymous stream (the echo agent
    // names no item ids, so the key is a bridge-chosen channel): the
    // assembler synthesizes item/started for the delta-first stream, and the
    // close's `text` is the provider's final text for the completed item.
    {
      kind: "item.textDelta",
      key: { channel: "echo" },
      channel: "agentMessage",
      text,
    },
    {
      kind: "item.textClose",
      key: { channel: "echo" },
      channel: "agentMessage",
      text,
    },
    { kind: "turn.boundary", status: "completed" },
  );
  emitDeltas(args.threadId, deltas);
}

/**
 * Every session construction is a provider id-space boundary: identity
 * precedes traffic, and `session.reset` tells the assembler to drop any
 * assembly state it still holds for the thread from a previous session.
 */
function openSession(threadId: string, providerThreadId: string): void {
  sessions.set(threadId, providerThreadId);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId,
    providerThreadId,
  });
  emitDeltas(threadId, [{ kind: "session.reset" }]);
}

// ---------------------------------------------------------------------------
// Request handlers, keyed by the protocol vocabulary. A vocabulary method
// with no handler here (thread/fork, thread/archive, …) answers -32601 like
// any unknown method — the runtime only sends capability-gated methods to
// bridges that advertised them, and this bridge advertises none.
// ---------------------------------------------------------------------------

type RequestHandler = (id: JsonRpcId, params: unknown) => void;

function invalidParams(id: JsonRpcId, method: string, issues: unknown): void {
  respondError(
    id,
    BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
    `Invalid params for ${method}`,
    issues,
  );
}

const handlers: Record<string, RequestHandler> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id, params) => {
    const parsed = initializeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.initialize, parsed.error.issues);
      return;
    }
    // Session capabilities absent: sessionRestore, threadArchive, threadRename
    // and threadGoalClear read false and fork reads "none", so the runtime
    // will never send this bridge a capability-gated method. The grammar
    // range is stated: the runtime assembles grammar v3 only, and a bridge
    // that says nothing reads as v2 and is refused at the handshake.
    respondResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.modelList]: (id, params) => {
    const parsed = modelListParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.modelList, parsed.error.issues);
      return;
    }
    // The echo agent exposes no models; the picker falls back to defaults.
    respondResult(id, { models: [], selectedOnlyModels: [] });
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
    threadCounter += 1;
    const providerThreadId = `echo_${instanceNonce}_${threadCounter}`;
    openSession(parsed.data.threadId, providerThreadId);
    respondResult(id, { providerThreadId });
    // A start that carries input runs its first turn immediately. It has no
    // clientRequestId (only turn/start and turn/steer carry one), so no
    // input.accepted delta is emitted for it.
    if (parsed.data.input !== undefined && parsed.data.input.length > 0) {
      runEchoTurn({
        threadId: parsed.data.threadId,
        input: parsed.data.input,
      });
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
    // Stateless resume: re-adopt the caller's provider thread id. The
    // session.reset inside openSession is what keeps assembler-minted turn
    // and item ids unique across the resume even if this provider reused
    // its native keys.
    openSession(parsed.data.threadId, parsed.data.providerThreadId);
    respondResult(id, { providerThreadId: parsed.data.providerThreadId });
  },

  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const parsed = turnStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnStart, parsed.error.issues);
      return;
    }
    respondResult(id, {});
    runEchoTurn({
      threadId: parsed.data.threadId,
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
    // Echo turns settle synchronously, so a steer can never find its target
    // turn still active. The honest reply is the typed protocol error.
    respondError(
      id,
      BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
      `No active turn to steer (expected ${parsed.data.expectedTurnId})`,
    );
  },

  [BRIDGE_REQUEST_METHODS.threadStop]: (id, params) => {
    const parsed = threadStopParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadStop, parsed.error.issues);
      return;
    }
    // Both intents drop the in-memory session. `release` detaches an idle
    // session and must fabricate nothing; `interrupt` would settle an active
    // turn, but echo turns are synchronous so none can be in flight.
    sessions.delete(parsed.data.threadId);
    respondResult(id, {});
  },
};

// ---------------------------------------------------------------------------
// Line handling. Exported so tests can drive the bridge in-process — the
// conformance kit's transport calls handleLine and drains captured stdout.
// ---------------------------------------------------------------------------

export function handleLine(line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    // A non-JSON line is ignored; the bridge stays alive.
    return;
  }
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return;
  }
  const { id, method, params } = message as {
    id?: unknown;
    method?: unknown;
    params?: unknown;
  };
  // Request vs response is discriminated on the presence of `method`, never
  // on result shape: a response-shaped line is not treated as a request.
  if (typeof method !== "string") {
    return;
  }
  if (typeof id !== "string" && typeof id !== "number") {
    // Notification: unknown ones are ignored by design.
    return;
  }
  const handler = handlers[method];
  if (handler === undefined) {
    respondError(
      id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
    );
    return;
  }
  handler(id, params);
}

/**
 * The bridge surface this plugin's host artifact exports. The daemon-side
 * bootstrap imports the artifact, finds this export, and owns the process:
 * argv, the plugin-scoped directories below, stdin framing, and signals.
 * Importing this module (the conformance test does) starts nothing.
 */
export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start(context) {
    // Proof that a bridge really is handed its plugin's own directories: the
    // echo agent has nothing to persist, so it just records where it booted.
    writeFileSync(
      join(context.dataDir, "last-boot.json"),
      `${JSON.stringify({ pluginId: context.pluginId, tempDir: context.tempDir })}\n`,
    );
  },
});
