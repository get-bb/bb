/**
 * The echo-agent provider bridge: a complete grammar v3 implementation of
 * the bb Provider Bridge Protocol (docs/provider-bridge-protocol.md) that
 * exercises every timeline capability a provider plugin has — using only
 * `@get-bb/plugin-sdk/provider-bridge` and zod.
 *
 * `bb plugin build` bundles host.ts (which re-exports this module's
 * `experimental_providerBridge`) into a self-contained artifact; the host
 * daemon downloads it by content hash, verifies it, and runs it with its own
 * node through the bridge bootstrap. Transport is line-delimited JSON-RPC
 * 2.0 on stdin/stdout.
 *
 * Every accepted prompt runs the same scripted turn, so a reader (or a test)
 * knows exactly which rows to expect. In `thread/delta` terms:
 *
 *   input.accepted → turn.open
 *   → command        (item.open + item.outputDelta + item.close)
 *   → fileRead       (item.open + item.close)
 *   → search         (item.open + item.close)
 *   → delegation     (item.open, a keyed CHILD TURN linked by parentRef with
 *                     its own streamed message, item.close with a summary)
 *   → planSteps      (item.open + item.close, the full step list each time)
 *   → tool           (a suppressed bookkeeping row: presentation.suppress)
 *   → tool, server "bb" — the plugin's own `echo_stamp` tool, called over
 *                     `item/tool/call`; the row carries the presentation the
 *                     server attached to the tool definition
 *   → extension item `echo-provider/receipt` (payload validated by the
 *                     server against the plugin's declared schema)
 *   → extension.state `echo-provider/mood` (latest snapshot wins)
 *   → the echoed message (item.textDelta + item.textClose), which also
 *     reports the providerOptions the plugin derived from its settings and
 *     the daemon env var the declaration passed through
 *   → usage → turn.boundary
 *
 * EVERY item.open and item.close carries a declarative `presentation`, so
 * each row renders on every client without plugin code.
 *
 * Prompt directives (plain words anywhere in the prompt):
 * - `/noop`: a zero-work turn — accepted and settled without any activity.
 * - `malformed-receipt`: the receipt payload violates the declared schema,
 *   so the server persists a `provider/unhandled` in its place.
 *
 * Protocol hygiene: an unknown method answers METHOD_NOT_FOUND (-32601);
 * invalid params answer INVALID_PARAMS (-32602) with the issues; a non-JSON
 * line and an unsolicited response-shaped line are ignored and the bridge
 * stays alive. The dispatch table is keyed by the protocol package's own
 * method vocabulary, so it cannot drift from the schemas.
 */
import {
  type ClientTurnRequestId,
  type DeltaPresentation,
  type DynamicTool,
  type PromptInput,
  type ProviderHealthResult,
  type ThreadDelta,
  type ThreadEventTokenUsageBreakdown,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  ZERO_TOKEN_USAGE,
  addTokenUsage,
  createBridgeIo,
  decodeToolCallResponsePayload,
  experimental_defineProviderBridge,
  initializeParamsSchema,
  modelListParamsSchema,
  providerMaintenanceParamsSchema,
  runBridgeRequest,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  AGENT_MESSAGE_PRESENTATION,
  ECHO_GREETING_ENV,
  ECHO_MODEL,
  ECHO_MODEL_ID,
  ECHO_MOOD_KIND,
  ECHO_RECEIPT_KIND,
  ECHO_STAMP_TOOL_NAME,
  NOOP_TOOL_PRESENTATION,
  commandPresentation,
  delegationPresentation,
  echoProviderOptionsSchema,
  fileReadPresentation,
  planStepsPresentation,
  receiptPresentation,
  searchPresentation,
  type EchoMood,
  type EchoProviderOptions,
  type EchoReceipt,
} from "./vocabulary.js";

// ---------------------------------------------------------------------------
// State: one bridge process serves many threads. Sessions are in-memory only
// — the echo agent has nothing to persist, and a resume re-adopts whatever
// provider thread id the runtime hands back, which is why the handshake can
// honestly report `sessionRestore: true`.
// ---------------------------------------------------------------------------

