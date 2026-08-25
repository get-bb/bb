#!/usr/bin/env node

/**
 * Codex provider bridge.
 *
 * Speaks the canonical Provider Bridge Protocol on stdio and supervises
 * `codex app-server` children underneath itself: one child per bb thread
 * (plan decision #5 — process topology is bridge-internal), plus short-lived
 * maintenance children for provider-scoped work (model listing, archive and
 * rename for threads without a live child).
 *
 * Translation lives in `../translator.ts`, `../session-params.ts`, and
 * `../delta-translation.ts`; the bridge emits `thread/delta` semantic deltas
 * and adds the command plane on top:
 *
 * - Codex mints its own turn/item ids and the deltas carry them verbatim as
 *   vouched join keys (`providerTurnId`, `key.providerItemId`); the runtime's
 *   delta assembler mints the bb ids and reverse-maps command-plane ids, so
 *   steer's expectedTurnId and interrupt's activeTurnId arrive here already
 *   provider-native and the bridge does zero id translation. `turn.boundary`
 *   carries the Codex turn id as `providerCheckpointId` on completed and
 *   interrupted turns so checkpoint forks survive bridge and runtime restarts.
 * - Canonical → codex method mapping: `thread/stop {intent: "interrupt"}` →
 *   `turn/interrupt`; `{intent: "release"}` → kill that thread's child (no
 *   fabricated interruption — the rollout stays resumable, #1584);
 *   `thread/discard` → `thread/archive`; a standalone builtin /compact prompt
 *   → `thread/compact/start`; `skills/configure` → `skills/extraRoots/set`.
 * - Codex approval requests are decoded to canonical
 *   `PendingInteractionPayload`s and forwarded as `interaction/request` with
 *   `providerNativeIds: true` (the runtime translates the subject item ids
 *   and turn id onto assembler-minted ids); resolutions map back through the
 *   shared permission mapping.
 */

import {
  isStandaloneBuiltinCompactCommand,
  approvalInteractionOutcomeSchema,
  type DynamicTool,
  type PromptInput,
  type ThreadDelta,
  sanitizeInheritedChildProcessEnv,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  initializeParamsSchema,
  modelListParamsSchema,
  providerInstallationRunParamsSchema,
  providerInstallationStatusParamsSchema,
  providerMaintenanceParamsSchema,
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
  type BridgeExecutionOptions,
  type InitializeResult,
  bridgeRequestEnvelopeSchema,
  createBridgeIo,
  createBridgeLineHandler,
  decodeBridgeJsonRpcResponse,
  runBridgeRequest,
  withoutBridgeRuntimeEnv,
  type BridgeJsonRpcResponse,
  type DecodedInteractiveRequest,
  type PreparedProviderCommandDispatch,
  type ProviderPostInitializeRequest,
  type ProviderRuntimeEvent,
  experimental_defineProviderBridge,
  type ProviderRecoveryHint,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import {
  CODEX_MACOS_PERMISSION_EXTENSION_KIND,
  summarizeCodexMacOsPermissions,
} from "../extension-kinds.js";
import {
  buildCodexInteractiveResponse,
  decodeCodexInteractiveRequest,
  extractCodexMacOsPermissionRequest,
  type CodexMacOsPermissionRequest,
} from "../interactive-requests.js";
import { parseModelsResponse } from "../models.js";
import { macOsPermissionPresentation } from "../presentation.js";
import {
  resolveCodexInstructionOverrides,
  toCodexDynamicTools,
  toCodexPermissionSettings,
  toCodexServiceTier,
  toCodexThreadPermissionSettings,
  toCodexUserInput,
  type BbThreadForkParams,
  type BbThreadStartParams,
  type CodexSessionOptions,
} from "../session-params.js";
import type { ThreadResumeParams } from "../generated/codex-app-server/schema/v2/ThreadResumeParams.js";
import {
  createCodexEventTranslator,
  type CodexEventTranslator,
} from "../translator.js";
import {
  createCodexAppServerConnection,
  CodexAppServerExitedError,
  type CodexAppServerConnection,
  type CodexAppServerExitInfo,
  type CodexAppServerRequestResponder,
} from "./app-server-connection.js";
import {
  getCodexProviderHealth,
  getCodexProviderInstallationRun,
  getCodexProviderInstallationStatus,
  getCodexProviderUsage,
} from "./provider-maintenance.js";

// ---------------------------------------------------------------------------
// Command schema — reply-never-drop (#853)
// ---------------------------------------------------------------------------

const codexBridgeCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: initializeParamsSchema,
  }),
  z.object({ method: z.literal("model/list"), params: modelListParamsSchema }),
  z.object({
    method: z.literal("provider/health"),
    params: providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/usage"),
    params: providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/status"),
    params: providerInstallationStatusParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/run"),
    params: providerInstallationRunParamsSchema,
  }),
  z.object({
    method: z.literal("thread/start"),
    params: threadStartParamsSchema,
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: threadResumeParamsSchema,
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: threadForkParamsSchema,
  }),
  z.object({ method: z.literal("turn/start"), params: turnStartParamsSchema }),
  z.object({ method: z.literal("turn/steer"), params: turnSteerParamsSchema }),
  z.object({
    method: z.literal("thread/stop"),
    params: threadStopParamsSchema,
  }),
  z.object({
    method: z.literal("thread/discard"),
    params: threadDiscardParamsSchema,
  }),
  z.object({
    method: z.literal("thread/name/set"),
    params: threadNameSetParamsSchema,
  }),
  z.object({
    method: z.literal("thread/archive"),
    params: threadArchiveParamsSchema,
  }),
  z.object({
    method: z.literal("thread/unarchive"),
    params: threadUnarchiveParamsSchema,
  }),
  z.object({
    method: z.literal("thread/goal/clear"),
    params: threadGoalClearParamsSchema,
  }),
  z.object({
    method: z.literal("skills/configure"),
    params: skillsConfigureParamsSchema,
  }),
]);

type CodexBridgeCommand = z.infer<typeof codexBridgeCommandSchema>;

const codexBridgeCommandMethodValues = codexBridgeCommandSchema.options.map(
  (option) => option.shape.method.value,
);

type DecodedCodexBridgeRequest =
  | { kind: "request"; request: CodexBridgeCommand & { id: string | number } }
  | { kind: "unknown-method"; id: string | number; method: string }
  | {
      kind: "invalid-params";
      id: string | number;
      method: string;
      issues: string;
    }
  | { kind: "ignored" };

function decodeCodexBridgeJsonRpcRequest(
  raw: unknown,
): DecodedCodexBridgeRequest {
  const envelope = bridgeRequestEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { kind: "ignored" };
  }

  const command = codexBridgeCommandSchema.safeParse({
    method: envelope.data.method,
    params: envelope.data.params ?? {},
  });
  if (command.success) {
    return {
      kind: "request",
      request: { ...command.data, id: envelope.data.id },
    };
  }
  if (
    !(codexBridgeCommandMethodValues as readonly string[]).includes(
      envelope.data.method,
    )
  ) {
    return {
      kind: "unknown-method",
      id: envelope.data.id,
      method: envelope.data.method,
    };
  }
  return {
    kind: "invalid-params",
    id: envelope.data.id,
    method: envelope.data.method,
    issues: command.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  };
}

// ---------------------------------------------------------------------------
// Bridge IO (stdout) and runtime request plumbing
// ---------------------------------------------------------------------------

interface BridgeNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface BridgeRuntimeRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

const { send, sendResult, sendError } = createBridgeIo<
  BridgeNotification | BridgeRuntimeRequest
>();

function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  send({ jsonrpc: "2.0", method, params });
}

const pendingRuntimeRequests = new Map<
  number,
  (response: BridgeJsonRpcResponse) => void
>();
let runtimeRequestIdCounter = 0;

function sendRuntimeRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  runtimeRequestIdCounter += 1;
  const requestId = runtimeRequestIdCounter;
  const responsePromise = new Promise<unknown>(
    (resolveResponse, rejectResponse) => {
      pendingRuntimeRequests.set(requestId, (response) => {
        if ("error" in response) {
          rejectResponse(
            new Error(response.error.message ?? "Runtime request failed"),
          );
          return;
        }
        resolveResponse(response.result);
      });
    },
  );
  send({ jsonrpc: "2.0", id: requestId, method, params });
  return responsePromise;
}

// ---------------------------------------------------------------------------
// App-server child launch
// ---------------------------------------------------------------------------

/** Test seam for the app-server command; production launches `codex app-server`. */
const CODEX_APP_SERVER_COMMAND_ENV = "BB_CODEX_BRIDGE_APP_SERVER_COMMAND";
const CODEX_APP_SERVER_ARGS_ENV = "BB_CODEX_BRIDGE_APP_SERVER_ARGS";

