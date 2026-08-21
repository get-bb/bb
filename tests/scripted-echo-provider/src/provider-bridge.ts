/**
 * The scripted echo provider bridge: the runtime and integration suites' test
 * double, speaking the real Provider Bridge Protocol through the real
 * bridge-protocol adapter and delta assembler.
 *
 * It is the echo example bridge (`examples/plugins/echo-provider`) with the
 * scripted behaviour a test needs to drive lifecycle, interaction, and
 * tool-call paths. A prompt's text carries the directives; nothing else about
 * the provider is special:
 *
 * - `delay:<ms>` — hold the turn open that long before it settles (a stop
 *   can interrupt it, siblings can run beside it).
 * - `approve:<command|file_change|permission_grant|plan>` — raise an approval
 *   on the `interaction/request` channel before answering; a denied approval
 *   answers `Denied`.
 * - `ask_user` — raise a user question; the answer is echoed back.
 * - `call_tool:<name>` / `call_tool_unresolved:<name>` — call a dynamic tool
 *   on `item/tool/call` with a resolved (vouched) or unresolved (null) turn id
 *   and answer `Tool called: <name>`.
 * - `hold_turn` — open the turn and never settle it (a stop interrupts it).
 * - `fail_turn:<text>` / `prestart_fail:<text>` — raise a provider error
 *   carrying the text (underscores read as spaces) and settle the turn as
 *   failed, after or before the turn opens.
 * - otherwise the turn answers `Response to: <prompt text>`.
 *
 * Process- and session-level behaviour (archived sessions, failing commands,
 * crashes at a chosen method, slow starts) is scripted through
 * {@link ScriptedEchoOptions}: either `options.providerOptions.scripted` on
 * a session/turn command (the runtime merges a bridge launch's
 * `providerOptions` into every command) or the `SCRIPTED_ECHO_OPTIONS` env
 * JSON for behaviour that must apply before any session exists. With
 * `SCRIPTED_ECHO_RECORD_PATH` set, every handled request is appended to that
 * JSONL file so a suite can assert on what reached the provider.
 *
 * Turns are vouched: every delta names the bridge's own `turn-N` id and every
 * bridge → runtime request marks `providerNativeIds`, so the suites exercise
 * the assembler's provider↔bb id maps the way codex does.
 */
import {
  type ClientTurnRequestId,
  type PendingInteractionPayload,
  type PromptInput,
  type ThreadDelta,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  initializeParamsSchema,
  modelListParamsSchema,
  skillsConfigureParamsSchema,
  threadArchiveParamsSchema,
  threadDiscardParamsSchema,
  threadForkParamsSchema,
  threadGoalClearParamsSchema,
  threadNameSetParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  threadUnarchiveParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  experimental_defineProviderBridge,
} from "@get-bb/plugin-sdk/provider-bridge";
import { appendFileSync } from "node:fs";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Scripted options
// ---------------------------------------------------------------------------

const scriptedMethodSchema = z.enum([
  "initialize",
  "model/list",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "turn/start",
  "turn/steer",
  "thread/stop",
  "thread/discard",
  "thread/archive",
  "thread/unarchive",
  "thread/name/set",
  "thread/goal/clear",
  "skills/configure",
]);
export type ScriptedMethod = z.infer<typeof scriptedMethodSchema>;