/** Per-instance entropy baked into minted provider thread ids. */
const instanceNonce = randomUUID().replaceAll("-", "").slice(0, 12);
let threadCounter = 0;

interface Session {
  threadId: string;
  providerThreadId: string;
  cwd: string;
  /** Turns echoed since this session was constructed (mood state). */
  turnsEchoed: number;
  /** Running usage total, reset at every session construction. */
  usageTotal: ThreadEventTokenUsageBreakdown;
  /** The bb tools the runtime injected at construction, by name. */
  tools: ReadonlyMap<string, DynamicTool>;
}

/** bb threadId → session. */
const sessions = new Map<string, Session>();

type JsonRpcId = string | number;

/** A message this bridge writes on its own: a notification or a request. */
type OutboundMessage = { jsonrpc: "2.0" } & Record<string, unknown>;

/**
 * The single stdout writer — protocol traffic only, never stray logs. The
 * kit's `sendResult`/`sendError` answer requests; `send` carries the rest.
 */
const io = createBridgeIo<OutboundMessage>();

function notify(method: string, params: Record<string, unknown>): void {
  io.send({ jsonrpc: "2.0", method, params });
}

/** Emit one batched `thread/delta` notification for a thread. */
function emitDeltas(threadId: string, deltas: ThreadDelta[]): void {
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas });
}

// ---------------------------------------------------------------------------
// Requests the bridge makes of the runtime (item/tool/call) and the replies
// it waits for. Requests and responses share one id space on the channel;
// the bridge numbers its own from 1 with a distinctive prefix.
// ---------------------------------------------------------------------------

let outboundRequestCounter = 0;

interface PendingToolCall {
  turn: TurnContext;
}

const pendingToolCalls = new Map<string, PendingToolCall>();

function sendRequest(method: string, params: Record<string, unknown>): string {
  outboundRequestCounter += 1;
  const id = `echo-req-${outboundRequestCounter}`;
  io.send({ jsonrpc: "2.0", id, method, params });
  return id;
}

// ---------------------------------------------------------------------------
// The scripted echo turn
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

/**
 * What the plugin derived for this command. A missing or malformed bag reads
 * as the defaults — the conformance kit and the runtime unit suites send
 * none — but a real server always sends one, and the echoed message shows
 * which case this was.
 */
function parseProviderOptions(options: unknown): {
  source: "server" | "defaults";
  values: EchoProviderOptions;
} {
  const parsed = echoProviderOptionsSchema.safeParse(options);
  if (parsed.success) {
    return { source: "server", values: parsed.data };
  }
  return {
    source: "defaults",
    values: { shout: false, model: ECHO_MODEL_ID, promptMode: null },
  };
}

interface TurnContext {
  session: Session;
  /** Session-unique turn ordinal; prefixes every provider item id. */
  ordinal: number;
  prompt: string;
  providerOptions: ReturnType<typeof parseProviderOptions>;
  /** Items opened before the receipt (the receipt's `itemCount`). */
  itemCount: number;
  malformedReceipt: boolean;
  /** The bb tool item awaiting its `item/tool/call` reply, if any. */
  stamp: { itemId: string; presentation: DeltaPresentation | undefined } | null;
}

function itemId(turn: TurnContext, name: string): string {
  return `echo-${turn.session.providerThreadId}-t${turn.ordinal}-${name}`;
}