const CODEX_INITIALIZE_PARAMS = {
  clientInfo: { name: "bb", version: "1.0.0", title: null },
  capabilities: { experimentalApi: true },
};

const CHILD_REQUEST_TIMEOUT_MS = 60_000;
/**
 * After `turn/interrupt` is acknowledged, how long the bridge waits for codex
 * to settle the turn (`turn/completed {status: "interrupted"}`) before it
 * settles the turn itself and releases the thread's child anyway.
 */
const INTERRUPT_SETTLEMENT_TIMEOUT_MS = 5_000;
const CODEX_ARCHIVED_SESSION_ERROR_PATTERN =
  /\b(?:session|thread)\s+\S+\s+is archived\b/i;
/**
 * Codex archive/unarchive are not idempotent at the app-server layer:
 * archiving an archived rollout fails with "no rollout found for thread id …"
 * and unarchiving a live one with "no archived rollout found for thread id …".
 * bb's thread/archive and thread/unarchive ask for a final state, so the
 * bridge answers those two failures as success. thread/discard is an archive
 * underneath but keeps its failure: a discard of an unknown rollout stays
 * visible.
 */
const CODEX_ALREADY_ARCHIVED_ERROR_PATTERN =
  /\bno rollout found for thread id\b/i;
const CODEX_NOT_ARCHIVED_ERROR_PATTERN =
  /\bno archived rollout found for thread id\b/i;
/**
 * A brand-new rollout file can exist before its first record is written, and
 * a rename landing in that window fails until codex flushes. The bridge owns
 * this retry: only that error is retried, backing off after each attempt,
 * then one final attempt whose failure propagates as a plain error.
 */
const CODEX_EMPTY_ROLLOUT_RENAME_ERROR_PATTERN = /\brollout at .+ is empty\b/i;
const CODEX_RENAME_RETRY_DELAYS_MS = [50, 200] as const;
/**
 * Terminal account errors. Codex reports most of them with a structured
 * `errorInfo`, but a real `401 Unauthorized: Missing bearer…` can arrive as
 * category `unknown` with the signal only in the text (#130), so the text is
 * the fallback. Both classifications live here, in the bridge that knows
 * codex's wording; the runtime sees only the typed hint.
 */
const CODEX_AUTH_REQUIRED_TEXT_PATTERN =
  /\b(?:40[13]|auth(?:entication|orization)?|unauthori[sz]ed)\b/i;
const CODEX_RATE_LIMITED_TEXT_PATTERN =
  /\b(?:429|credits?|quota|rate[-\s]?limit(?:ed)?|usage limit)\b/i;

function classifyTerminalAccountError(
  delta: Extract<ThreadDelta, { kind: "provider.error" }>,
): "authRequired" | "rateLimited" | null {
  const category = delta.errorInfo?.category;
  if (category === "unauthorized") {
    return "authRequired";
  }
  if (category === "rate-limit") {
    return "rateLimited";
  }
  if (category !== undefined && category !== "unknown") {
    return null;
  }
  const text = [delta.message, delta.detail]
    .filter((part) => part !== undefined)
    .join("\n");
  if (CODEX_AUTH_REQUIRED_TEXT_PATTERN.test(text)) {
    return "authRequired";
  }
  if (CODEX_RATE_LIMITED_TEXT_PATTERN.test(text)) {
    return "rateLimited";
  }
  return null;
}

