import { getAppSettings, getEnvironment } from "@bb/db";
import {
  permissionModeSchema,
  promptInputSchema,
  QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH,
  reasoningLevelSchema,
  serviceTierSchema,
  type DispatchGateStage,
  type Environment,
  type Host,
  type JsonValue,
  type PermissionMode,
  type PluginInputs,
  type Project,
  type PromptInput,
  type ReasoningLevel,
  type ServiceTier,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import {
  createThreadEnvironmentArgsSchema,
  type CreateThreadEnvironmentArgs,
  type ExecutionInputFieldSource,
  type StartedOnBehalfOf,
  type ThreadCreateOrigin,
  type ThreadResponse,
} from "@bb/server-contract";
import type {
  PluginDispatchAttemptContext,
  PluginDispatchAttemptKind,
  PluginDispatchExecution,
  PluginDispatchExecutionSources,
  PluginTurnFailedGateContext,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { getNonDestroyedHostWithStatus } from "../lib/entity-lookup.js";
import { clampPermissionModeToHost } from "../hosts/permission-ceiling.js";
import {
  dispatchGateProvider,
  type DispatchGateProvider,
  type DispatchGateRegistration,
} from "../plugins/dispatch-gate-registry.js";
import { getLastProviderThreadId } from "./thread-events.js";

type DispatchGateDeps = Pick<AppDeps, "db" | "hub" | "providerRegistry">;

/**
 * Why this thread's provider can no longer change, or null when it still can.
 *
 * The invariant is NOT "provider is locked when the row is inserted". It is
 * **provider is immutable once a provider session exists**: the session is the
 * conversation, and no other provider can continue one it never started. A
 * `pending` thread whose first message is parked has a row but no session, so
 * it is still free to be repointed — which is the whole window a routing
 * plugin amends in.
 *
 * Two facts have to hold, and each rules out something the other does not:
 *
 * - **The thread must have no provider session.** The event log, not the
 *   thread row, is the authority: a thread reads `idle` both before its first
 *   turn and between two of them, so only `providerThreadId` on the event log
 *   can tell "never ran" from "ran and went quiet". `firstDispatch` is the
 *   cheap in-memory statement of the same thing and the caller checks it
 *   first; this is the durable confirmation.
 * - **The thread must not be a fork.** A fork provisions by CLONING the source
 *   thread's provider session, so its provider is not a free choice at all —
 *   it is a property of the session being cloned.
 */
export function threadProviderAmendmentRefusal(
  deps: Pick<AppDeps, "db">,
  // Structural pick so both the API Thread and the raw db row qualify — the
  // refusal reads only these three facts.
  args: { thread: Pick<Thread, "id" | "providerId" | "originKind"> },
): string | null {
  if (getLastProviderThreadId(deps, args.thread.id) !== null) {
    return `this thread has already started on "${args.thread.providerId}"`;
  }
  if (args.thread.originKind === "fork") {
    return "this thread is a fork, and its first turn clones the source thread's provider session";
  }
  return null;
}

/**
 * Whether an attempt starts a turn or joins one that is already running. The
 * verdict powers are identical either way — a steer is gated exactly like a
 * send — and only the amendment surface narrows.
 */
export type DispatchAttemptKind = PluginDispatchAttemptKind;

/** Fields a gate may amend. Ordered as they are validated and reported. */
const DISPATCH_AMENDMENT_FIELDS = [
  "providerId",
  "model",
  "reasoningLevel",
  "serviceTier",
  "permissionMode",
  "environment",
  "input",
] as const;
export type DispatchAmendmentField = (typeof DISPATCH_AMENDMENT_FIELDS)[number];

/**
 * A gate's answer, re-parsed at the boundary. Plugin sources are untyped at
 * runtime, so the contract's TypeScript shape is a promise, not a guarantee:
 * everything a gate returns is validated here and a malformed verdict fails
 * the attempt with the plugin named, exactly like a throw.
 */
const dispatchGateAmendmentsSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    environment: createThreadEnvironmentArgsSchema.optional(),
    model: z.string().min(1).optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    serviceTier: serviceTierSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
    input: z.array(promptInputSchema).min(1).optional(),
  })
  .strict();