function runEchoTurn(args: {
  session: Session;
  input: readonly PromptInput[];
  options: unknown;
  /** Present only for turn/start; thread/start input has no request id. */
  clientRequestId?: ClientTurnRequestId;
}): void {
  const { session } = args;
  const prompt = promptText(args.input);
  const deltas: ThreadDelta[] = [];
  // The provider consumed the input. thread/start input carries no
  // clientRequestId, so a first-turn-on-start emits no acceptance.
  if (args.clientRequestId !== undefined) {
    deltas.push({
      kind: "input.accepted",
      clientRequestId: args.clientRequestId,
    });
  }

  // A zero-work turn: accepted and settled with no activity in between. The
  // boundary claims the turn the pending acceptance opened (`claimIfIdle`)
  // so the thread never hangs active behind a turn that did nothing.
  if (/(?:^|\s)\/noop(?:\s|$)/u.test(prompt)) {
    deltas.push({
      kind: "turn.boundary",
      status: "completed",
      claimIfIdle: true,
    });
    emitDeltas(session.threadId, deltas);
    return;
  }

  session.turnsEchoed += 1;
  const turn: TurnContext = {
    session,
    ordinal: session.turnsEchoed,
    prompt,
    providerOptions: parseProviderOptions(args.options),
    itemCount: 0,
    malformedReceipt: /(?:^|\s)malformed-receipt(?:\s|$)/u.test(prompt),
    stamp: null,
  };
  deltas.push({ kind: "turn.open" });
  deltas.push(...commandDeltas(turn));
  deltas.push(...fileReadDeltas(turn));
  deltas.push(...searchDeltas(turn));
  deltas.push(...delegationDeltas(turn));
  deltas.push(...planStepsDeltas(turn));
  deltas.push(...suppressedToolDeltas(turn));

  // The bb tool: only when the runtime injected it (a real server always
  // does once the plugin is installed; the conformance kit never does).
  const stampTool = session.tools.get(ECHO_STAMP_TOOL_NAME);
  if (stampTool !== undefined) {
    const id = itemId(turn, "stamp");
    turn.stamp = { itemId: id, presentation: stampTool.presentation };
    turn.itemCount += 1;
    deltas.push({
      kind: "item.open",
      key: { providerItemId: id },
      item: {
        type: "tool",
        tool: ECHO_STAMP_TOOL_NAME,
        server: "bb",
        args: { text: prompt },
      },
      ...(stampTool.presentation === undefined
        ? {}
        : { presentation: stampTool.presentation }),
    });
    emitDeltas(session.threadId, deltas);
    // `providerNativeIds`: the runtime maps this call id through the
    // assembler to the bb item id it minted for the row above, and resolves
    // the turn from the open one (`turnId: null`).
    const requestId = sendRequest(BRIDGE_INBOUND_REQUEST_METHODS.toolCall, {
      providerThreadId: session.providerThreadId,
      threadId: session.threadId,
      turnId: null,
      callId: id,
      tool: ECHO_STAMP_TOOL_NAME,
      arguments: { text: prompt },
      providerNativeIds: true,
    });
    pendingToolCalls.set(requestId, { turn });
    return;
  }
  emitDeltas(session.threadId, deltas);
  finishEchoTurn(turn, null);
}

/** A shell command with streamed output. */
function commandDeltas(turn: TurnContext): ThreadDelta[] {
  const id = itemId(turn, "command");
  const command = `echo ${JSON.stringify(turn.prompt)}`;
  const output = `${turn.prompt}\n`;
  const presentation = commandPresentation(command);
  turn.itemCount += 1;
  return [
    {
      kind: "item.open",
      key: { providerItemId: id },
      item: { type: "command", command, cwd: turn.session.cwd },
      presentation,
    },
    {
      kind: "item.outputDelta",
      key: { providerItemId: id },
      channel: "command",
      text: output,
    },
    {
      kind: "item.close",
      key: { providerItemId: id },
      status: "completed",
      exitCode: 0,
      aggregatedOutput: output,
      item: {
        type: "command",
        command,
        cwd: turn.session.cwd,
        aggregatedOutput: output,
        exitCode: 0,
        durationMs: 1,
      },
      presentation,
    },
  ];
}

function fileReadDeltas(turn: TurnContext): ThreadDelta[] {
  const id = itemId(turn, "read");
  const path = join(turn.session.cwd, "README.md");
  const presentation = fileReadPresentation(path);
  turn.itemCount += 1;
  return [
    {
      kind: "item.open",
      key: { providerItemId: id },
      item: { type: "fileRead", path },
      presentation,
    },
    {
      kind: "item.close",
      key: { providerItemId: id },
      status: "completed",
      item: { type: "fileRead", path },
      presentation,
    },
  ];
}