export const scriptedEchoOptionsSchema = z
  .object({
    /** Every session construction answers after this many ms. */
    startDelayMs: z.number().int().nonnegative().optional(),
    /** `thread/start` answers `{ providerThreadId: <the bb thread id> }`. */
    identityFromThreadId: z.boolean().optional(),
    /** Answer thread/start with `{ threadId }` instead of an identity. */
    answerStartWithoutIdentity: z.boolean().optional(),
    /**
     * Reject resume/fork/turn.start/turn.steer with the codex-shaped
     * "session … is archived" error until `thread/unarchive` names the
     * session.
     */
    archivedSession: z.boolean().optional(),
    /** `thread/unarchive` fails. */
    unarchiveFails: z.boolean().optional(),
    /** Exit the process right after answering the archived error. */
    exitAfterArchivedError: z.boolean().optional(),
    /** The first `thread/discard` fails; later ones succeed. */
    discardFailsOnce: z.boolean().optional(),
    /** Exit the process when this method arrives (before answering). */
    crashOn: scriptedMethodSchema.optional(),
    /** Exit the process right after answering this method. */
    exitAfter: scriptedMethodSchema.optional(),
    /** Answer these methods with METHOD_NOT_FOUND. */
    unsupportedMethods: z.array(scriptedMethodSchema).optional(),
    /**
     * Answer these methods with a JSON-RPC error carrying this message and
     * `code` (default -32000; e.g. NO_ACTIVE_TURN to reject a steer the way a
     * provider with no live turn does). With `times`, only the first that
     * many calls of the method fail (counted per process) and later ones are
     * handled normally — a transient failure.
     */
    failMethods: z
      .array(
        z.object({
          method: scriptedMethodSchema,
          message: z.string(),
          code: z.number().int().optional(),
          times: z.number().int().positive().optional(),
        }),
      )
      .optional(),
    /** Delay the goal-cleared state delta by this many ms after the answer. */
    goalClearNotifyDelayMs: z.number().int().nonnegative().optional(),
    /**
     * The `cleared` value `thread/goal/clear` answers (default true). The
     * goal-cleared state delta is emitted either way: a false answer models
     * a provider that persisted the clear after it had already responded.
     */
    goalClearReportsCleared: z.boolean().optional(),
    /** Accept `turn/start` but never open the turn (the watchdog case). */
    swallowTurnStart: z.boolean().optional(),
    /** Report `sessionRestorable` on every identity result. */
    sessionRestorable: z.boolean().optional(),
    /** Prefix the echoed user message as a provider warning (test noise). */
    warnOnTurn: z.boolean().optional(),
    /**
     * The bb thread id the bridge puts on its `item/tool/call` requests
     * instead of the session's own — a provider whose thread hint disagrees
     * with its provider-thread identity.
     */
    toolCallThreadIdHint: z.string().min(1).optional(),
    /**
     * The `approvalEnforcedBy` the handshake reports (default `runtime`).
     * Process-level only (`SCRIPTED_ECHO_OPTIONS`): `initialize` carries no
     * session options.
     */
    approvalEnforcedBy: z.enum(["runtime", "provider"]).optional(),
    /**
     * Mint provider thread ids as `prov-<pid>-<n>` and prefix every answer
     * with `pid:<pid>:`, so a test can tell which bridge process served a
     * thread (process-per-thread providers, restarts, reaping).
     */
    identifyProcess: z.boolean().optional(),
    /** Refuse `thread/stop` for these bb thread ids (-32000). */
    failStopForThreadIds: z.array(z.string().min(1)).optional(),
    /**
     * On SIGTERM, emit a late `thread/identity` for every open session
     * before exiting — a provider that keeps talking while it is shut down.
     * Process-level (`SCRIPTED_ECHO_OPTIONS`).
     */
    emitIdentityOnSigterm: z.boolean().optional(),
  })
  .strict();
export type ScriptedEchoOptions = z.infer<typeof scriptedEchoOptionsSchema>;

const SCRIPTED_OPTIONS_ENV = "SCRIPTED_ECHO_OPTIONS";
/**
 * When set, every request the bridge handles is appended to this JSONL file
 * as `{ method, params }` — the suites' view of what reached the provider
 * (session construction options, dynamic tools, skill roots, turn input).
 */
const SCRIPTED_RECORD_PATH_ENV = "SCRIPTED_ECHO_RECORD_PATH";
/**
 * When set, the bridge appends one line per process-lifecycle step to this
 * file: `spawn:<pid>`, `exit:<pid>` (on SIGTERM), and
 * `<method>:<pid>:<threadId>` for thread/start, thread/resume, turn/start
 * and thread/stop — the per-process view the request record (which has no
 * pid) cannot give.
 */
const SCRIPTED_PROCESS_LOG_PATH_ENV = "SCRIPTED_ECHO_PROCESS_LOG_PATH";

function logProcessStep(step: string): void {
  const logPath = process.env[SCRIPTED_PROCESS_LOG_PATH_ENV];
  if (logPath === undefined || logPath.length === 0) {
    return;
  }
  appendFileSync(logPath, `${step}\n`);
}
logProcessStep(`spawn:${process.pid}`);

function readEnvOptions(): ScriptedEchoOptions {
  const raw = process.env[SCRIPTED_OPTIONS_ENV];
  if (raw === undefined || raw.length === 0) {
    return {};
  }
  return scriptedEchoOptionsSchema.parse(JSON.parse(raw));
}