export type DispatchGateAmendments = z.infer<
  typeof dispatchGateAmendmentsSchema
>;

const dispatchGateDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("proceed"),
    amend: dispatchGateAmendmentsSchema.optional(),
  }),
  z.object({
    action: z.literal("wait"),
    reason: z.string().min(1).max(QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH),
    retryAt: z.number().int().nonnegative().nullable().optional(),
  }),
  z.object({ action: z.literal("reject"), message: z.string().min(1) }),
]);

/** What the pass resolved, field by field, and who resolved it. */
export interface DispatchAmendmentResult {
  providerId: string | null;
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
  serviceTier: ServiceTier | null;
  permissionMode: PermissionMode | null;
  environment: CreateThreadEnvironmentArgs | null;
  input: PromptInput[] | null;
  /**
   * The input as the caller wrote it, kept only when a gate replaced it. This
   * is the audit trail the plan requires for a silently rewriting plugin.
   */
  originalInput: PromptInput[] | null;
  /** Last plugin to amend each changed field; empty when nothing was amended. */
  amendedBy: Partial<Record<DispatchAmendmentField, string>>;
}

export function hasDispatchAmendments(
  amendments: DispatchAmendmentResult,
): boolean {
  return Object.keys(amendments.amendedBy).length > 0;
}

/** The single plugin credited on a turn event; the last one to amend anything. */
export function amendingPluginId(
  amendments: DispatchAmendmentResult,
): string | null {
  const ids = Object.values(amendments.amendedBy);
  return ids.length === 0 ? null : (ids[ids.length - 1] ?? null);
}

export interface DispatchGateWaitVerdict {
  pluginId: string;
  reason: string;
  /** Becomes the parked row's `sendAt`, so core's due sweep re-attempts then. */
  retryAt: number | null;
}

export type DispatchGatePassOutcome =
  | { kind: "proceed"; amendments: DispatchAmendmentResult }
  | {
      kind: "wait";
      /**
       * The pass parks ONE row, owned by the FIRST plugin that voted to wait.
       * Several rows would multiply the user's Send-now/Cancel affordances for
       * one decision and make "send this message" ambiguous, while one row
       * keeps a single card whose reason line names every waiter. The losers'
       * reasons are appended to that reason; each of them votes again on the
       * next attempt, so nothing is lost by not owning the row.
       */
      waiter: DispatchGateWaitVerdict;
      additionalWaiters: readonly DispatchGateWaitVerdict[];
      amendments: DispatchAmendmentResult;
    };

export interface DispatchGatePassRequest {
  /** The target thread; a `pending` row for a first message. */
  thread: Thread;
  /** The thread's public DTO, as the gate context carries it. */
  threadResponse: ThreadResponse;
  project: Project;
  environmentId: string | null;
  input: PromptInput[];
  requestedExecution: PluginDispatchExecution;
  executionSources: PluginDispatchExecutionSources;
  attempt: DispatchAttemptKind;
  /** True while no message on this thread has ever cleared an attempt. */
  firstDispatch: boolean;
  /**
   * Whether an `environment` amendment can still be honoured on THIS attempt.
   *
   * Narrower than `firstDispatch`, and deliberately not exposed to plugins:
   * re-resolving an environment intent means re-running most of thread
   * creation, which only the attempt that is creating the thread has on its
   * stack. A drain re-attempt of a still-`pending` thread is `firstDispatch`
   * and yet cannot honour one, so the two flags are genuinely different facts.
   */
  environmentAmendable: boolean;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  parentThreadId: string | null;
  pluginInputs: PluginInputs;
  /** The parked row being re-attempted; null for an inline first attempt. */
  queuedMessage: ThreadQueuedMessage | null;
}

/**
 * Minimum gap between a re-attempt that re-parked and the next drain attempt
 * on that thread.
 *
 * Clearing a wait re-runs the gate pass, and a pass that votes to wait again
 * parks the row afresh — so a plugin that clears the moment it sees
 * `queue.parked` would spin clear → re-park → clear at whatever rate its event
 * handler fires. Core owns the pacing rather than trusting plugins, the same
 * way `STALE_QUEUED_MESSAGE_CLAIM_MS` in the queue owns claim recovery rather
 * than trusting senders.
 *
 * Only a re-park starts the clock. An attempt that dispatched is not a loop
 * and must never be delayed — a due scheduled send that re-parks for a busy
 * thread and then dispatches the moment the turn ends is one normal sequence
 * of two attempts milliseconds apart. And the window is per thread, not per
 * row, because a re-park can land on a different row entirely.
 */