function searchDeltas(turn: TurnContext): ThreadDelta[] {
  const id = itemId(turn, "search");
  const item = {
    type: "search",
    mode: "content",
    query: turn.prompt,
    path: turn.session.cwd,
  } as const;
  const presentation = searchPresentation(turn.prompt);
  turn.itemCount += 1;
  return [
    { kind: "item.open", key: { providerItemId: id }, item, presentation },
    {
      kind: "item.close",
      key: { providerItemId: id },
      status: "completed",
      item,
      presentation,
    },
  ];
}

/**
 * A delegation with a real child turn. The child turn is keyed
 * (`providerTurnId`) and names the delegation as its `parentRef`, so the
 * assembler links its `turn/started` (and every item inside it) to the
 * delegation row through `parentToolCallId` — the one encoding for
 * delegated work in grammar v3.
 */
function delegationDeltas(turn: TurnContext): ThreadDelta[] {
  const id = itemId(turn, "delegate");
  const childTurnId = `${id}-turn`;
  // The child's provider-native id. Keyed on the bb thread id, not on the
  // minted provider thread id: `childRef` is a value (the assembler interns
  // item and turn ids, not references to a child), so a ref that carried
  // this process's entropy would differ on every replay of a recorded
  // session and the parity oracle could never reproduce it.
  const childRef = `${turn.session.threadId}-t${turn.ordinal}-child`;
  const childMessageId = `${id}-message`;
  const label = `Echo "${turn.prompt}" one more time`;
  const childText = `child echo: ${turn.prompt}`;
  const presentation = delegationPresentation(label);
  turn.itemCount += 1;
  return [
    {
      kind: "item.open",
      key: { providerItemId: id },
      item: { type: "delegation", childRef, label, background: false },
      presentation,
    },
    { kind: "turn.open", providerTurnId: childTurnId, parentRef: id },
    // The child's message is opened explicitly so it carries a presentation:
    // a stream that opens itself through `item.textDelta` alone has nowhere
    // to put one. The close echoes the opened presentation.
    {
      kind: "item.open",
      key: { providerItemId: childMessageId, parentRef: id },
      item: { type: "agentMessage", text: "" },
      presentation: AGENT_MESSAGE_PRESENTATION,
      providerTurnId: childTurnId,
    },
    {
      kind: "item.textDelta",
      key: { providerItemId: childMessageId, parentRef: id },
      channel: "agentMessage",
      text: childText,
      providerTurnId: childTurnId,
    },
    {
      kind: "item.textClose",
      key: { providerItemId: childMessageId, parentRef: id },
      channel: "agentMessage",
      text: childText,
      providerTurnId: childTurnId,
    },
    { kind: "turn.boundary", status: "completed", providerTurnId: childTurnId },
    {
      kind: "item.close",
      key: { providerItemId: id },
      status: "completed",
      item: {
        type: "delegation",
        childRef,
        label,
        background: false,
        summary: childText,
      },
      presentation,
    },
  ];
}

/** A plan snapshot: the full step list each time, the active step headlined. */
function planStepsDeltas(turn: TurnContext): ThreadDelta[] {
  const id = itemId(turn, "plan");
  const steps = [
    { step: "Hear the prompt", status: "completed" },
    { step: `Echo "${turn.prompt}"`, status: "active" },
    { step: "Write the receipt", status: "pending" },
  ] as const;
  const explanation = "The echo agent's three-step plan.";
  turn.itemCount += 1;
  return [
    {
      kind: "item.open",
      key: { providerItemId: id },
      item: { type: "planSteps", steps: [...steps], explanation },
      presentation: planStepsPresentation(steps[1].step),
    },
    {
      kind: "item.close",
      key: { providerItemId: id },
      status: "completed",
      item: {
        type: "planSteps",
        steps: steps.map((step) => ({ step: step.step, status: "completed" })),
        explanation,
      },
      presentation: planStepsPresentation(steps[2].step),
    },
  ];
}