function archivedSessionHint(message: string): ProviderRecoveryHint | null {
  return CODEX_ARCHIVED_SESSION_ERROR_PATTERN.test(message)
    ? { kind: "sessionArchived", message, retryable: true }
    : null;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
const MISSING_CODEX_CLI_GUIDANCE =
  "bb could not find the Codex CLI on this machine. Install Codex (https://developers.openai.com/codex/cli) or put `codex` on PATH, then retry.";

function resolveAppServerLaunch(): { command: string; args: string[] } {
  const command = process.env[CODEX_APP_SERVER_COMMAND_ENV];
  if (!command) {
    return { command: "codex", args: ["app-server"] };
  }
  const rawArgs = process.env[CODEX_APP_SERVER_ARGS_ENV];
  if (!rawArgs) {
    return { command, args: [] };
  }
  return { command, args: z.array(z.string()).parse(JSON.parse(rawArgs)) };
}

/**
 * Child env is constructed by allowlist: bb runtime-owned vars are stripped
 * (#1366, #1545) and the bridge's own Node-runtime plumbing
 * (ELECTRON_RUN_AS_NODE) is not leaked downward. The bridge's env already
 * carries the daemon's per-environment overlays, so children inherit them.
 */
function buildAppServerEnv(): NodeJS.ProcessEnv {
  return withoutBridgeRuntimeEnv(
    sanitizeInheritedChildProcessEnv({ env: process.env }),
  );
}

function describeCodexLaunchError(error: unknown): string {
  if (error instanceof CodexAppServerExitedError && error.spawnFailed) {
    return MISSING_CODEX_CLI_GUIDANCE;
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface CodexSessionConstruction {
  cwd: string;
  instructionMode: "append" | "replace";
  dynamicTools: DynamicTool[] | undefined;
}

interface CodexBridgeSession {
  bbThreadId: string;
  codexThreadId: string | null;
  serial: number;
  connection: CodexAppServerConnection | null;
  translator: CodexEventTranslator;
  construction: CodexSessionConstruction;
  constructionSignature: string;
  /** Codex-id space; open turns settle as failed if the child dies. */
  openCodexTurnIds: Set<string>;
  /** Resolved when the codex turn's terminal boundary has been emitted. */
  turnSettledWaiters: Map<string, Array<() => void>>;
  /**
   * True from thread/resume or thread/fork construction until this session's
   * first turn/started. Codex replays the rollout's last-turn usage in that
   * window, scoped to a turn this session never started; the bridge must not
   * emit it under a bridge-minted turn id bb has never seen (#1727).
   */
  awaitingReplayedUsage: boolean;
  identityAnnounced: boolean;
  /**
   * Deltas translated before the session's identity is known (codex can emit
   * startup warnings before thread/started). thread/identity must precede
   * every thread/delta for the session, so these flush right after it.
   */
  pendingPreIdentityDeltas: ThreadDelta[];
  /**
   * Set by a terminal account error (401/403/429, quota, credits). The
   * app-server child caches its credentials at startup, so the next turn
   * rebuilds the child from the rollout before it dispatches; that is how an
   * external `codex login` takes effect without a bb restart (#130, moved
   * here from the runtime).
   */
  rebuildBeforeNextTurnReason: string | null;
  closing: boolean;
}

const sessionsByBbThreadId = new Map<string, CodexBridgeSession>();
const maintenanceConnections = new Set<CodexAppServerConnection>();
let modelListConnection: CodexAppServerConnection | null = null;
let modelListConnectionPromise: Promise<CodexAppServerConnection> | null = null;
let sessionSerialCounter = 0;
let configuredSkillExtraRoots: string[] | null = null;

/**
 * Shape of the ids this bridge minted before the narrow-grammar cutover:
 * entropy + session serial + the Codex-native id. Fork checkpoints persisted
 * under that scheme still arrive here, so the fork path strips the prefix
 * structurally; every id minted since IS the raw Codex turn id and passes
 * through unchanged.
 */
const LEGACY_BRIDGE_MINTED_ID_PATTERN = /^bt[0-9a-f]{8}-\d+-/;

function stripLegacyBridgeIdPrefix(id: string): string {
  const match = LEGACY_BRIDGE_MINTED_ID_PATTERN.exec(id);
  return match ? id.slice(match[0].length) : id;
}

function currentSession(
  bbThreadId: string,
  serial: number,
): CodexBridgeSession | undefined {
  const session = sessionsByBbThreadId.get(bbThreadId);
  if (!session || session.serial !== serial || session.closing) {
    return undefined;
  }
  return session;
}

function releaseSession(session: CodexBridgeSession): void {
  session.closing = true;
  if (sessionsByBbThreadId.get(session.bbThreadId) === session) {
    sessionsByBbThreadId.delete(session.bbThreadId);
  }
  session.connection?.kill();
  session.connection = null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const codexProviderOptionsSchema = z
  .object({
    memoryEnabled: z.boolean().optional(),
    providerSubagentsEnabled: z.boolean().optional(),
    /**
     * Environment-level extra write roots. Rides the opaque provider-options
     * bag (packed by the registry) because the canonical wire has no core
     * field for it — same delivery as the ACP launch spec.
     */
    additionalWorkspaceWriteRoots: z.array(z.string()).optional(),
  })
  .passthrough();

interface DecodedCodexOptions {
  sessionOptions: CodexSessionOptions;
  additionalWorkspaceWriteRoots: string[];
}

function decodeCodexOptions(
  options: BridgeExecutionOptions,
): DecodedCodexOptions {
  const decoded = codexProviderOptionsSchema.parse(
    options.providerOptions ?? {},
  );
  return {
    sessionOptions: {
      ...options,
      ...(decoded.memoryEnabled !== undefined
        ? { memoryEnabled: decoded.memoryEnabled }
        : {}),
      ...(decoded.providerSubagentsEnabled !== undefined
        ? { providerSubagentsEnabled: decoded.providerSubagentsEnabled }
        : {}),
    },
    additionalWorkspaceWriteRoots: decoded.additionalWorkspaceWriteRoots ?? [],
  };
}

/**
 * The construction-scoped option facts. A turn arriving with a different set
 * rebuilds the provider session, reported via session/replaced. Compare the
 * effective Codex permissions, not bb's source policy: auto-reviewed user and
 * system turns differ in permissionEscalation (`ask` versus `deny`) but both
 * map to the same Codex construction settings and must keep one session.
 * Model and serviceTier are deliberately absent: they ride every codex
 * turn/start.
 *
 * envVars is deliberately absent too: the runtime builds the shell
 * environment only for session-construction commands and sends
 * `envVars: {}` on every turn/start and turn/steer, so a turn's signature
 * could never match a constructed session's and every first turn would
 * rebuild the session (and fail outright on a fresh thread, whose rollout
 * codex only persists once a turn has run).
 */
function constructionSignature(
  cwd: string,
  sessionOptions: CodexSessionOptions,
): string {
  const permissionSettings = toCodexThreadPermissionSettings(sessionOptions);
  return JSON.stringify({
    cwd,
    reasoningLevel: sessionOptions.reasoningLevel ?? null,
    memoryEnabled: sessionOptions.memoryEnabled ?? null,
    providerSubagentsEnabled: sessionOptions.providerSubagentsEnabled ?? null,
    approvalPolicy: permissionSettings.approvalPolicy,
    approvalsReviewer: permissionSettings.approvalsReviewer,
    sandbox: permissionSettings.sandbox,
  });
}

// ---------------------------------------------------------------------------
// Thread-delta emission
// ---------------------------------------------------------------------------

/**
 * Emit one batched `thread/delta` notification, buffering while the session's
 * identity is unknown (codex can emit startup warnings before thread/started;
 * thread/identity must precede every thread/delta for the session). The
 * bridge also tracks the open codex turns off its own delta stream — the
 * command plane needs them for zero-work gating and child-exit settlement,
 * and it is the one piece of timeline knowledge that cannot live runtime-side
 * (a dead child answers no more events).
 */
function sendThreadDeltas(
  session: CodexBridgeSession,
  deltas: readonly ThreadDelta[],
): void {
  if (deltas.length === 0) {
    return;
  }
  const outDeltas: ThreadDelta[] = [];
  for (const delta of deltas) {
    if (delta.kind === "turn.open") {
      session.awaitingReplayedUsage = false;
      if (delta.providerTurnId !== undefined) {
        session.openCodexTurnIds.add(delta.providerTurnId);
      }
    }
    if (delta.kind === "turn.boundary" && delta.providerTurnId !== undefined) {
      session.openCodexTurnIds.delete(delta.providerTurnId);
      const waiters = session.turnSettledWaiters.get(delta.providerTurnId);
      if (waiters !== undefined) {
        session.turnSettledWaiters.delete(delta.providerTurnId);
        for (const resolve of waiters) {
          resolve();
        }
      }
    }
    // Replayed thread-state snapshot (thread/resume, thread/fork): the turn
    // it names was never started in this session, so its vouched provider
    // turn id would mint a bb turn id unknown to bb and the server would
    // drop the usage as an orphan. Context-window usage is session state and
    // may be thread-scoped; token usage is turn-only and, on resume,
    // duplicates the snapshot bb already persisted for that turn, so drop it
    // (#1727). The fresh session has no current or last turn yet, so the
    // context-window delta, stripped of its vouched turn, assembles
    // thread-scoped.
    if (session.awaitingReplayedUsage) {
      if (delta.kind === "usage") {
        continue;
      }
      if (delta.kind === "contextWindow") {
        const { providerTurnId: _replayedTurnId, ...threadScoped } = delta;
        outDeltas.push(threadScoped);
        continue;
      }
    }
    outDeltas.push(delta);
  }
  if (!session.identityAnnounced) {
    session.pendingPreIdentityDeltas.push(...outDeltas);
    return;
  }
  sendNotification(THREAD_DELTA_NOTIFICATION_METHOD, {
    threadId: session.bbThreadId,
    deltas: outDeltas,
  });
}

function announceSessionIdentity(
  session: CodexBridgeSession,
  codexThreadId: string,
): void {
  if (session.codexThreadId === null) {
    session.codexThreadId = codexThreadId;
  }
  if (session.identityAnnounced) {
    return;
  }
  session.identityAnnounced = true;
  // Identity precedes every thread/delta for the session (ordering rule).
  // Codex rollouts persist on disk, so every session is restorable.
  sendNotification(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: session.bbThreadId,
    providerThreadId: codexThreadId,
    sessionRestorable: true,
  });
  const buffered = session.pendingPreIdentityDeltas;
  session.pendingPreIdentityDeltas = [];
  sendThreadDeltas(session, buffered);
}

// ---------------------------------------------------------------------------
// Child callbacks
// ---------------------------------------------------------------------------

const codexThreadStartedNotificationSchema = z
  .object({ thread: z.object({ id: z.string().min(1) }).passthrough() })
  .passthrough();

function toProviderRuntimeEvent(
  method: string,
  params: unknown,
): ProviderRuntimeEvent {
  // Freeform provider wire traffic; the shared translator narrows by schema.
  return {
    jsonrpc: "2.0",
    method,
    ...(params !== undefined ? { params } : {}),
  } as ProviderRuntimeEvent;
}

function handleChildNotification(
  bbThreadId: string,
  serial: number,
  method: string,
  params: unknown,
): void {
  const session = currentSession(bbThreadId, serial);
  if (!session) {
    // Stale child (replaced or released): its late output must not reach a
    // fresh session (#1402).
    return;
  }
  if (method === "thread/started") {
    const parsed = codexThreadStartedNotificationSchema.safeParse(params);
    if (parsed.success) {
      announceSessionIdentity(session, parsed.data.thread.id);
    }
  }
  const deltas = session.translator.translateEvent(
    toProviderRuntimeEvent(method, params),
  );
  sendThreadDeltas(session, deltas);
  for (const delta of deltas) {
    if (delta.kind === "provider.error" && delta.willRetry !== true) {
      emitTerminalAccountErrorHint(session, delta);
    }
  }
}

/**
 * A terminal account error ends the turn (the `provider.error` delta already
 * carries the row). The typed hint tells the runtime what kind it was, and
 * the session is marked so its next turn rebuilds the child: codex caches
 * credentials per process, and a rebuild is how a re-login takes effect.
 */
function emitTerminalAccountErrorHint(
  session: CodexBridgeSession,
  delta: Extract<ThreadDelta, { kind: "provider.error" }>,
): void {
  const kind = classifyTerminalAccountError(delta);
  if (kind === null) {
    return;
  }
  const message = delta.detail ?? delta.message;
  session.rebuildBeforeNextTurnReason =
    kind === "authRequired"
      ? "codex session restarted after an authentication failure so a new login can take effect."
      : "codex session restarted after a rate limit so a refreshed account state can take effect.";
  // Unsolicited: no runtime request failed here, the child's own turn did.
  sendNotification(BRIDGE_NOTIFICATION_METHODS.providerRecovery, {
    threadId: session.bbThreadId,
    kind,
    message,
    // The turn already failed; nothing is replayed on the hint's account.
    retryable: false,
  });
}

const codexChildToolCallParamsSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.union([z.string().min(1), z.null()]),
  callId: z.string().min(1),
  tool: z.string().min(1),
  arguments: z.unknown(),
});

function handleChildRequest(
  bbThreadId: string,
  serial: number,
  method: string,
  params: unknown,
  responder: CodexAppServerRequestResponder,
): void {
  const session = currentSession(bbThreadId, serial);
  if (!session) {
    responder.error(
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      "codex session is no longer current",
    );
    return;
  }

  if (method === BRIDGE_INBOUND_REQUEST_METHODS.toolCall) {
    const parsed = codexChildToolCallParamsSchema.safeParse(params);
    if (!parsed.success) {
      responder.error(
        BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
        `Invalid codex tool call params: ${parsed.error.message}`,
      );
      return;
    }
    void sendRuntimeRequest(BRIDGE_INBOUND_REQUEST_METHODS.toolCall, {
      providerThreadId: session.codexThreadId ?? parsed.data.threadId,
      threadId: session.bbThreadId,
      // Codex-native ids: the runtime adapter translates them through the
      // delta assembler's maps (providerNativeIds below).
      turnId: parsed.data.turnId,
      callId: parsed.data.callId,
      tool: parsed.data.tool,
      arguments: parsed.data.arguments ?? {},
      providerNativeIds: true,
    })
      .then((result) => {
        // The canonical tool-call result shape is codex's native response
        // shape ({success, contentItems}); pass it through verbatim.
        responder.result(result);
      })
      .catch((error: unknown) => {
        responder.error(
          BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
          error instanceof Error ? error.message : String(error),
        );
      });
    return;
  }

  // A macOS permission profile on a command approval is codex vocabulary
  // bb's permission layer cannot grant: it goes on the timeline as its own
  // row (`provider-codex/macos-permission`) and the approval proceeds for
  // the command itself.
  const macOsPermission = extractCodexMacOsPermissionRequest({
    id: 0,
    method,
    params,
  });
  if (macOsPermission !== null) {
    sendThreadDeltas(session, [buildMacOsPermissionItemDelta(macOsPermission)]);
  }

  let decoded: DecodedInteractiveRequest | null;
  try {
    decoded = decodeCodexInteractiveRequest({ id: 0, method, params });
  } catch (error) {
    responder.error(
      BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  if (decoded === null) {
    responder.error(
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Unhandled codex request "${method}"`,
    );
    return;
  }
  const request = decoded;

  void sendRuntimeRequest(BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest, {
    providerThreadId: session.codexThreadId ?? request.providerThreadId,
    threadId: session.bbThreadId,
    // Codex-native ids: the runtime adapter translates the turn id and the
    // approval subject's item id through the delta assembler's maps.
    turnId: request.turnId,
    payload: request.payload,
    providerNativeIds: true,
  })
    .then((result) => {
      // The resolution is parsed against the payload it answers: Codex raises
      // approvals only, so the pair is an approval outcome or a wire error.
      const outcome = approvalInteractionOutcomeSchema.parse({
        payload: request.payload,
        resolution: result,
      });
      responder.result(buildCodexInteractiveResponse(outcome));
    })
    .catch((error: unknown) => {
      responder.error(
        BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
        error instanceof Error ? error.message : String(error),
      );
    });
}

/**
 * The `provider-codex/macos-permission` row for a command approval that asked
 * for macOS capabilities. Keyed by the approval's codex item id under its own
 * channel, so a re-asked approval for the same command reuses the row.
 */
function buildMacOsPermissionItemDelta(
  request: CodexMacOsPermissionRequest,
): ThreadDelta {
  return {
    kind: "item.close",
    key: {
      providerItemId: `${request.item.approvalItemId}:macos-permission`,
    },
    status: "completed",
    item: {
      type: "extension",
      kind: CODEX_MACOS_PERMISSION_EXTENSION_KIND,
      payload: request.item,
    },
    presentation: macOsPermissionPresentation(
      summarizeCodexMacOsPermissions(request.item.permissions),
    ),
    providerTurnId: request.turnId,
  };
}

function handleChildExit(
  bbThreadId: string,
  serial: number,
  info: CodexAppServerExitInfo,
): void {
  const session = currentSession(bbThreadId, serial);
  if (!session) {
    return;
  }
  session.connection = null;

  // Unexpected death with in-flight work: every accepted turn must reach a
  // terminal state, so settle open turns as failed before reporting. The
  // boundaries ride keyed turn.boundary deltas — the bridge owns the
  // open-turn set anyway for the zero-work gate, and the generic
  // session-ended settlement would add item completions codex never emitted
  // here (and settles turns as interrupted, not failed).
  const openTurnIds = [...session.openCodexTurnIds];
  const message = `codex app-server exited unexpectedly (code ${info.code ?? "null"}, signal ${info.signal ?? "null"})${info.stderrTail ? `: ${info.stderrTail}` : ""}`;
  sendThreadDeltas(
    session,
    openTurnIds.map((codexTurnId) => ({
      kind: "turn.boundary",
      providerTurnId: codexTurnId,
      status: "failed",
      error: { message },
    })),
  );
  session.openCodexTurnIds.clear();
  sendNotification(BRIDGE_NOTIFICATION_METHODS.error, {
    threadId: session.bbThreadId,
    ...(session.codexThreadId !== null
      ? { providerThreadId: session.codexThreadId }
      : {}),
    message,
  });
  // Nothing runs behind a dead child, so drop its live state and settle every
  // delegation it still had open as failed: open delegations are open work
  // for the runtime's reaper, and without the closes the thread would never
  // be idle-reaped.
  if (session.codexThreadId !== null) {
    sendThreadDeltas(
      session,
      session.translator.clearExitedChildThreadState({
        providerThreadId: session.codexThreadId,
      }),
    );
  }
  // The session entry stays (with its identity) so the next turn/start can
  // restore the thread from its rollout via session/replaced.
}

// ---------------------------------------------------------------------------
// Child construction
// ---------------------------------------------------------------------------

function spawnChildConnection(callbacks: {
  /** The bb thread the child serves (record-mode scope); null when none. */
  recordThreadId: string | null;
  onNotification: (method: string, params: unknown) => void;
  onRequest: (
    method: string,
    params: unknown,
    responder: CodexAppServerRequestResponder,
  ) => void;
  onExit: (info: CodexAppServerExitInfo) => void;
}): CodexAppServerConnection {
  const launch = resolveAppServerLaunch();
  return createCodexAppServerConnection({
    command: launch.command,
    args: launch.args,
    cwd: process.cwd(),
    env: buildAppServerEnv(),
    ...callbacks,
  });
}

const ignoredChildResultSchema = z.unknown();

async function initializeChild(
  connection: CodexAppServerConnection,
  postInitializeRequests?: readonly ProviderPostInitializeRequest[],
): Promise<void> {
  await connection.request({
    method: "initialize",
    params: CODEX_INITIALIZE_PARAMS,
    resultSchema: ignoredChildResultSchema,
    timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
  });
  for (const request of postInitializeRequests ?? []) {
    try {
      const result = await connection.request({
        method: request.plan.method,
        ...("params" in request.plan && request.plan.params !== undefined
          ? { params: request.plan.params }
          : {}),
        resultSchema: ignoredChildResultSchema,
        timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
      });
      request.onResult(result);
    } catch (error) {
      if (request.required) {
        throw error;
      }
    }
  }
  if (configuredSkillExtraRoots !== null) {
    await connection.request({
      method: "skills/extraRoots/set",
      params: { extraRoots: configuredSkillExtraRoots },
      resultSchema: ignoredChildResultSchema,
      timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
    });
  }
}

const codexThreadIdentityResultSchema = z
  .object({ thread: z.object({ id: z.string().min(1) }).passthrough() })
  .passthrough();

type CodexSessionConstructionRequest =
  | { kind: "start" }
  | { kind: "resume"; providerThreadId: string }
  | {
      kind: "fork";
      sourceProviderThreadId: string;
      sourceProviderCheckpointId?: string;
    };

interface ConstructThreadSessionArgs {
  threadId: string;
  cwd: string;
  options: BridgeExecutionOptions;
  instructionMode: "append" | "replace";
  dynamicTools?: DynamicTool[];
  request: CodexSessionConstructionRequest;
}

interface ConstructedCodexSession {
  session: CodexBridgeSession;
  codexThreadId: string;
}

async function constructThreadSession(
  args: ConstructThreadSessionArgs,
): Promise<ConstructedCodexSession> {
  const existing = sessionsByBbThreadId.get(args.threadId);
  if (existing) {
    releaseSession(existing);
  }

  const decoded = decodeCodexOptions(args.options);
  sessionSerialCounter += 1;
  const serial = sessionSerialCounter;
  const translator = createCodexEventTranslator({
    additionalWorkspaceWriteRoots: decoded.additionalWorkspaceWriteRoots,
  });
  translator.configureInjectedTools(
    (args.dynamicTools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.presentation === undefined
        ? {}
        : { presentation: tool.presentation }),
    })),
  );
  const session: CodexBridgeSession = {
    bbThreadId: args.threadId,
    codexThreadId:
      args.request.kind === "resume" ? args.request.providerThreadId : null,
    serial,
    connection: null,
    translator,
    construction: {
      cwd: args.cwd,
      instructionMode: args.instructionMode,
      dynamicTools: args.dynamicTools,
    },
    constructionSignature: constructionSignature(
      args.cwd,
      decoded.sessionOptions,
    ),
    openCodexTurnIds: new Set(),
    turnSettledWaiters: new Map(),
    awaitingReplayedUsage: args.request.kind !== "start",
    identityAnnounced: false,
    pendingPreIdentityDeltas: [],
    rebuildBeforeNextTurnReason: null,
    closing: false,
  };
  sessionsByBbThreadId.set(args.threadId, session);
  if (args.request.kind === "resume") {
    // The provider identity is already known for a resume; announcing before
    // the child speaks keeps identity ahead of any startup notification.
    announceSessionIdentity(session, args.request.providerThreadId);
  }
  // A fresh provider session may reuse codex-native turn/item ids (a resumed
  // rollout, a restarted child): reset the assembler's id space for the
  // thread before any of the new session's deltas. Buffered pre-identity for
  // start/fork, so it still lands first.
  sendThreadDeltas(session, [{ kind: "session.reset" }]);

  const connection = spawnChildConnection({
    recordThreadId: args.threadId,
    onNotification: (method, params) =>
      handleChildNotification(args.threadId, serial, method, params),
    onRequest: (method, params, responder) =>
      handleChildRequest(args.threadId, serial, method, params, responder),
    onExit: (info) => handleChildExit(args.threadId, serial, info),
  });
  session.connection = connection;

  try {
    await initializeChild(connection, translator.buildPostInitializeRequests());

    const preparedGitRoots = translator.prepareWorkspaceWriteGitRoots({
      command: {
        threadId: args.threadId,
        cwd: args.cwd,
        options: decoded.sessionOptions,
      },
    });
    const dynamicTools = toCodexDynamicTools(args.dynamicTools);
    const instructionOverrides = resolveCodexInstructionOverrides({
      instructionMode: args.instructionMode,
      options: decoded.sessionOptions,
    });
    const sharedConstructionParams = {
      approvalPolicy: preparedGitRoots.permissionSettings.approvalPolicy,
      approvalsReviewer: preparedGitRoots.permissionSettings.approvalsReviewer,
      sandbox: preparedGitRoots.permissionSettings.sandbox,
      cwd: args.cwd,
      ...instructionOverrides,
      model: decoded.sessionOptions.model ?? undefined,
      serviceTier: toCodexServiceTier(decoded.sessionOptions.serviceTier),
      config: preparedGitRoots.config ?? undefined,
      ...(dynamicTools && dynamicTools.length > 0 ? { dynamicTools } : {}),
    };

    let method: string;
    let params: BbThreadStartParams | ThreadResumeParams | BbThreadForkParams;
    switch (args.request.kind) {
      case "start": {
        method = "thread/start";
        const startParams: BbThreadStartParams = {
          ...sharedConstructionParams,
          // bb releases idle sessions and later resumes by provider thread
          // id, so the rollout must exist on disk. Codex already defaults to
          // non-ephemeral; pin the value so a future default flip cannot
          // silently break resume.
          ephemeral: false,
          // Codex only exposes raw Responses items as a thread/start opt-in.
          experimentalRawEvents: true,
        };
        params = startParams;
        break;
      }
      case "resume": {
        method = "thread/resume";
        const resumeParams: ThreadResumeParams = {
          threadId: args.request.providerThreadId,
          ...sharedConstructionParams,
        };
        params = resumeParams;
        break;
      }
      case "fork": {
        method = "thread/fork";
        const forkParams: BbThreadForkParams = {
          threadId: args.request.sourceProviderThreadId,
          ...(args.request.sourceProviderCheckpointId !== undefined
            ? {
                // Checkpoints reaching a codex bridge are raw Codex turn ids
                // (turn.boundary stamps them natively) or legacy bridge-minted
                // ids persisted before the narrow-grammar cutover (strip to
                // the Codex turn id) — codex thread/fork takes the Codex turn
                // id as lastTurnId either way.
                lastTurnId: stripLegacyBridgeIdPrefix(
                  args.request.sourceProviderCheckpointId,
                ),
              }
            : {}),
          ...sharedConstructionParams,
        };
        params = forkParams;
        break;
      }
    }

    const result = await connection.request({
      method,
      params,
      resultSchema: codexThreadIdentityResultSchema,
      timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
    });
    const codexThreadId = result.thread.id;
    session.codexThreadId = codexThreadId;
    translator.activateThreadGitWritableRoots({
      providerThreadId: codexThreadId,
      threadId: args.threadId,
    });
    announceSessionIdentity(session, codexThreadId);
    return { session, codexThreadId };
  } catch (error) {
    // `closing` already set here means a thread/stop released the session
    // mid-construction (and killed the child), which is why it failed.
    const released = session.closing;
    if (sessionsByBbThreadId.get(args.threadId) === session) {
      sessionsByBbThreadId.delete(args.threadId);
    }
    session.closing = true;
    connection.kill();
    throw released ? new CodexSessionReleasedError(error) : error;
  }
}

/**
 * A session construction that failed because the thread was released while
 * it ran. The runtime holds nothing for the thread after a release, so a
 * caller that would otherwise keep the thread resumable must not.
 */
class CodexSessionReleasedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "CodexSessionReleasedError";
  }
}

/**
 * Keep a thread resumable after a rebuild failed to construct its
 * replacement. The failed construction dropped the thread's only session
 * entry, but the rollout on disk is still the thread's session — an archived
 * one is exactly what the `sessionArchived` hint asks the runtime to
 * unarchive before it retries — so the thread gets a connection-less entry
 * the retried turn rebuilds from, the same way a turn after the child died
 * does. A fresh serial keeps the dead child's exit from reaching it.
 */
function registerResumableSession(session: CodexBridgeSession): void {
  if (
    session.codexThreadId === null ||
    sessionsByBbThreadId.has(session.bbThreadId)
  ) {
    return;
  }
  sessionSerialCounter += 1;
  sessionsByBbThreadId.set(session.bbThreadId, {
    bbThreadId: session.bbThreadId,
    codexThreadId: session.codexThreadId,
    serial: sessionSerialCounter,
    connection: null,
    translator: session.translator,
    construction: session.construction,
    constructionSignature: session.constructionSignature,
    openCodexTurnIds: new Set(),
    turnSettledWaiters: new Map(),
    awaitingReplayedUsage: true,
    identityAnnounced: session.identityAnnounced,
    pendingPreIdentityDeltas: [],
    rebuildBeforeNextTurnReason: null,
    closing: false,
  });
}

/**
 * Rebuild a live session's provider side (execution-option change codex
 * cannot apply in place, or recovery after the child died). Never silent:
 * the replacement is announced via session/replaced (#1268). There is no
 * in-flight turn at any rebuild site, so no settlement events are owed.
 */
async function rebuildThreadSession(
  session: CodexBridgeSession,
  options: BridgeExecutionOptions,
  reason: string,
): Promise<CodexBridgeSession> {
  const codexThreadId = session.codexThreadId;
  if (codexThreadId === null) {
    throw new Error(
      "codex session has no provider thread id to restore from its rollout",
    );
  }
  let replacement: ConstructedCodexSession;
  try {
    replacement = await constructThreadSession({
      threadId: session.bbThreadId,
      cwd: session.construction.cwd,
      options,
      instructionMode: session.construction.instructionMode,
      ...(session.construction.dynamicTools !== undefined
        ? { dynamicTools: session.construction.dynamicTools }
        : {}),
      request: { kind: "resume", providerThreadId: codexThreadId },
    });
  } catch (error) {
    // The thread still has its rollout; only a release ends its session.
    if (!(error instanceof CodexSessionReleasedError)) {
      registerResumableSession(session);
    }
    throw error;
  }
  sendNotification(BRIDGE_NOTIFICATION_METHODS.sessionReplaced, {
    threadId: replacement.session.bbThreadId,
    providerThreadId: replacement.codexThreadId,
    reason,
    contextLost: false,
  });
  return replacement.session;
}

// ---------------------------------------------------------------------------
// Maintenance children (thread ops without a live child; reusable model list)
// ---------------------------------------------------------------------------

/**
 * Run one request against a one-shot app-server. Thread-scoped maintenance
 * uses the thread's live child when one exists (the rollout is open there);
 * archive/rename after release are rare enough that spawning here remains the
 * simpler trade.
 */
async function withMaintenanceChild<T>(
  fn: (connection: CodexAppServerConnection) => Promise<T>,
): Promise<T> {
  const connection = spawnChildConnection({
    recordThreadId: null,
    onNotification: () => {},
    onRequest: (_method, _params, responder) => {
      responder.error(
        BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        "maintenance codex app-server does not serve requests",
      );
    },
    onExit: () => {},
  });
  maintenanceConnections.add(connection);
  try {
    await initializeChild(connection);
    return await fn(connection);
  } finally {
    maintenanceConnections.delete(connection);
    connection.kill();
  }
}

/**
 * Lazily initialize and retain the app-server used for model catalogs. The
 * host daemon already retains one bridge runtime for model listing, so keeping
 * its child alive restores the pre-plugin behavior: later picker refreshes ask
 * an initialized process instead of paying process startup on every request.
 * A concurrent cold lookup shares the same initialization promise, and an
 * exited child is replaced by the next lookup.
 */
async function getModelListConnection(): Promise<CodexAppServerConnection> {
  if (modelListConnection !== null && !modelListConnection.exited) {
    return modelListConnection;
  }
  if (modelListConnectionPromise !== null) {
    return modelListConnectionPromise;
  }

  const connectionPromise = (async () => {
    const connection = spawnChildConnection({
      recordThreadId: null,
      onNotification: () => {},
      onRequest: (_method, _params, responder) => {
        responder.error(
          BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          "model-list codex app-server does not serve requests",
        );
      },
      onExit: () => {
        maintenanceConnections.delete(connection);
        if (modelListConnection === connection) {
          modelListConnection = null;
        }
      },
    });
    maintenanceConnections.add(connection);
    try {
      await initializeChild(connection);
      modelListConnection = connection;
      return connection;
    } catch (error) {
      maintenanceConnections.delete(connection);
      connection.kill();
      throw error;
    }
  })();
  modelListConnectionPromise = connectionPromise;
  try {
    return await connectionPromise;
  } finally {
    if (modelListConnectionPromise === connectionPromise) {
      modelListConnectionPromise = null;
    }
  }
}

/**
 * Retire a cached model-list child after a request-level failure. A timeout or
 * malformed response does not make the connection report `exited`, but it is
 * no longer safe to reuse: a later picker refresh must get a fresh process.
 */
function retireModelListConnection(connection: CodexAppServerConnection): void {
  maintenanceConnections.delete(connection);
  if (modelListConnection === connection) {
    modelListConnection = null;
  }
  connection.kill();
}

async function withChildForThread<T>(
  bbThreadId: string,
  fn: (connection: CodexAppServerConnection) => Promise<T>,
): Promise<T> {
  const session = sessionsByBbThreadId.get(bbThreadId);
  if (
    session &&
    !session.closing &&
    session.connection !== null &&
    !session.connection.exited
  ) {
    return fn(session.connection);
  }
  return withMaintenanceChild(fn);
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

type ThreadStartParamsShape = z.infer<typeof threadStartParamsSchema>;
type TurnStartParamsShape = z.infer<typeof turnStartParamsSchema>;
type TurnSteerParamsShape = z.infer<typeof turnSteerParamsSchema>;
type ThreadStopParamsShape = z.infer<typeof threadStopParamsSchema>;

function handleInitialize(id: string | number): void {
  // Session-behavior facts, each backed by the codex methods this bridge
  // implements: sessionRestore — rollouts persist and thread/resume reopens
  // them; threadArchive/threadRename — codex thread/archive|unarchive and
  // thread/name/set; threadGoalClear — thread/goal/clear;
  // fork "checkpoint" — thread/fork accepts lastTurnId;
  // approvalEnforcedBy "runtime" — codex forwards every approval and the
  // runtime applies thread policy.
  // Typed so a capability rename cannot silently degrade this bridge: an
  // unrenamed key would be missing from InitializeResult, not defaulted false.
  const result: InitializeResult = {
    protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
    capabilities: {
      sessionRestore: true,
      threadArchive: true,
      threadRename: true,
      threadGoalClear: true,
      fork: "checkpoint",
      approvalEnforcedBy: "runtime",
      // grammarVersions [3, 3] — this bridge emits the v3 delta grammar (one
      // streaming dialect, one usage dialect; the v3 item shapes land per
      // bridge in WS1b). steerMode "inject" — codex `turn/steer` injects into
      // the live turn natively.
      grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
      steerMode: "inject",
      skills: { configure: true },
    },
  };
  sendResult(id, result);
}

async function handleModelList(id: string | number): Promise<void> {
  let connection: CodexAppServerConnection | null = null;
  try {
    connection = await getModelListConnection();
    const result = await connection.request({
      method: "model/list",
      params: {},
      resultSchema: ignoredChildResultSchema,
      timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
    });
    // Codex's upstream API only exposes an active model list; legacy/retired
    // models aren't surfaced separately, so selectedOnlyModels is always
    // empty.
    sendResult(id, {
      models: parseModelsResponse(result),
      selectedOnlyModels: [],
    });
  } catch (error) {
    if (connection !== null) {
      retireModelListConnection(connection);
    }
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      describeCodexLaunchError(error),
    );
  }
}

function sendConstructionError(
  id: string | number,
  error: unknown,
  resumable: boolean,
): void {
  const message = describeCodexLaunchError(error);
  // An archived session carries the `sessionArchived` hint on the error: the
  // runtime unarchives the session (a fork's source, on a fork) and retries
  // the construction once. A resume additionally gets the typed
  // SESSION_NOT_RESTORABLE code. The original text is preserved for the
  // user-visible failure when that recovery cannot run.
  const recovery = archivedSessionHint(message);
  sendError(
    id,
    resumable && recovery !== null
      ? BRIDGE_JSON_RPC_ERRORS.SESSION_NOT_RESTORABLE
      : BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
    message,
    recovery === null ? undefined : { recovery },
  );
}

/**
 * The one session-construction path. `resumable` is the only thing that
 * differs on failure: a resume that fails can be retried against the same
 * rollout, a start or fork cannot.
 */
async function handleThreadConstruction(
  id: string | number,
  params: ThreadStartParamsShape,
  request: CodexSessionConstructionRequest,
): Promise<void> {
  try {
    const constructed = await constructThreadSession({
      threadId: params.threadId,
      cwd: params.cwd,
      options: params.options,
      instructionMode: params.instructionMode,
      ...(params.dynamicTools !== undefined
        ? { dynamicTools: params.dynamicTools }
        : {}),
      request,
    });
    sendResult(id, {
      providerThreadId: constructed.codexThreadId,
      sessionRestorable: true,
    });
  } catch (error) {
    sendConstructionError(id, error, request.kind === "resume");
  }
}

interface LiveSessionForTurn {
  session: CodexBridgeSession;
  connection: CodexAppServerConnection;
}

/**
 * Resolve a live session for a turn command, reconciling execution options
 * first: a construction-scoped change (or a dead child) rebuilds the provider
 * session from its rollout with a session/replaced report. The request
 * dispatch and the child's event stream live in the same loop here, so the
 * turn-start correlation queue is populated before the request is written —
 * codex can emit turn/started before its turn/start response settles.
 */
async function requireLiveSessionForTurn(
  params: TurnStartParamsShape,
): Promise<LiveSessionForTurn> {
  let session = sessionsByBbThreadId.get(params.threadId);
  if (!session || session.closing) {
    throw new Error(`No active codex session for thread "${params.threadId}"`);
  }

  const decoded = decodeCodexOptions(params.options);
  const signature = constructionSignature(
    session.construction.cwd,
    decoded.sessionOptions,
  );
  if (session.connection === null || session.connection.exited) {
    session = await rebuildThreadSession(
      session,
      params.options,
      "codex app-server exited; the session was restored from its rollout.",
    );
  } else if (session.rebuildBeforeNextTurnReason !== null) {
    session = await rebuildThreadSession(
      session,
      params.options,
      session.rebuildBeforeNextTurnReason,
    );
  } else if (signature !== session.constructionSignature) {
    session = await rebuildThreadSession(
      session,
      params.options,
      "Execution settings changed; the codex session was rebuilt to apply them.",
    );
  }
  if (session.connection === null) {
    throw new Error(`No active codex session for thread "${params.threadId}"`);
  }
  return { session, connection: session.connection };
}

/**
 * How long after a dispatch is answered the zero-work settlement decision
 * waits. Codex emits `turn/started` before it answers `turn/start`
 * (68d80092f — the reason `prepareTurnStart` queues the correlation before
 * dispatch), so a dispatch still unclaimed when its answer arrives already
 * means the provider opened no turn for it. The window is insurance against a
 * reordered stream: a `turn/started` that lands inside it claims the dispatch
 * first and the real turn wins.
 */
const ZERO_WORK_SETTLEMENT_GRACE_MS = 250;

let syntheticZeroWorkTurnCounter = 0;

/**
 * Settle a prompt the app-server accepted and finished without opening a turn
 * (#1431's shape): a zero-work prompt, or a `thread/compact/start` dispatch
 * the provider answers without turn activity. Nothing in the child's output
 * can start or settle a bb turn for it, so the bb turn would never settle and
 * the thread would stay active forever.
 *
 * Ownership is proved, never guessed (the ACP bug 0c2f4cc9a fabricated turns
 * from late signals): the only dispatch settled here is the queued turn-start
 * correlation this call created, and only while `claim()` shows no
 * `turn/started` (or `turn/completed`, which clears the thread's queue) has
 * consumed it. A session that has any open codex turn is left alone as well —
 * a real turn is running and owns the settlement.
 */
function scheduleZeroWorkTurnSettlement(args: {
  clientRequestId: TurnStartParamsShape["clientRequestId"];
  prepared: PreparedProviderCommandDispatch | null;
  session: CodexBridgeSession;
}): void {
  const { clientRequestId, prepared, session } = args;
  if (prepared === null) {
    return;
  }
  const serial = session.serial;
  const timer = setTimeout(() => {
    const live = currentSession(session.bbThreadId, serial);
    if (!live || live.openCodexTurnIds.size > 0) {
      return;
    }
    if (!prepared.claim()) {
      return;
    }
    syntheticZeroWorkTurnCounter += 1;
    const providerTurnId = `zero-work-${syntheticZeroWorkTurnCounter}`;
    // Canonical terminal shape: the turn opens, the input that started it is
    // acknowledged against that turn, and it settles. No providerCheckpointId
    // — a synthetic turn is not a codex fork point.
    sendThreadDeltas(live, [
      { kind: "turn.open", providerTurnId },
      { kind: "input.accepted", clientRequestId, providerTurnId },
      { kind: "turn.boundary", providerTurnId, status: "completed" },
    ]);
  }, ZERO_WORK_SETTLEMENT_GRACE_MS);
  timer.unref?.();
}

async function handleTurnStart(
  id: string | number,
  params: TurnStartParamsShape,
): Promise<void> {
  let live: LiveSessionForTurn;
  try {
    live = await requireLiveSessionForTurn(params);
  } catch (error) {
    // A rebuild resumes the rollout, so an archived session surfaces here
    // with the same typed hint a thread/resume would carry.
    rejectWithCodexError(id, error);
    return;
  }
  const { session, connection } = live;
  const codexThreadId = session.codexThreadId;
  if (codexThreadId === null) {
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      `No provider thread identity for thread "${params.threadId}"`,
    );
    return;
  }

  const input: PromptInput[] = params.input;
  const decoded = decodeCodexOptions(params.options);

  // Queue before dispatch: codex emits turn/started (which drains this
  // queue into turn/input/accepted) before the turn/start response settles.
  const prepared = session.translator.prepareTurnStart({
    clientRequestId: params.clientRequestId,
    providerThreadId: codexThreadId,
  });

  try {
    if (isStandaloneBuiltinCompactCommand(input)) {
      await connection.request({
        method: "thread/compact/start",
        params: { threadId: codexThreadId },
        resultSchema: ignoredChildResultSchema,
        timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
      });
    } else {
      const permissionSettings = toCodexPermissionSettings({
        additionalWorkspaceWriteRoots: decoded.additionalWorkspaceWriteRoots,
        gitWritableRoots: session.translator.getThreadGitWritableRoots(
          params.threadId,
        ),
        options: decoded.sessionOptions,
      });
      await connection.request({
        method: "turn/start",
        params: {
          threadId: codexThreadId,
          input: toCodexUserInput(input),
          approvalPolicy: permissionSettings.approvalPolicy,
          approvalsReviewer: permissionSettings.approvalsReviewer,
          sandboxPolicy: permissionSettings.sandboxPolicy,
          model: decoded.sessionOptions.model ?? undefined,
          serviceTier: toCodexServiceTier(decoded.sessionOptions.serviceTier),
        },
        resultSchema: ignoredChildResultSchema,
        timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
      });
    }
    sendResult(id, { threadId: params.threadId });
    scheduleZeroWorkTurnSettlement({
      clientRequestId: params.clientRequestId,
      prepared,
      session,
    });
  } catch (error) {
    prepared?.rollback();
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleTurnSteer(
  id: string | number,
  params: TurnSteerParamsShape,
): Promise<void> {
  const session = sessionsByBbThreadId.get(params.threadId);
  if (
    !session ||
    session.closing ||
    session.connection === null ||
    session.connection.exited ||
    session.codexThreadId === null
  ) {
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      `No active codex session for thread "${params.threadId}"`,
    );
    return;
  }
  try {
    await session.connection.request({
      method: "turn/steer",
      params: {
        // The runtime reverse-maps expectedTurnId to the codex-native turn id
        // before dispatch (assembler-owned bidirectional maps).
        threadId: session.codexThreadId,
        expectedTurnId: params.expectedTurnId,
        input: toCodexUserInput(params.input),
      },
      resultSchema: ignoredChildResultSchema,
      timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
    });
    // A steer joins the active turn; codex accepted it against the expected
    // turn, so the acceptance is emitted against that vouched turn.
    sendThreadDeltas(session, [
      {
        kind: "input.accepted",
        clientRequestId: params.clientRequestId,
        providerTurnId: params.expectedTurnId,
      },
    ]);
    sendResult(id, { threadId: params.threadId });
  } catch (error) {
    rejectWithCodexError(id, error);
  }
}

async function handleThreadStop(
  id: string | number,
  params: ThreadStopParamsShape,
): Promise<void> {
  const session = sessionsByBbThreadId.get(params.threadId);

  if (params.intent === "release") {
    // Release detaches the idle session: kill that thread's app-server child
    // and nothing else. No fabricated interruption (#1584); the rollout on
    // disk keeps the session resumable.
    if (session) {
      releaseSession(session);
    }
    sendResult(id, { ok: true });
    return;
  }

  if (
    !session ||
    session.closing ||
    session.connection === null ||
    session.connection.exited ||
    session.codexThreadId === null ||
    params.activeTurnId === null
  ) {
    // Nothing to interrupt: an interrupt with no active turn is a noop.
    sendResult(id, { ok: true });
    return;
  }

  try {
    await session.connection.request({
      method: "turn/interrupt",
      params: {
        // Reverse-mapped runtime-side, like steer's expectedTurnId.
        threadId: session.codexThreadId,
        turnId: params.activeTurnId,
      },
      resultSchema: ignoredChildResultSchema,
      timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  // Settlement arrives from the child's own stream: codex emits
  // turn/completed {status: "interrupted"} for the interrupted turn. The
  // runtime detaches the thread once this request is answered, so the
  // boundary must be on the wire first; a child that never settles gets the
  // boundary from the bridge.
  const settled = await waitForCodexTurnSettlement(
    session,
    params.activeTurnId,
    INTERRUPT_SETTLEMENT_TIMEOUT_MS,
  );
  if (!settled) {
    sendThreadDeltas(session, [
      {
        kind: "turn.boundary",
        providerTurnId: params.activeTurnId,
        status: "interrupted",
      },
    ]);
  }
  // Protocol rule: after thread/stop the runtime holds nothing for the
  // thread, so neither may the bridge. Open delegations die with the child
  // and are settled first (they are open work for the runtime's reaper);
  // the rollout on disk keeps the session resumable.
  sendThreadDeltas(
    session,
    session.translator.clearExitedChildThreadState({
      providerThreadId: session.codexThreadId,
    }),
  );
  releaseSession(session);
  sendResult(id, { ok: true });
}

/** Resolves true once the turn's boundary has gone out, false on timeout. */
function waitForCodexTurnSettlement(
  session: CodexBridgeSession,
  codexTurnId: string,
  timeoutMs: number,
): Promise<boolean> {
  if (!session.openCodexTurnIds.has(codexTurnId)) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const waiters = session.turnSettledWaiters.get(codexTurnId);
      if (waiters !== undefined) {
        session.turnSettledWaiters.set(
          codexTurnId,
          waiters.filter((waiter) => waiter !== onSettled),
        );
      }
      resolve(false);
    }, timeoutMs);
    timer.unref?.();
    const onSettled = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const waiters = session.turnSettledWaiters.get(codexTurnId) ?? [];
    waiters.push(onSettled);
    session.turnSettledWaiters.set(codexTurnId, waiters);
  });
}

interface ThreadRefParamsShape {
  threadId: string;
  providerThreadId: string;
}

async function handleThreadMaintenance(
  id: string | number,
  params: ThreadRefParamsShape,
  request: { method: string; params: Record<string, unknown> },
  options?: {
    releaseAfter?: boolean;
    /** A codex failure that means the requested state is already reached. */
    alreadyInRequestedState?: RegExp;
  },
): Promise<void> {
  const settle = (): void => {
    if (options?.releaseAfter) {
      const session = sessionsByBbThreadId.get(params.threadId);
      if (session) {
        releaseSession(session);
      }
    }
    sendResult(id, { ok: true });
  };
  try {
    await withChildForThread(params.threadId, (connection) =>
      sendMaintenanceRequestWithRetries(connection, request),
    );
    settle();
  } catch (error) {
    if (
      error instanceof Error &&
      options?.alreadyInRequestedState?.test(error.message) === true
    ) {
      settle();
      return;
    }
    // Codex error text passes through verbatim; an archived session gets the
    // typed hint on the error.
    rejectWithCodexError(id, error);
  }
}

/**
 * Reject a runtime request with codex's error text. An archived-session
 * failure carries the `sessionArchived` hint as `error.data.recovery` so the
 * runtime can unarchive and retry once; every other failure is a plain error.
 */
function rejectWithCodexError(id: string | number, error: unknown): void {
  const message = describeCodexLaunchError(error);
  const recovery = archivedSessionHint(message);
  if (recovery !== null) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR, message, { recovery });
    return;
  }
  sendError(id, BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR, message);
}

/**
 * One maintenance request against a child. `thread/name/set` retries the
 * empty-rollout window (see CODEX_EMPTY_ROLLOUT_RENAME_ERROR_PATTERN); every
 * other method and every other error fails on the first attempt.
 */
async function sendMaintenanceRequestWithRetries(
  connection: CodexAppServerConnection,
  request: { method: string; params: Record<string, unknown> },
): Promise<void> {
  const sendOnce = (): Promise<unknown> =>
    connection.request({
      method: request.method,
      params: request.params,
      resultSchema: ignoredChildResultSchema,
      timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
    });
  if (request.method !== "thread/name/set") {
    await sendOnce();
    return;
  }
  for (const retryDelayMs of CODEX_RENAME_RETRY_DELAYS_MS) {
    try {
      await sendOnce();
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !CODEX_EMPTY_ROLLOUT_RENAME_ERROR_PATTERN.test(error.message)
      ) {
        throw error;
      }
      process.stderr.write(
        `codex rollout is not ready; retrying rename in ${retryDelayMs}ms.\n`,
      );
      await delay(retryDelayMs);
    }
  }
  await sendOnce();
}

async function handleSkillsConfigure(
  id: string | number,
  params: z.infer<typeof skillsConfigureParamsSchema>,
): Promise<void> {
  // Codex consumes the canonical payload as extra skill roots: each staged
  // root is a directory codex scans for skill files.
  configuredSkillExtraRoots = params.roots.map((root) => root.path);
  try {
    for (const session of sessionsByBbThreadId.values()) {
      if (
        session.closing ||
        session.connection === null ||
        session.connection.exited
      ) {
        continue;
      }
      await session.connection.request({
        method: "skills/extraRoots/set",
        params: { extraRoots: configuredSkillExtraRoots },
        resultSchema: ignoredChildResultSchema,
        timeoutMs: CHILD_REQUEST_TIMEOUT_MS,
      });
    }
    sendResult(id, { ok: true });
  } catch (error) {
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleRequest(
  request: CodexBridgeCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize":
      handleInitialize(request.id);
      break;
    case "model/list":
      await handleModelList(request.id);
      break;
    case "provider/health":
      sendResult(request.id, await getCodexProviderHealth());
      break;
    case "provider/usage":
      sendResult(request.id, await getCodexProviderUsage());
      break;
    case "provider/installation/status":
      sendResult(
        request.id,
        await getCodexProviderInstallationStatus(request.params.requirement),
      );
      break;
    case "provider/installation/run":
      sendResult(
        request.id,
        await getCodexProviderInstallationRun(request.params.action),
      );
      break;
    case "thread/start":
      await handleThreadConstruction(request.id, request.params, {
        kind: "start",
      });
      break;
    case "thread/resume":
      await handleThreadConstruction(request.id, request.params, {
        kind: "resume",
        providerThreadId: request.params.providerThreadId,
      });
      break;
    case "thread/fork":
      await handleThreadConstruction(request.id, request.params, {
        kind: "fork",
        sourceProviderThreadId: request.params.sourceProviderThreadId,
        ...(request.params.sourceProviderCheckpointId !== undefined
          ? {
              sourceProviderCheckpointId:
                request.params.sourceProviderCheckpointId,
            }
          : {}),
      });
      break;
    case "turn/start":
      await handleTurnStart(request.id, request.params);
      break;
    case "turn/steer":
      await handleTurnSteer(request.id, request.params);
      break;
    case "thread/stop":
      await handleThreadStop(request.id, request.params);
      break;
    case "thread/discard":
      // Codex's discard mapping is archive: the staged provider thread is
      // removed from the active rollout list, and any live child dies with
      // the discarded session.
      await handleThreadMaintenance(
        request.id,
        request.params,
        {
          method: "thread/archive",
          params: { threadId: request.params.providerThreadId },
        },
        { releaseAfter: true },
      );
      break;
    case "thread/name/set":
      await handleThreadMaintenance(request.id, request.params, {
        method: "thread/name/set",
        params: {
          threadId: request.params.providerThreadId,
          name: request.params.title,
        },
      });
      break;
    case "thread/archive":
      // An archived thread is no longer live: release the child so the next
      // turn resumes it (after unarchive) instead of reusing stale state.
      await handleThreadMaintenance(
        request.id,
        request.params,
        {
          method: "thread/archive",
          params: { threadId: request.params.providerThreadId },
        },
        {
          releaseAfter: true,
          alreadyInRequestedState: CODEX_ALREADY_ARCHIVED_ERROR_PATTERN,
        },
      );
      break;
    case "thread/unarchive":
      await handleThreadMaintenance(
        request.id,
        request.params,
        {
          method: "thread/unarchive",
          params: { threadId: request.params.providerThreadId },
        },
        { alreadyInRequestedState: CODEX_NOT_ARCHIVED_ERROR_PATTERN },
      );
      break;
    case "thread/goal/clear":
      await handleThreadMaintenance(request.id, request.params, {
        method: "thread/goal/clear",
        params: { threadId: request.params.providerThreadId },
      });
      break;
    case "skills/configure":
      await handleSkillsConfigure(request.id, request.params);
      break;
  }
}

// ---------------------------------------------------------------------------
// Stdio wiring
// ---------------------------------------------------------------------------

function handleParsedMessage(parsed: unknown): void {
  const response = decodeBridgeJsonRpcResponse(parsed);
  if (response && typeof response.id === "number") {
    const pending = pendingRuntimeRequests.get(response.id);
    if (pending) {
      pendingRuntimeRequests.delete(response.id);
      pending(response);
      return;
    }
  }

  const decoded = decodeCodexBridgeJsonRpcRequest(parsed);
  if (decoded.kind === "ignored") {
    return;
  }
  if (decoded.kind === "unknown-method") {
    sendError(
      decoded.id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Unknown method "${decoded.method}"`,
    );
    return;
  }
  if (decoded.kind === "invalid-params") {
    sendError(
      decoded.id,
      BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      `Invalid params for "${decoded.method}": ${decoded.issues}`,
    );
    return;
  }
  runBridgeRequest({ request: decoded.request, handleRequest, sendError });
}

export const handleLine = createBridgeLineHandler({ handleParsedMessage });

function killAllChildren(): void {
  for (const session of sessionsByBbThreadId.values()) {
    session.closing = true;
    session.connection?.kill();
    session.connection = null;
  }
  sessionsByBbThreadId.clear();
  modelListConnection = null;
  modelListConnectionPromise = null;
  for (const connection of maintenanceConnections) {
    connection.kill();
  }
  maintenanceConnections.clear();
}

/** @internal Test cleanup for bridge tests that create a persistent child. */
export const experimental_killAllChildrenForTests = killAllChildren;

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onClose: () => {
    // Stdin close is the process shutdown boundary: no app-server child may
    // outlive the bridge (they SIGTERM now and SIGKILL on the bounded
    // escalation timer inside each connection).
    killAllChildren();
    process.exit(0);
  },
  onSigterm: () => {
    killAllChildren();
    process.exit(0);
  },
  onSigint: () => {
    killAllChildren();
    process.exit(0);
  },
});