const DISPATCH_REPARK_MIN_INTERVAL_MS = 1_000;

/**
 * When each thread last had a drain attempt turn straight back into a park.
 * In-memory on purpose: this paces a live spin, and a restart is already a
 * hard stop for one. Entries are dropped as they age out, so a long-lived
 * server does not accumulate one per thread ever drained.
 */
const lastReparkedAtByThreadId = new Map<string, number>();

export function noteDispatchReparked(threadId: string): void {
  const now = Date.now();
  for (const [id, at] of lastReparkedAtByThreadId) {
    if (now - at >= DISPATCH_REPARK_MIN_INTERVAL_MS) {
      lastReparkedAtByThreadId.delete(id);
    }
  }
  lastReparkedAtByThreadId.set(threadId, now);
}

/**
 * True when this thread re-parked moments ago and the next drain attempt
 * should wait. The caller does nothing, so the row stays parked and the next
 * sweep tick, drain or user action tries again.
 */
export function isDispatchReparkedRecently(threadId: string): boolean {
  const at = lastReparkedAtByThreadId.get(threadId);
  return at !== undefined && Date.now() - at < DISPATCH_REPARK_MIN_INTERVAL_MS;
}

/**
 * True when at least one plugin registered a gate for this stage. Every wiring
 * site checks this first: with no gates the dispatch path must be
 * byte-for-byte what it was before gates existed — no lock, no context
 * assembly, no queued row.
 */
export function hasDispatchGates(stage: DispatchGateStage): boolean {
  const provider = dispatchGateProvider();
  return provider !== undefined && provider.listGates(stage).length > 0;
}

/**
 * Server-wide evaluation lock. Gates that count in-flight work (a concurrency
 * limiter tallying its own `proceed`s) are only correct if no two passes
 * interleave, so every pass runs to completion before the next starts. The
 * cost is real — a slow gate delays other dispatches up to its box — and is
 * accepted deliberately; scoping the lock per project or host is the fix if it
 * bites.
 */
let evaluationLock: Promise<unknown> = Promise.resolve();

function withEvaluationLock<T>(run: () => Promise<T>): Promise<T> {
  const result = evaluationLock.then(run, run);
  // Swallow only for the chain: the caller still sees the rejection.
  evaluationLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function dispatchGateFailure(
  pluginId: string,
  stage: DispatchGateStage,
  detail: string,
): ApiError {
  // Fail-closed, mirroring how a throwing `deriveProviderOptions` fails the
  // command: 502 says the failure came from something behind the server rather
  // than from the caller's request, and the plugin is named so the user knows
  // which one to disable.
  return new ApiError(
    502,
    "dispatch_gate_failed",
    `The "${pluginId}" plugin's ${stage} gate failed: ${detail}`,
    { details: { pluginId, stage } },
  );
}

function dispatchRejection(pluginId: string, message: string): ApiError {
  return new ApiError(409, "dispatch_rejected", message, {
    details: { pluginId, stage: "dispatch" },
  });
}

/** True when `error` is a gate's `reject` verdict rather than a failure. */
export function isDispatchRejectedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.body.code === "dispatch_rejected";
}

/**
 * Runs one gate inside its decision box. A timeout resolves as a failure
 * rather than racing on: the handler's promise may never settle, and the whole
 * point of the box is that the dispatch does not wait on it.
 */