/** A generic provider tool whose row is low-value: `presentation.suppress`. */
function suppressedToolDeltas(turn: TurnContext): ThreadDelta[] {
  const id = itemId(turn, "noop");
  turn.itemCount += 1;
  return [
    {
      kind: "item.open",
      key: { providerItemId: id },
      item: { type: "tool", tool: "echo_noop", args: {} },
      presentation: NOOP_TOOL_PRESENTATION,
    },
    {
      kind: "item.close",
      key: { providerItemId: id },
      status: "completed",
      item: { type: "tool", tool: "echo_noop", args: {}, result: "ahem" },
      presentation: NOOP_TOOL_PRESENTATION,
    },
  ];
}

/**
 * The second half of the turn, after the bb tool answered (or immediately
 * when no bb tool was injected): the tool row's close, the receipt, the mood,
 * the echoed message, usage, and the boundary.
 */
function finishEchoTurn(
  turn: TurnContext,
  stamp: { content: string; isError: boolean } | null,
): void {
  const { session } = turn;
  const deltas: ThreadDelta[] = [];

  if (turn.stamp !== null) {
    deltas.push({
      kind: "item.close",
      key: { providerItemId: turn.stamp.itemId },
      status: stamp === null || stamp.isError ? "failed" : "completed",
      item: {
        type: "tool",
        tool: ECHO_STAMP_TOOL_NAME,
        server: "bb",
        args: { text: turn.prompt },
        ...(stamp === null
          ? { error: "no reply" }
          : stamp.isError
            ? { error: stamp.content }
            : { result: stamp.content }),
      },
      ...(turn.stamp.presentation === undefined
        ? {}
        : { presentation: turn.stamp.presentation }),
    });
  }

  // The extension item. The payload is opaque on the wire; the server
  // validates it against the schema this plugin declared for
  // `echo-provider/receipt` and replaces a miss with `provider/unhandled`.
  const receiptId = itemId(turn, "receipt");
  const receipt: EchoReceipt = {
    prompt: turn.prompt,
    itemCount: turn.itemCount,
    shouted: turn.providerOptions.values.shout,
  };
  const receiptPayload = turn.malformedReceipt
    ? { prompt: 42, itemCount: "many" }
    : receipt;
  const receiptRow = receiptPresentation(receipt);
  deltas.push(
    {
      kind: "item.open",
      key: { providerItemId: receiptId },
      item: {
        type: "extension",
        kind: ECHO_RECEIPT_KIND,
        payload: receiptPayload,
      },
      presentation: receiptRow,
    },
    {
      kind: "item.close",
      key: { providerItemId: receiptId },
      status: "completed",
      item: {
        type: "extension",
        kind: ECHO_RECEIPT_KIND,
        payload: receiptPayload,
      },
      presentation: receiptRow,
    },
  );

  // Thread state: the whole snapshot every time, latest wins.
  const mood: EchoMood = {
    mood: session.turnsEchoed > 3 ? "bored" : "cheerful",
    turnsEchoed: session.turnsEchoed,
  };
  deltas.push({
    kind: "extension.state",
    extensionKind: ECHO_MOOD_KIND,
    payload: mood,
  });

  // The echoed message, with the round-trip evidence: what the plugin's
  // deriveProviderOptions produced (from its settings) and the daemon env
  // var the declaration passed through.
  const options = turn.providerOptions.values;
  const echoed = options.shout ? turn.prompt.toUpperCase() : turn.prompt;
  const greeting = process.env[ECHO_GREETING_ENV];
  const lines = [
    `echo: ${echoed}`,
    `providerOptions (${turn.providerOptions.source}): shout=${String(options.shout)} model=${options.model} promptMode=${options.promptMode ?? "none"}`,
    `${ECHO_GREETING_ENV}=${greeting === undefined ? "<unset>" : greeting}`,
    ...(stamp === null ? [] : [`${ECHO_STAMP_TOOL_NAME}: ${stamp.content}`]),
  ];
  const text = lines.join("\n");
  const messageKey = { providerItemId: itemId(turn, "message") };
  deltas.push(
    {
      kind: "item.open",
      key: messageKey,
      item: { type: "agentMessage", text: "" },
      presentation: AGENT_MESSAGE_PRESENTATION,
    },
    // Streamed in two pieces, then settled with the provider-final text.
    {
      kind: "item.textDelta",
      key: messageKey,
      channel: "agentMessage",
      text: lines[0] ?? "",
    },
    {
      kind: "item.textDelta",
      key: messageKey,
      channel: "agentMessage",
      text: text.slice((lines[0] ?? "").length),
    },
    { kind: "item.textClose", key: messageKey, channel: "agentMessage", text },
  );

  // The one usage dialect: this turn's usage plus the running total.
  const last: ThreadEventTokenUsageBreakdown = {
    ...ZERO_TOKEN_USAGE,
    inputTokens: turn.prompt.length,
    outputTokens: text.length,
    totalTokens: turn.prompt.length + text.length,
  };
  session.usageTotal = addTokenUsage(session.usageTotal, last);
  deltas.push(
    {
      kind: "usage",
      total: session.usageTotal,
      last,
      modelContextWindow: 8192,
    },
    {
      kind: "contextWindow",
      used: session.usageTotal.totalTokens,
      size: 8192,
      estimated: true,
      attach: "open",
    },
    { kind: "turn.boundary", status: "completed" },
  );
  emitDeltas(session.threadId, deltas);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Every session construction is a provider id-space boundary: identity
 * precedes traffic, and `session.reset` tells the assembler to drop any
 * assembly state it still holds for the thread from a previous session.
 */
function openSession(args: {
  threadId: string;
  providerThreadId: string;
  cwd: string;
  dynamicTools: readonly DynamicTool[] | undefined;
}): Session {
  const session: Session = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    cwd: args.cwd,
    turnsEchoed: 0,
    usageTotal: ZERO_TOKEN_USAGE,
    tools: new Map((args.dynamicTools ?? []).map((tool) => [tool.name, tool])),
  };
  sessions.set(args.threadId, session);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
  });
  emitDeltas(args.threadId, [{ kind: "session.reset" }]);
  return session;
}

