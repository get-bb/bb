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
 * - Ids: the bridge mints every turn and item id, with per-instance entropy
 *   so ids never collide across process restarts or session resumes.
 * - Grammar: every accepted turn settles (accepted → started → completed);
 *   every item opens with item/started before any delta; a release stop
 *   fabricates nothing.
 */
import {
  type PromptInput,
  type ThreadEvent,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
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

/** Per-instance entropy baked into every minted id (the #1224 lesson). */
const instanceNonce = randomUUID().replaceAll("-", "").slice(0, 12);
let threadCounter = 0;
let turnCounter = 0;

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

function emitThreadEvent(threadId: string, event: ThreadEvent): void {
  notify(BRIDGE_NOTIFICATION_METHODS.threadEvent, { threadId, event });
}

// ---------------------------------------------------------------------------
// The echo turn: accepted → started → item/started → delta(s) → completed.
// Turns settle synchronously — echoing needs no provider round-trip.
// ---------------------------------------------------------------------------

function promptText(input: readonly PromptInput[]): string {
  return input
    .filter((item): item is Extract<PromptInput, { type: "text" }> =>
      item.type === "text",
    )
    .map((item) => item.text)
    .join("");
}

function runEchoTurn(args: {
  threadId: string;
  providerThreadId: string;
  input: readonly PromptInput[];
  /** Present only for turn/start; thread/start input has no request id. */
  clientRequestId?: string;
}): void {
  turnCounter += 1;
  const turnId = `turn_echo_${instanceNonce}_${turnCounter}`;
  const itemId = `${turnId}_item_1`;
  const scope = { kind: "turn", turnId } as const;
  const base = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
  };
  const text = `echo: ${promptText(args.input)}`;

  if (args.clientRequestId !== undefined) {
    emitThreadEvent(args.threadId, {
      type: "turn/input/accepted",
      ...base,
      clientRequestId: args.clientRequestId,
      scope,
    });
  }
  emitThreadEvent(args.threadId, { type: "turn/started", ...base, scope });
  emitThreadEvent(args.threadId, {
    type: "item/started",
    ...base,
    item: { type: "agentMessage", id: itemId, text: "" },
    scope,
  });
  emitThreadEvent(args.threadId, {
    type: "item/agentMessage/delta",
    ...base,
    itemId,
    delta: text,
    scope,
  });
  emitThreadEvent(args.threadId, {
    type: "item/completed",
    ...base,
    item: { type: "agentMessage", id: itemId, text },
    scope,
  });
  emitThreadEvent(args.threadId, {
    type: "turn/completed",
    ...base,
    status: "completed",
    scope,
  });
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
    // All capabilities absent: sessionRestore, threadArchive, threadRename
    // and threadGoalClear read false and fork reads "none", so the runtime
    // will never send this bridge a capability-gated method.
    respondResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {},
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
    sessions.set(parsed.data.threadId, providerThreadId);
    // Identity precedes every thread/event for the session.
    notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
      threadId: parsed.data.threadId,
      providerThreadId,
    });
    respondResult(id, { providerThreadId });
    // A start that carries input runs its first turn immediately. It has no
    // clientRequestId (only turn/start and turn/steer carry one), so no
    // turn/input/accepted is emitted for it.
    if (parsed.data.input !== undefined && parsed.data.input.length > 0) {
      runEchoTurn({
        threadId: parsed.data.threadId,
        providerThreadId,
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
    // Stateless resume: re-adopt the caller's provider thread id. Turn and
    // item ids stay unique across the resume because every minted id embeds
    // the instance nonce plus a monotonic counter.
    sessions.set(parsed.data.threadId, parsed.data.providerThreadId);
    notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
      threadId: parsed.data.threadId,
      providerThreadId: parsed.data.providerThreadId,
    });
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
      providerThreadId: parsed.data.providerThreadId,
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