async function decideWithinBox<T>(
  run: () => Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run().then(
        (value) => ({ ok: true, value }) as const,
        (error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }) as const,
      ),
      new Promise<{ ok: false; error: string }>((resolveTimeout) => {
        timer = setTimeout(
          () =>
            resolveTimeout({
              ok: false,
              error: `did not decide within ${timeoutMs}ms`,
            }),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The gate chain for a stage: the plugin ids the user pinned in
 * `dispatchGateOrder` first, in that order, then everything else in plugin
 * install order. Mirrors `providerOrder`, including ignoring an id that names
 * no registered gate.
 */
function orderedGates(
  deps: Pick<AppDeps, "db">,
  provider: DispatchGateProvider,
  stage: DispatchGateStage,
): DispatchGateRegistration<DispatchGateStage>[] {
  const gates = provider.listGates(stage);
  if (gates.length === 0) return [];
  const preferred = getAppSettings(deps.db).dispatchGateOrder[stage] ?? [];
  if (preferred.length === 0) return gates;
  const rank = new Map(preferred.map((id, index) => [id, index]));
  // A stable sort keyed on pinned rank: unpinned ids all share the sentinel
  // rank, so they keep their relative install order behind the pinned ones.
  return [...gates].sort((a, b) => {
    const rankA = rank.get(a.pluginId) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rank.get(b.pluginId) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}

/**
 * The environment/host pair a gate context carries, resolved the same way for
 * every stage so a `turn.failed` gate sees the same host record — including its
 * live connection state — that the attempt gate did.
 */
export function dispatchGateEnvironmentAndHost(
  deps: Pick<AppDeps, "db" | "hub">,
  environmentId: string | null,
): { environment: Environment | null; host: Host | null } {
  if (environmentId === null) return { environment: null, host: null };
  const environment = getEnvironment(deps.db, environmentId);
  if (environment === null) return { environment: null, host: null };
  // The same DTO `GET /threads/:id?include=host` serves, so a gate reading
  // `host.status` sees the live connection state rather than a stored row.
  return {
    environment,
    host: getNonDestroyedHostWithStatus(deps, environment.hostId),
  };
}

/** The concatenated text blocks, which is what a rules-based router matches on. */
export function dispatchInputText(input: readonly PromptInput[]): string {
  return input
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function emptyAmendments(): DispatchAmendmentResult {
  return {
    providerId: null,
    model: null,
    reasoningLevel: null,
    serviceTier: null,
    permissionMode: null,
    environment: null,
    input: null,
    originalInput: null,
    amendedBy: {},
  };
}

interface ApplyAmendmentArgs {
  amend: DispatchGateAmendments;
  amendments: DispatchAmendmentResult;
  execution: PluginDispatchExecution;
  input: PromptInput[];
  pluginId: string;
  request: DispatchGatePassRequest;
  sources: PluginDispatchExecutionSources;
}

/**
 * Applies one gate's amendments to the running state so the next gate in the
 * chain sees them, validating each one against the same rules a request would
 * face. An invalid amendment fails the attempt (fail-closed) with the plugin
 * named — an amendment that cannot be honored is a bug in the plugin, and
 * silently ignoring it would run the turn with settings nobody chose.
 *
 * The windows come from the attempt itself rather than from a per-stage type,
 * because that is where they actually live: the same plugin, with the same
 * registration, may legitimately amend a provider on one attempt and not on
 * the next one for the same thread.
 */
export function applyGateAmendment(
  deps: DispatchGateDeps,
  args: ApplyAmendmentArgs,
) {
  const { amend, pluginId, request } = args;
  const fail = (detail: string): never => {
    throw dispatchGateFailure(pluginId, "dispatch", detail);
  };
  const requireStartTurn = (field: string): void => {
    if (request.attempt === "join-turn") {
      fail(
        `amended ${field} on a join-turn attempt; the turn is already running, so its execution is settled — only \`input\` may be amended when joining`,
      );
    }
  };

  if (amend.providerId !== undefined) {
    requireStartTurn("providerId");
    if (!request.firstDispatch) {
      fail(
        "amended providerId on a thread that has already dispatched; a thread's provider is immutable once a provider session exists",
      );
    }
    const refusal = threadProviderAmendmentRefusal(deps, {
      thread: request.thread,
    });
    if (refusal !== null) {
      fail(`amended providerId, but ${refusal}`);
    }
    if (amend.model === undefined) {
      // The tuple this pass is amending was already resolved, and it names a
      // model of the provider being left; a resolved tuple cannot say
      // "re-resolve this". A provider without a model would dispatch a model
      // the new provider does not offer.
      fail(
        `amended providerId to "${amend.providerId}" without a model; the resolved tuple's model belongs to the provider it is leaving`,
      );
    }
    const registration = deps.providerRegistry.get(amend.providerId);
    if (registration === null || !registration.info.available) {
      fail(`amended providerId to "${amend.providerId}", which is not available`);
    }
    args.execution.providerId = amend.providerId;
    args.amendments.providerId = amend.providerId;
    args.amendments.amendedBy.providerId = pluginId;
    args.sources.providerId = "plugin";
  }

  if (amend.environment !== undefined) {
    requireStartTurn("environment");
    if (!request.firstDispatch) {
      fail(
        "amended environment on a thread that has already dispatched; a thread's workspace is chosen when it is provisioned",
      );
    }
    if (!request.environmentAmendable) {
      fail(
        "amended environment on a re-attempt; a thread's workspace can only be chosen on the attempt that creates it, so amend it on the first pass or not at all",
      );
    }
    args.amendments.environment = amend.environment;
    args.amendments.amendedBy.environment = pluginId;
  }

  if (amend.model !== undefined) {
    requireStartTurn("model");
    args.execution.model = amend.model;
    args.amendments.model = amend.model;
    args.amendments.amendedBy.model = pluginId;
    args.sources.model = "plugin";
  }

  if (amend.reasoningLevel !== undefined) {
    requireStartTurn("reasoningLevel");
    args.execution.reasoningLevel = amend.reasoningLevel;
    args.amendments.reasoningLevel = amend.reasoningLevel;
    args.amendments.amendedBy.reasoningLevel = pluginId;
    args.sources.reasoningLevel = "plugin";
  }

  if (amend.serviceTier !== undefined) {
    requireStartTurn("serviceTier");
    args.execution.serviceTier = amend.serviceTier;
    args.amendments.serviceTier = amend.serviceTier;
    args.amendments.amendedBy.serviceTier = pluginId;
    args.sources.serviceTier = "plugin";
  }

  if (amend.permissionMode !== undefined) {
    requireStartTurn("permissionMode");
    const hostId =
      dispatchGateEnvironmentAndHost(deps, request.environmentId).host?.id ??
      null;
    // Never fails the attempt for asking too much: the machine's ceiling wins
    // and the gate gets the highest mode the host and provider both allow.
    const clamped = clampPermissionModeToHost(deps, {
      hostId,
      permissionMode: amend.permissionMode,
      providerId: args.execution.providerId,
    });
    args.execution.permissionMode = clamped;
    args.amendments.permissionMode = clamped;
    args.amendments.amendedBy.permissionMode = pluginId;
    args.sources.permissionMode = "plugin";
  }

  if (amend.input !== undefined) {
    // Deliberately legal on a `join-turn` attempt: a steer's CONTENT is still
    // being decided at this moment, which is what lets a content-policy or DLP
    // gate cover steers instead of only covering sends.
    args.amendments.originalInput ??= [...args.input];
    args.input.length = 0;
    args.input.push(...amend.input);
    args.amendments.input = [...amend.input];
    args.amendments.amendedBy.input = pluginId;
  }
}

function buildGateContext(
  deps: DispatchGateDeps,
  args: {
    execution: PluginDispatchExecution;
    input: PromptInput[];
    pluginId: string;
    request: DispatchGatePassRequest;
    sources: PluginDispatchExecutionSources;
  },
): PluginDispatchAttemptContext {
  const { environment, host } = dispatchGateEnvironmentAndHost(
    deps,
    args.request.environmentId,
  );
  const pluginInput: JsonValue | null =
    args.request.pluginInputs[args.pluginId] ?? null;
  return {
    stage: "dispatch",
    thread: args.request.threadResponse,
    attempt: args.request.attempt,
    firstDispatch: args.request.firstDispatch,
    project: args.request.project,
    environment,
    host,
    input: {
      blocks: [...args.input],
      text: dispatchInputText(args.input),
    },
    requestedExecution: { ...args.execution },
    executionSources: { ...args.sources },
    origin: args.request.origin,
    originPluginId: args.request.originPluginId,
    startedOnBehalfOf: args.request.startedOnBehalfOf,
    parentThreadId: args.request.parentThreadId,
    pluginInput,
    queuedMessage: args.request.queuedMessage,
  };
}

/**
 * Runs one full gate pass at the single dispatch checkpoint.
 *
 * Order is install order with the user's override on top; amendments
 * accumulate left to right so every gate sees its predecessors' effects; a
 * `reject` short-circuits the pass and throws a 409; `wait` verdicts are
 * COLLECTED across the whole pass rather than short-circuiting, so the
 * provider and model a parked row freezes are the ones the whole chain agreed
 * on. The attempt proceeds only when a pass yields no waits.
 *
 * The caller must check {@link hasDispatchGates} first; with no gates this
 * returns an empty `proceed` without touching the lock.
 */
export async function runDispatchGatePass(
  deps: DispatchGateDeps,
  request: DispatchGatePassRequest,
): Promise<DispatchGatePassOutcome> {
  const provider = dispatchGateProvider();
  if (provider === undefined) {
    return { kind: "proceed", amendments: emptyAmendments() };
  }
  const gates = orderedGates(deps, provider, "dispatch");
  if (gates.length === 0) {
    return { kind: "proceed", amendments: emptyAmendments() };
  }

  return withEvaluationLock(async () => {
    const amendments = emptyAmendments();
    const execution: PluginDispatchExecution = { ...request.requestedExecution };
    const sources: PluginDispatchExecutionSources = {
      ...request.executionSources,
    };
    const input = [...request.input];
    const waits: DispatchGateWaitVerdict[] = [];

    for (const gate of gates) {
      const context = buildGateContext(deps, {
        execution,
        input,
        pluginId: gate.pluginId,
        request,
        sources,
      });
      const invocation = await provider.invokeGate(
        gate.pluginId,
        "dispatch gate",
        () =>
          decideWithinBox(
            async () => gate.handler(context),
            provider.decisionTimeoutMs,
          ),
      );
      if (!invocation.ok) {
        throw dispatchGateFailure(gate.pluginId, "dispatch", invocation.error);
      }
      if (!invocation.value.ok) {
        throw dispatchGateFailure(
          gate.pluginId,
          "dispatch",
          invocation.value.error,
        );
      }
      const parsed = dispatchGateDecisionSchema.safeParse(
        invocation.value.value,
      );
      if (!parsed.success) {
        throw dispatchGateFailure(
          gate.pluginId,
          "dispatch",
          `returned an invalid verdict: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
        );
      }
      const decision = parsed.data;
      if (decision.action === "reject") {
        throw dispatchRejection(gate.pluginId, decision.message);
      }
      if (decision.action === "wait") {
        waits.push({
          pluginId: gate.pluginId,
          reason: decision.reason,
          retryAt: decision.retryAt ?? null,
        });
        continue;
      }
      if (decision.amend !== undefined) {
        applyGateAmendment(deps, {
          amend: decision.amend,
          amendments,
          execution,
          input,
          pluginId: gate.pluginId,
          request,
          sources,
        });
      }
    }

    const waiter = waits[0];
    if (waiter === undefined) {
      return { kind: "proceed", amendments };
    }
    return {
      kind: "wait",
      waiter,
      additionalWaiters: waits.slice(1),
      amendments,
    };
  });
}

/**
 * The wait reason for a pass, naming every plugin that voted to wait. The
 * first waiter owns the row, so its reason leads; the rest are appended so the
 * user sees the whole picture on one card rather than one card per gate.
 */
export function dispatchWaitReasonForPass(
  outcome: Extract<DispatchGatePassOutcome, { kind: "wait" }>,
): string {
  const extra = outcome.additionalWaiters
    .map((entry) => `${entry.pluginId}: ${entry.reason}`)
    .join("; ");
  const reason =
    extra.length === 0
      ? outcome.waiter.reason
      : `${outcome.waiter.reason} (also waiting on ${extra})`;
  return reason.length > QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH
    ? `${reason.slice(0, QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH - 1)}…`
    : reason;
}

const turnFailedGateDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("none") }),
  z.object({
    action: z.literal("retry"),
    reason: z.string().min(1).max(QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH),
    resumeAt: z.number().int().nonnegative(),
  }),
]);

export interface TurnFailedRetryVerdict {
  pluginId: string;
  reason: string;
  resumeAt: number;
}

export type TurnFailedGatePassOutcome =
  | { kind: "none" }
  | { kind: "retry"; verdict: TurnFailedRetryVerdict };

export interface TurnFailedGatePassRequest {
  context: Omit<PluginTurnFailedGateContext, "stage">;
  /** Named in the log line when a gate misbehaves. */
  threadId: string;
}

type TurnFailedGatePassDeps = Pick<AppDeps, "db" | "logger">;

/**
 * Runs the `turn.failed` chain.
 *
 * Two things differ from an attempt pass, both because the failure has
 * already been applied:
 *
 * - **A bad gate loses its vote, not the thread.** Fail-closed at the attempt
 *   means refusing to dispatch, because the safe state is "nothing ran". Here
 *   the safe state is the failure standing exactly as core wrote it, so a gate
 *   that throws, times out or returns a malformed verdict is logged with its
 *   plugin named and SKIPPED. Propagating would let one broken retry plugin
 *   turn every failure into a second failure, and there is no caller left to
 *   receive the error anyway.
 * - **The first `retry` wins and stops the chain.** Nothing accumulates across
 *   a pass here — there are no amendments to collect and one failure earns at
 *   most one retry row — so continuing past a decided retry would only ask
 *   later gates to answer a question that is already settled.
 *
 * It still runs under the same server-wide evaluation lock as attempt passes:
 * a retry policy that counts what it has in flight must not interleave with
 * the limiter deciding whether that retry may dispatch.
 */
export async function runTurnFailedGatePass(
  deps: TurnFailedGatePassDeps,
  request: TurnFailedGatePassRequest,
): Promise<TurnFailedGatePassOutcome> {
  const provider = dispatchGateProvider();
  if (provider === undefined) {
    return { kind: "none" };
  }
  const gates = orderedGates(deps, provider, "turn.failed");
  if (gates.length === 0) {
    return { kind: "none" };
  }

  return withEvaluationLock(async () => {
    for (const gate of gates) {
      const context: PluginTurnFailedGateContext = {
        ...request.context,
        stage: "turn.failed",
      };
      const invocation = await provider.invokeGate(
        gate.pluginId,
        "turn.failed dispatch gate",
        () =>
          decideWithinBox(
            async () => gate.handler(context),
            provider.decisionTimeoutMs,
          ),
      );
      const detail = !invocation.ok
        ? invocation.error
        : !invocation.value.ok
          ? invocation.value.error
          : null;
      if (detail !== null) {
        deps.logger.warn(
          { pluginId: gate.pluginId, threadId: request.threadId, detail },
          "Discarded a turn.failed gate verdict: the gate failed",
        );
        continue;
      }
      const parsed = turnFailedGateDecisionSchema.safeParse(
        invocation.ok && invocation.value.ok ? invocation.value.value : null,
      );
      if (!parsed.success) {
        deps.logger.warn(
          {
            pluginId: gate.pluginId,
            threadId: request.threadId,
            detail: parsed.error.issues
              .map((issue) => `${issue.path.join(".")} ${issue.message}`)
              .join("; "),
          },
          "Discarded a turn.failed gate verdict: the gate returned an invalid decision",
        );
        continue;
      }
      if (parsed.data.action === "retry") {
        return {
          kind: "retry",
          verdict: {
            pluginId: gate.pluginId,
            reason: parsed.data.reason,
            resumeAt: parsed.data.resumeAt,
          },
        };
      }
    }
    return { kind: "none" };
  });
}

/** The per-field sources a request carries into a pass. */
export function dispatchExecutionSources(args: {
  model?: ExecutionInputFieldSource;
  permissionMode?: ExecutionInputFieldSource;
  providerId?: ExecutionInputFieldSource;
  reasoningLevel?: ExecutionInputFieldSource;
  serviceTier?: ExecutionInputFieldSource;
}): PluginDispatchExecutionSources {
  return {
    providerId: args.providerId ?? null,
    model: args.model ?? null,
    reasoningLevel: args.reasoningLevel ?? null,
    serviceTier: args.serviceTier ?? null,
    permissionMode: args.permissionMode ?? null,
  };
}