// ---------------------------------------------------------------------------
// Request handlers, keyed by the protocol vocabulary. A vocabulary method
// with no handler here (thread/fork, thread/archive, …) answers -32601 like
// any unknown method — the runtime only sends capability-gated methods to
// bridges that advertised them, and this bridge advertises none of those.
// ---------------------------------------------------------------------------

type RequestHandler = (id: JsonRpcId, params: unknown) => void;

/** The one answer to `provider/health`: nothing to install, sign in to, or update. */
const ECHO_HEALTH: ProviderHealthResult = {
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

function invalidParams(id: JsonRpcId, method: string, issues: unknown): void {
  // The issues ride `error.data` as the validator produced them.
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

const handlers: Record<string, RequestHandler> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id, params) => {
    const parsed = initializeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.initialize, parsed.error.issues);
      return;
    }
    // Session-behavior facts are REPORTED here, never declared: the code
    // that implements a feature is the code that says it exists. The grammar
    // range is stated explicitly — a bridge that says nothing reads as v2
    // and is refused at the handshake.
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        // Stateless resume: a released session re-attaches from its id.
        sessionRestore: true,
        threadArchive: false,
        threadRename: false,
        threadGoalClear: false,
        fork: "none",
        approvalEnforcedBy: "runtime",
        // A steer never reaches a live echo turn; it waits for the next
        // prompt boundary.
        steerMode: "queue",
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.modelList]: (id, params) => {
    const parsed = modelListParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.modelList, parsed.error.issues);
      return;
    }
    // The live model list replaces the declaration's cold-cache fallback:
    // the same entry, plus the wire `model` id the list format requires.
    io.sendResult(id, {
      models: [{ ...ECHO_MODEL, model: ECHO_MODEL_ID }],
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
    // Sessionless and host-local: the server polls this through the daemon
    // for every provider whose declaration says `maintenance.health`. An
    // echo runs in-process, so it is always ready. Usage and installation
    // are not declared, so the runtime never sends those methods here.
    io.sendResult(id, ECHO_HEALTH);
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
    const session = openSession({
      threadId: parsed.data.threadId,
      providerThreadId,
      cwd: parsed.data.cwd,
      dynamicTools: parsed.data.dynamicTools,
    });
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
    // A start that carries input runs its first turn immediately. It has no
    // clientRequestId (only turn/start and turn/steer carry one), so no
    // input.accepted delta is emitted for it.
    if (parsed.data.input !== undefined && parsed.data.input.length > 0) {
      runEchoTurn({
        session,
        input: parsed.data.input,
        options: parsed.data.options.providerOptions,
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
    // and item ids unique across the resume even though this bridge reuses
    // its native keys per session.
    openSession({
      threadId: parsed.data.threadId,
      providerThreadId: parsed.data.providerThreadId,
      cwd: parsed.data.cwd,
      dynamicTools: parsed.data.dynamicTools,
    });
    io.sendResult(id, {
      providerThreadId: parsed.data.providerThreadId,
      sessionRestorable: true,
    });
  },

  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const parsed = turnStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnStart, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (session === undefined) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
        `No session for thread ${parsed.data.threadId}; send thread/start or thread/resume first`,
      );
      return;
    }
    io.sendResult(id, {});
    runEchoTurn({
      session,
      input: parsed.data.input,
      options: parsed.data.options.providerOptions,
      clientRequestId: parsed.data.clientRequestId,
    });
  },

  [BRIDGE_REQUEST_METHODS.turnSteer]: (id, params) => {
    const parsed = turnSteerParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnSteer, parsed.error.issues);
      return;
    }
    // Echo turns settle as soon as the bb tool answers, so a steer can never
    // find its target turn still active. The honest reply is the typed
    // protocol error; the runtime then starts the steer text as a new turn.
    io.sendError(
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
    // turn, but the only thing an echo turn ever waits on is its bb tool
    // reply, which the runtime itself answers before it interrupts.
    sessions.delete(parsed.data.threadId);
    io.sendResult(id, {});
  },
};