let processOptions: ScriptedEchoOptions = {};
try {
  processOptions = readEnvOptions();
} catch (error) {
  process.stderr.write(
    `scripted echo bridge: invalid ${SCRIPTED_OPTIONS_ENV}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

/** Per-command scripted options win over the process-level env options. */
function scriptedOptionsFor(
  providerOptions: Record<string, unknown> | undefined,
): ScriptedEchoOptions {
  const fromCommand = providerOptions?.scripted;
  if (fromCommand === undefined) {
    return processOptions;
  }
  const parsed = scriptedEchoOptionsSchema.safeParse(fromCommand);
  if (!parsed.success) {
    process.stderr.write(
      `scripted echo bridge: ignoring invalid providerOptions.scripted: ${parsed.error.message}\n`,
    );
    return processOptions;
  }
  return { ...processOptions, ...parsed.data };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type JsonRpcId = string | number;

interface ActiveTurn {
  providerTurnId: string;
  timer: NodeJS.Timeout | null;
}

interface Session {
  threadId: string;
  providerThreadId: string;
  turnCount: number;
  messageCount: number;
  activeTurn: ActiveTurn | null;
  options: ScriptedEchoOptions;
}

type PendingReply =
  | { kind: "tool"; threadId: string; toolName: string; delayMs: number }
  | { kind: "question"; threadId: string; delayMs: number }
  | {
      kind: "approval";
      threadId: string;
      responseText: string;
      delayMs: number;
    };

const sessions = new Map<string, Session>();
const pendingReplies = new Map<JsonRpcId, PendingReply>();
const unarchivedSessionIds = new Set<string>();
/** How many times each method has failed under a bounded `failMethods` entry. */
const scriptedFailureCounts = new Map<ScriptedMethod, number>();
let discardFailed = false;
let providerThreadCounter = 0;
let outboundRequestCounter = 0;

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

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

function emitDeltas(threadId: string, deltas: ThreadDelta[]): void {
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas });
}

function sendRequest(
  method: string,
  params: Record<string, unknown>,
): JsonRpcId {
  outboundRequestCounter += 1;
  const id = `scripted-${outboundRequestCounter}`;
  writeMessage({ id, method, params });
  return id;
}

function exitProcess(): void {
  // Flush ordering: stdout is a pipe here, so the writes above are already
  // handed to the kernel; exiting synchronously mirrors a crashed provider.
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Directives
// ---------------------------------------------------------------------------

type ApprovalKind = "command" | "file_change" | "permission_grant" | "plan";
const APPROVAL_KINDS: readonly ApprovalKind[] = [
  "command",
  "file_change",
  "permission_grant",
  "plan",
];

interface TurnPlan {
  approvalKind: ApprovalKind | null;
  delayMs: number;
  questionRequested: boolean;
  responseText: string;
  toolName: string | null;
  toolTurnResolved: boolean;
  /** `hold_turn`: open the turn and never settle it (until a stop). */
  holdTurn: boolean;
  /**
   * `fail_turn:<text>`: open the turn, raise a provider error carrying the
   * text, and settle the turn as failed. `prestart_fail:<text>`: raise the
   * error before the turn opens (a turnless, thread-scoped error).
   */
  failure: { text: string; beforeTurn: boolean } | null;
}

function promptText(input: readonly PromptInput[]): string {
  return input
    .filter(
      (item): item is Extract<PromptInput, { type: "text" }> =>
        item.type === "text",
    )
    .map((item) => item.text)
    .join(" ");
}

function parseTurnPlan(inputText: string): TurnPlan {
  const delayMatch = /(?:^|\s)delay:(\d+)(?:\s|$)/u.exec(inputText);
  const questionMatch = /(?:^|\s)ask_user(?:\s|$)/u.exec(inputText);
  const approvalMatch = /(?:^|\s)approve:([^\s]+)(?:\s|$)/u.exec(inputText);
  const unresolvedToolMatch =
    /(?:^|\s)call_tool_unresolved:([^\s]+)(?:\s|$)/u.exec(inputText);
  const toolMatch =
    unresolvedToolMatch ??
    /(?:^|\s)call_tool:([^\s]+)(?:\s|$)/u.exec(inputText);
  const approvalKind =
    APPROVAL_KINDS.find((kind) => kind === approvalMatch?.[1]) ?? null;
  const holdMatch = /(?:^|\s)hold_turn(?:\s|$)/u.exec(inputText);
  const failMatch = /(?:^|\s)fail_turn:([^\s]+)(?:\s|$)/u.exec(inputText);
  const prestartFailMatch = /(?:^|\s)prestart_fail:([^\s]+)(?:\s|$)/u.exec(
    inputText,
  );
  const failureText = prestartFailMatch?.[1] ?? failMatch?.[1];
  return {
    approvalKind,
    delayMs: delayMatch?.[1] === undefined ? 0 : Number(delayMatch[1]),
    questionRequested: questionMatch !== null,
    responseText:
      inputText.length > 0 ? `Response to: ${inputText}` : "Response complete",
    toolName: toolMatch?.[1] ?? null,
    toolTurnResolved: unresolvedToolMatch === null,
    holdTurn: holdMatch !== null,
    failure:
      failureText === undefined
        ? null
        : {
            // Underscores stand in for spaces so the text rides one token.
            text: failureText.replaceAll("_", " "),
            beforeTurn: prestartFailMatch !== null,
          },
  };
}

// Deterministic fixture subjects so UI and e2e flows can assert on them.
function approvalPayload(
  kind: ApprovalKind,
  itemId: string,
): PendingInteractionPayload {
  switch (kind) {
    case "command":
      return {
        kind: "approval",
        subject: {
          kind: "command",
          itemId,
          command: "echo hi",
          cwd: null,
          actions: [],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      };
    case "file_change":
      return {
        kind: "approval",
        subject: {
          kind: "file_change",
          itemId,
          writeScope: null,
          sessionGrant: null,
        },
        reason: "Write src/example.ts",
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      };
    case "permission_grant":
      return {
        kind: "approval",
        subject: {
          kind: "permission_grant",
          itemId,
          toolName: "Edit",
          permissions: {
            network: null,
            fileSystem: { read: [], write: ["src/example.ts"] },
          },
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      };
    case "plan":
      return {
        kind: "approval",
        subject: {
          kind: "plan",
          itemId,
          plan: "# Fake plan\n\n1. Say hi\n2. Report back",
          planFilePath: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "deny"],
      };
  }
}

function userQuestionPayload(requestId: JsonRpcId): PendingInteractionPayload {
  return {
    kind: "user_question",
    questions: [
      {
        id: `${String(requestId)}:question-1`,
        prompt: "Which deployment path should the fake provider use?",
        shortLabel: "Path",
        multiSelect: false,
        options: [
          {
            value: "staging",
            label: "Staging",
            description: "Deploy to staging first.",
          },
          {
            value: "production",
            label: "Production",
            description: "Deploy directly to production.",
          },
        ],
        allowFreeText: true,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Turn lifecycle, in deltas
// ---------------------------------------------------------------------------

function clearActiveTurn(session: Session): void {
  if (session.activeTurn?.timer) {
    clearTimeout(session.activeTurn.timer);
  }
  session.activeTurn = null;
}

function completeTurn(
  session: Session,
  status: "completed" | "interrupted" | "failed",
  text: string,
): void {
  const turn = session.activeTurn;
  if (turn === null) {
    return;
  }
  clearActiveTurn(session);
  const responseText =
    session.options.identifyProcess === true
      ? `pid:${process.pid}:${text}`
      : text;
  const deltas: ThreadDelta[] = [];
  if (status === "completed") {
    session.messageCount += 1;
    const key = { providerItemId: `msg-${session.messageCount}` };
    // A provider-named message item: opened empty, closed with the final
    // text (item/started → item/completed, like codex).
    deltas.push(
      {
        kind: "item.open",
        key,
        item: { type: "agentMessage", text: "" },
        providerTurnId: turn.providerTurnId,
      },
      {
        kind: "item.close",
        key,
        status: "completed",
        item: { type: "agentMessage", text: responseText },
        providerTurnId: turn.providerTurnId,
      },
    );
  }
  deltas.push({
    kind: "turn.boundary",
    status,
    providerTurnId: turn.providerTurnId,
  });
  emitDeltas(session.threadId, deltas);
}

function scheduleCompletion(
  session: Session,
  responseText: string,
  delayMs: number,
): void {
  if (session.activeTurn === null) {
    return;
  }
  session.activeTurn.timer = setTimeout(() => {
    completeTurn(session, "completed", responseText);
  }, delayMs);
}

function beginTurn(args: {
  session: Session;
  input: readonly PromptInput[];
  clientRequestId?: ClientTurnRequestId;
}): void {
  const { session } = args;
  clearActiveTurn(session);
  const plan = parseTurnPlan(promptText(args.input));
  if (plan.failure !== null && plan.failure.beforeTurn) {
    // The provider refused before any turn opened: a thread-scoped error
    // that claims the accepted input, never a started turn.
    if (args.clientRequestId !== undefined) {
      emitDeltas(session.threadId, [
        { kind: "input.accepted", clientRequestId: args.clientRequestId },
      ]);
    }
    emitDeltas(session.threadId, [
      {
        kind: "provider.error",
        message: "Provider error",
        detail: plan.failure.text,
        willRetry: false,
        settlesTurn: true,
      },
    ]);
    return;
  }
  session.turnCount += 1;
  const providerTurnId = `turn-${session.turnCount}`;
  session.activeTurn = { providerTurnId, timer: null };

  const deltas: ThreadDelta[] = [];
  if (args.clientRequestId !== undefined) {
    deltas.push({
      kind: "input.accepted",
      clientRequestId: args.clientRequestId,
      providerTurnId,
    });
  }
  deltas.push({ kind: "turn.open", providerTurnId });
  if (session.options.warnOnTurn === true) {
    deltas.push({
      kind: "provider.warning",
      category: "general",
      summary: "scripted warning",
      vouchedTurn: true,
    });
  }
  emitDeltas(session.threadId, deltas);

  if (plan.holdTurn) {
    return;
  }
  if (plan.failure !== null) {
    clearActiveTurn(session);
    emitDeltas(session.threadId, [
      {
        kind: "provider.error",
        message: "Provider error",
        detail: plan.failure.text,
        willRetry: false,
        settlesTurn: true,
        providerTurnId,
      },
    ]);
    return;
  }

  if (plan.approvalKind !== null) {
    const requestId = sendRequest(
      BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
      {
        providerThreadId: session.providerThreadId,
        threadId: session.threadId,
        turnId: providerTurnId,
        payload: approvalPayload(
          plan.approvalKind,
          `approval-${providerTurnId}`,
        ),
        providerNativeIds: true,
      },
    );
    pendingReplies.set(requestId, {
      kind: "approval",
      threadId: session.threadId,
      responseText: plan.responseText,
      delayMs: plan.delayMs,
    });
    return;
  }
  if (plan.questionRequested) {
    outboundRequestCounter += 1;
    const requestId = `scripted-${outboundRequestCounter}`;
    writeMessage({
      id: requestId,
      method: BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
      params: {
        providerThreadId: session.providerThreadId,
        threadId: session.threadId,
        turnId: providerTurnId,
        payload: userQuestionPayload(requestId),
        providerNativeIds: true,
      },
    });
    pendingReplies.set(requestId, {
      kind: "question",
      threadId: session.threadId,
      delayMs: plan.delayMs,
    });
    return;
  }
  if (plan.toolName !== null) {
    const requestId = sendRequest(BRIDGE_INBOUND_REQUEST_METHODS.toolCall, {
      providerThreadId: session.providerThreadId,
      threadId: session.options.toolCallThreadIdHint ?? session.threadId,
      turnId: plan.toolTurnResolved ? providerTurnId : null,
      callId: `call-${session.turnCount}`,
      tool: plan.toolName,
      arguments: {},
      providerNativeIds: true,
    });
    pendingReplies.set(requestId, {
      kind: "tool",
      threadId: session.threadId,
      toolName: plan.toolName,
      delayMs: plan.delayMs,
    });
    return;
  }
  scheduleCompletion(session, plan.responseText, plan.delayMs);
}

// ---------------------------------------------------------------------------
// Responses to the bridge's own requests
// ---------------------------------------------------------------------------

function describeAnswer(result: unknown): string {
  const parsed = z
    .object({
      answers: z.record(
        z.string(),
        z.object({
          selected: z.array(z.string()).default([]),
          freeText: z.string().default(""),
        }),
      ),
    })
    .safeParse(result);
  const first = parsed.success
    ? Object.values(parsed.data.answers)[0]
    : undefined;
  if (first === undefined) {
    return "no answer";
  }
  return [...first.selected, first.freeText]
    .filter((part) => part.length > 0)
    .join(", ");
}

function isAllowedDecision(result: unknown): boolean {
  const parsed = z.object({ decision: z.string() }).safeParse(result);
  return (
    parsed.success &&
    (parsed.data.decision === "allow_once" ||
      parsed.data.decision === "allow_for_session")
  );
}

const jsonRpcErrorSchema = z
  .object({ code: z.number(), message: z.string() })
  .passthrough();

/**
 * The runtime answered one of this bridge's requests. A result resumes the
 * turn per the request kind; an error (the tool handler threw, the
 * interaction was unsupported or malformed) fails the turn with the error's
 * message, the way a real provider surfaces a failed tool or approval — so a
 * test can observe the runtime's error answer on the timeline.
 */
function handleResponse(
  id: JsonRpcId,
  result: unknown,
  error: unknown,
): boolean {
  const pending = pendingReplies.get(id);
  if (pending === undefined) {
    return false;
  }
  pendingReplies.delete(id);
  const session = sessions.get(pending.threadId);
  if (session === undefined) {
    return true;
  }
  const parsedError = jsonRpcErrorSchema.safeParse(error);
  if (parsedError.success) {
    const turn = session.activeTurn;
    if (turn !== null) {
      clearActiveTurn(session);
      emitDeltas(session.threadId, [
        {
          kind: "provider.error",
          message: `${pending.kind} request failed: ${parsedError.data.message}`,
          detail: `JSON-RPC error ${parsedError.data.code}`,
          settlesTurn: true,
          providerTurnId: turn.providerTurnId,
        },
      ]);
    }
    return true;
  }
  switch (pending.kind) {
    case "tool":
      scheduleCompletion(
        session,
        `Tool called: ${pending.toolName}`,
        pending.delayMs,
      );
      return true;
    case "question":
      scheduleCompletion(
        session,
        `Question answered: ${describeAnswer(result)}`,
        pending.delayMs,
      );
      return true;
    case "approval":
      scheduleCompletion(
        session,
        isAllowedDecision(result) ? pending.responseText : "Denied",
        pending.delayMs,
      );
      return true;
  }
}

// ---------------------------------------------------------------------------
// Session construction
// ---------------------------------------------------------------------------

function archivedSessionError(providerThreadId: string): string {
  return `session ${providerThreadId} is archived. Run codex unarchive ${providerThreadId} to unarchive it first.`;
}

/**
 * The archived-session gate: a fork reads its source session, everything
 * else acts on the thread's own session.
 */
function rejectIfArchived(
  id: JsonRpcId,
  options: ScriptedEchoOptions,
  providerThreadId: string,
): boolean {
  if (
    options.archivedSession !== true ||
    unarchivedSessionIds.has(providerThreadId)
  ) {
    return false;
  }
  respondError(id, -32000, archivedSessionError(providerThreadId));
  if (options.exitAfterArchivedError === true) {
    exitProcess();
  }
  return true;
}

function openSession(args: {
  threadId: string;
  providerThreadId: string;
  options: ScriptedEchoOptions;
}): Session {
  const session: Session = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    turnCount: 0,
    messageCount: 0,
    activeTurn: null,
    options: args.options,
  };
  sessions.set(args.threadId, session);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    ...(args.options.sessionRestorable === undefined
      ? {}
      : { sessionRestorable: args.options.sessionRestorable }),
  });
  emitDeltas(args.threadId, [{ kind: "session.reset" }]);
  return session;
}

function mintProviderThreadId(
  options: ScriptedEchoOptions,
  threadId: string,
): string {
  if (options.identityFromThreadId === true) {
    return threadId;
  }
  providerThreadCounter += 1;
  return options.identifyProcess === true
    ? `prov-${process.pid}-${providerThreadCounter}`
    : `prov-${providerThreadCounter}`;
}

function identityResult(session: Session): Record<string, unknown> {
  if (session.options.answerStartWithoutIdentity === true) {
    return { threadId: session.threadId };
  }
  return {
    providerThreadId: session.providerThreadId,
    ...(session.options.sessionRestorable === undefined
      ? {}
      : { sessionRestorable: session.options.sessionRestorable }),
  };
}

function afterStartDelay(options: ScriptedEchoOptions, run: () => void): void {
  if (options.startDelayMs === undefined || options.startDelayMs === 0) {
    run();
    return;
  }
  setTimeout(run, options.startDelayMs);
}

// ---------------------------------------------------------------------------
// Request handlers
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

const MODEL_LIST = {
  models: [
    {
      id: "fake-model",
      model: "fake-model",
      displayName: "Fake Model",
      description: "Fake model for integration and runtime tests",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Medium" },
      ],
      defaultReasoningEffort: "medium",
      isDefault: true,
    },
  ],
  selectedOnlyModels: [],
};

const handlers: Record<string, RequestHandler> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id, params) => {
    const parsed = initializeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.initialize, parsed.error.issues);
      return;
    }
    respondResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        sessionRestore: true,
        threadArchive: true,
        threadRename: true,
        threadGoalClear: true,
        fork: "checkpoint",
        approvalEnforcedBy: processOptions.approvalEnforcedBy ?? "runtime",
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        steerMode: "inject",
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.modelList]: (id, params) => {
    const parsed = modelListParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.modelList, parsed.error.issues);
      return;
    }
    respondResult(id, MODEL_LIST);
  },

  [BRIDGE_REQUEST_METHODS.experimentalProviderHealth]: (id) => {
    respondResult(id, {
      supported: true,
      health: {
        status: "ready",
        statusMessage: null,
        accountEmail: null,
        planLabel: null,
        installedVersion: "999.0.0",
        minimumSupportedVersion: "1.0.0",
        canInstall: false,
        canUpdate: false,
        loginCommand: null,
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.experimentalProviderUsage]: (id) => {
    respondResult(id, {
      supported: true,
      usage: { status: "ok", accountEmail: null, planLabel: null, windows: [] },
    });
  },

  [BRIDGE_REQUEST_METHODS.experimentalProviderInstallationStatus]: (id) => {
    respondResult(id, {
      executableName: "fake-provider",
      executablePath: "/fake/bin/fake-provider",
      installed: true,
      installSource: "external",
      currentVersion: "999.0.0",
      latestVersion: "999.0.0",
      minimumSupportedVersion: "1.0.0",
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false,
    });
  },

  [BRIDGE_REQUEST_METHODS.experimentalProviderInstallationRun]: (id) => {
    respondResult(id, {
      available: false,
      message: "Fake provider installation is unavailable",
    });
  },

  [BRIDGE_REQUEST_METHODS.skillsConfigure]: (id, params) => {
    const parsed = skillsConfigureParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.skillsConfigure,
        parsed.error.issues,
      );
      return;
    }
    respondResult(id, {});
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
    const options = scriptedOptionsFor(parsed.data.options.providerOptions);
    afterStartDelay(options, () => {
      const session = openSession({
        threadId: parsed.data.threadId,
        providerThreadId: mintProviderThreadId(options, parsed.data.threadId),
        options,
      });
      logProcessStep(`thread/start:${process.pid}:${parsed.data.threadId}`);
      respondResult(id, identityResult(session));
      if (parsed.data.input !== undefined && parsed.data.input.length > 0) {
        beginTurn({ session, input: parsed.data.input });
      }
    });
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
    const options = scriptedOptionsFor(parsed.data.options.providerOptions);
    if (rejectIfArchived(id, options, parsed.data.providerThreadId)) {
      return;
    }
    afterStartDelay(options, () => {
      const session = openSession({
        threadId: parsed.data.threadId,
        providerThreadId: parsed.data.providerThreadId,
        options,
      });
      logProcessStep(
        `thread/resume:${process.pid}:${parsed.data.threadId}:${parsed.data.providerThreadId}`,
      );
      respondResult(id, identityResult(session));
    });
  },

  [BRIDGE_REQUEST_METHODS.threadFork]: (id, params) => {
    const parsed = threadForkParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadFork, parsed.error.issues);
      return;
    }
    const options = scriptedOptionsFor(parsed.data.options.providerOptions);
    if (rejectIfArchived(id, options, parsed.data.sourceProviderThreadId)) {
      return;
    }
    afterStartDelay(options, () => {
      const session = openSession({
        threadId: parsed.data.threadId,
        providerThreadId: mintProviderThreadId(options, parsed.data.threadId),
        options,
      });
      respondResult(id, identityResult(session));
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
      respondError(id, -32000, `Unknown thread: ${parsed.data.threadId}`);
      return;
    }
    session.options = scriptedOptionsFor(parsed.data.options.providerOptions);
    if (rejectIfArchived(id, session.options, session.providerThreadId)) {
      return;
    }
    logProcessStep(
      `turn/start:${process.pid}:${parsed.data.threadId}:${promptText(parsed.data.input)}`,
    );
    respondResult(id, {});
    if (session.options.swallowTurnStart === true) {
      return;
    }
    beginTurn({
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
      respondError(id, -32000, `Unknown thread: ${parsed.data.threadId}`);
      return;
    }
    const options = scriptedOptionsFor(parsed.data.options.providerOptions);
    if (rejectIfArchived(id, options, session.providerThreadId)) {
      return;
    }
    if (session.activeTurn === null) {
      respondError(
        id,
        BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
        `No active turn to steer (expected ${parsed.data.expectedTurnId})`,
      );
      return;
    }
    // The steer is acknowledged into the live turn; the echo answers the
    // original prompt (steer text is consumed, not echoed).
    emitDeltas(session.threadId, [
      {
        kind: "input.accepted",
        clientRequestId: parsed.data.clientRequestId,
        providerTurnId: session.activeTurn.providerTurnId,
      },
    ]);
    respondResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadStop]: (id, params) => {
    const parsed = threadStopParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadStop, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    logProcessStep(`thread/stop:${process.pid}:${parsed.data.threadId}`);
    const stopOptions = session?.options ?? processOptions;
    if (stopOptions.failStopForThreadIds?.includes(parsed.data.threadId)) {
      respondError(id, -32000, `stop refused for ${parsed.data.threadId}`);
      return;
    }
    if (
      session !== undefined &&
      parsed.data.intent === "interrupt" &&
      session.activeTurn !== null
    ) {
      completeTurn(session, "interrupted", "");
    }
    if (parsed.data.intent === "release") {
      sessions.delete(parsed.data.threadId);
    }
    respondResult(id, {});
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
    const options = session?.options ?? processOptions;
    if (options.discardFailsOnce === true && !discardFailed) {
      discardFailed = true;
      respondError(id, -32000, "discard is temporarily unavailable");
      return;
    }
    sessions.delete(parsed.data.threadId);
    respondResult(id, {});
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
    respondResult(id, {});
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
    const session = sessions.get(parsed.data.threadId);
    const options = session?.options ?? processOptions;
    if (options.unarchiveFails === true) {
      respondError(id, -32000, "unarchive is unavailable");
      return;
    }
    unarchivedSessionIds.add(parsed.data.providerThreadId);
    respondResult(id, {});
  },

  [BRIDGE_REQUEST_METHODS.threadNameSet]: (id, params) => {
    const parsed = threadNameSetParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadNameSet,
        parsed.error.issues,
      );
      return;
    }
    respondResult(id, {});
    if (sessions.has(parsed.data.threadId)) {
      emitDeltas(parsed.data.threadId, [
        { kind: "thread.name", name: parsed.data.title },
      ]);
    }
  },

  [BRIDGE_REQUEST_METHODS.threadGoalClear]: (id, params) => {
    const parsed = threadGoalClearParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadGoalClear,
        parsed.error.issues,
      );
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    const options = session?.options ?? processOptions;
    const notifyCleared = (): void => {
      // `thread/goal/clear` models codex's Goal, whose cleared state is the
      // codex plugin's `provider-codex/goal` thread state with a null
      // snapshot — the signal the runtime waits for before it answers.
      emitDeltas(parsed.data.threadId, [
        {
          kind: "extension.state",
          extensionKind: "provider-codex/goal",
          payload: null,
        },
      ]);
    };
    const answer = { cleared: options.goalClearReportsCleared ?? true };
    if (options.goalClearNotifyDelayMs === undefined) {
      // The cleared signal precedes the answer, as codex persists it.
      notifyCleared();
      respondResult(id, answer);
      return;
    }
    respondResult(id, answer);
    setTimeout(notifyCleared, options.goalClearNotifyDelayMs);
  },
};

// ---------------------------------------------------------------------------
// Line handling
// ---------------------------------------------------------------------------

function recordRequest(method: string, params: unknown): void {
  const recordPath = process.env[SCRIPTED_RECORD_PATH_ENV];
  if (recordPath === undefined || recordPath.length === 0) {
    return;
  }
  appendFileSync(
    recordPath,
    `${JSON.stringify({ method, params: params ?? null })}\n`,
  );
}

/** Process-level scripted failures a handler shares. */
function applyScriptedMethodPolicy(
  id: JsonRpcId,
  method: string,
  options: ScriptedEchoOptions,
): "handled" | "continue" {
  const scripted = scriptedMethodSchema.safeParse(method);
  if (!scripted.success) {
    return "continue";
  }
  if (options.crashOn === scripted.data) {
    exitProcess();
  }
  if (options.unsupportedMethods?.includes(scripted.data)) {
    respondError(
      id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
    );
    return "handled";
  }
  const failure = options.failMethods?.find(
    (entry) => entry.method === scripted.data,
  );
  if (failure !== undefined) {
    const failedSoFar = scriptedFailureCounts.get(scripted.data) ?? 0;
    if (failure.times === undefined || failedSoFar < failure.times) {
      scriptedFailureCounts.set(scripted.data, failedSoFar + 1);
      respondError(id, failure.code ?? -32000, failure.message);
      return "handled";
    }
  }
  return "continue";
}

function optionsForRequest(params: unknown): ScriptedEchoOptions {
  const parsed = z
    .object({
      threadId: z.string().optional(),
      options: z
        .object({
          providerOptions: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
    .safeParse(params);
  if (!parsed.success) {
    return processOptions;
  }
  if (parsed.data.options?.providerOptions !== undefined) {
    return scriptedOptionsFor(parsed.data.options.providerOptions);
  }
  const session =
    parsed.data.threadId === undefined
      ? undefined
      : sessions.get(parsed.data.threadId);
  return session?.options ?? processOptions;
}

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
  const { id, method, params, result, error } = message as {
    id?: unknown;
    method?: unknown;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (typeof method !== "string") {
    // A response to one of this bridge's own requests, or noise.
    if (typeof id === "string" || typeof id === "number") {
      handleResponse(id, result, error);
    }
    return;
  }
  if (typeof id !== "string" && typeof id !== "number") {
    return;
  }
  recordRequest(method, params);
  const options = optionsForRequest(params);
  if (applyScriptedMethodPolicy(id, method, options) === "handled") {
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
  if (options.exitAfter === method) {
    exitProcess();
  }
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onSigterm: () => {
    logProcessStep(`exit:${process.pid}`);
    if (processOptions.emitIdentityOnSigterm === true) {
      for (const session of sessions.values()) {
        notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
          threadId: session.threadId,
          providerThreadId: `late-${session.providerThreadId}`,
        });
      }
      setTimeout(() => process.exit(0), 10);
      return;
    }
    process.exit(0);
  },
});