// ---------------------------------------------------------------------------
// Line handling. Exported so tests can drive the bridge in-process — the
// conformance kit's transport calls handleLine and drains captured stdout.
// ---------------------------------------------------------------------------

const jsonRpcResponseSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z.unknown().optional(),
  })
  .passthrough();

/** A reply to one of this bridge's own requests (the bb tool call). */
function handleResponse(message: unknown): void {
  const parsed = jsonRpcResponseSchema.safeParse(message);
  if (!parsed.success || typeof parsed.data.id !== "string") {
    return;
  }
  const pending = pendingToolCalls.get(parsed.data.id);
  if (pending === undefined) {
    // An unsolicited response-shaped line: ignored by design.
    return;
  }
  pendingToolCalls.delete(parsed.data.id);
  if (!sessions.has(pending.turn.session.threadId)) {
    return;
  }
  if (parsed.data.error !== undefined) {
    const error = z
      .object({ message: z.string() })
      .safeParse(parsed.data.error);
    finishEchoTurn(pending.turn, {
      content: error.success ? error.data.message : "tool call failed",
      isError: true,
    });
    return;
  }
  const decoded = decodeToolCallResponsePayload(parsed.data.result);
  finishEchoTurn(pending.turn, {
    content: decoded.content,
    isError: decoded.isError,
  });
}

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
  // on result shape: a response-shaped line is never treated as a request.
  if (typeof method !== "string") {
    handleResponse(message);
    return;
  }
  if (typeof id !== "string" && typeof id !== "number") {
    // Notification: unknown ones are ignored by design.
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
  // A handler that throws answers an error instead of taking the bridge
  // down; a thrown `experimental_BridgeRecoveryError` answers with its typed
  // hint as `error.data.recovery`.
  runBridgeRequest({
    request: { id, method, params },
    sendError: io.sendError,
    handleRequest: async (request) => handler(request.id, request.params),
  });
}

/**
 * The bridge surface this plugin's host artifact exports. The daemon-side
 * bootstrap imports the artifact, finds this export, and owns the process:
 * argv, the plugin-scoped directories below, stdin framing, and signals.
 * Importing this module (the tests do) starts nothing.
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
