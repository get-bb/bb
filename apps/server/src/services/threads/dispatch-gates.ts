import { getEnvironment } from "@bb/db";
import {
  QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH,
  type DispatchGateStage,
  type Environment,
  type Host,
  type Project,
  type PromptInput,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import type {
  ExecutionInputFieldSource,
  StartedOnBehalfOf,
  ThreadCreateOrigin,
  ThreadResponse,
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
import {
  dispatchGateProvider,
  type DispatchGateProvider,
  type DispatchGateRegistration,
} from "../plugins/dispatch-gate-registry.js";

type DispatchGateDeps = Pick<AppDeps, "db" | "hub">;

/**
 * Whether an attempt starts a turn or joins one that is already running. The
 * verdict powers are identical either way — a steer is gated exactly like a
 * send.
 */
export type DispatchAttemptKind = PluginDispatchAttemptKind;

/**
 * A gate's answer, re-parsed at the boundary. Plugin sources are untyped at
 * runtime, so the contract's TypeScript shape is a promise, not a guarantee:
 * everything a gate returns is validated here and a malformed verdict fails
 * the attempt with the plugin named, exactly like a throw.
 */
const dispatchGateDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("proceed") }),
  z.object({
    action: z.literal("wait"),
    reason: z.string().min(1).max(QUEUED_MESSAGE_WAIT_REASON_MAX_LENGTH),
    retryAt: z.number().int().nonnegative().nullable().optional(),
  }),
  z.object({ action: z.literal("reject"), message: z.string().min(1) }),
]);

export interface DispatchGateWaitVerdict {
  pluginId: string;
  reason: string;
  /** Becomes the parked row's `sendAt`, so core's due sweep re-attempts then. */
  retryAt: number | null;
}

export type DispatchGatePassOutcome =
  | { kind: "proceed" }
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
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  parentThreadId: string | null;
  /** The parked row being re-attempted; null for an inline first attempt. */
  queuedMessage: ThreadQueuedMessage | null;
  /**
   * Commits this admission BEFORE the evaluation lock releases.
   *
   * This is what makes `sdk.threads.listRunning()` exact inside a gate. The
   * lock already serializes evaluation, but serializing the *questions* is
   * worthless if the answers land later: five creates arriving together would
   * each ask "how many are running", each be told the same stale number, and
   * each be admitted against a limit of two. Committing the thread's
   * `pending → starting` flip here means attempt N+1 reads a database that
   * already contains attempt N's admission.
   *
   * Run only when the pass yields no waits, and only for an attempt that has a
   * transition to commit — a warm follow-up's `idle → active` flip lives inside
   * the send transaction, which needs a prepared host command and therefore
   * cannot run under this lock. See the exactness note on `listRunning`.
   */
  commitAdmission?: () => Promise<void>;
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
 * Server-wide evaluation lock.
 *
 * A gate that limits concurrency is only correct if no two passes interleave,
 * so every pass runs to completion before the next starts — AND, via
 * `commitAdmission`, a cleared attempt's thread-status flip commits before the
 * lock releases. Those two together are what let a gate simply ask the server
 * what is running (`sdk.threads.listRunning()`) instead of maintaining its own
 * tally of in-flight `proceed`s: the fact is already true by the time the next
 * gate reads it.
 *
 * The cost is real — a slow gate delays other dispatches up to its box — and is
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
 * The gate chain for a stage: plugin install order, which is deterministic and
 * is the only order there is. Nothing reorders it — a chain of pure decisions
 * composes the same way whichever order it runs in, because a `reject` from
 * any gate refuses and a `wait` from any gate parks.
 */
function orderedGates(
  provider: DispatchGateProvider,
  stage: DispatchGateStage,
): DispatchGateRegistration<DispatchGateStage>[] {
  return provider.listGates(stage);
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

/**
 * The context every gate in a pass sees.
 *
 * Built once and shared: with no amendments, nothing a gate returns can change
 * what the next one is deciding about, so the pass is a chain of independent
 * verdicts on one unchanging fact.
 */
function buildGateContext(
  deps: DispatchGateDeps,
  request: DispatchGatePassRequest,
): PluginDispatchAttemptContext {
  const { environment, host } = dispatchGateEnvironmentAndHost(
    deps,
    request.environmentId,
  );
  return {
    stage: "dispatch",
    thread: request.threadResponse,
    attempt: request.attempt,
    project: request.project,
    environment,
    host,
    input: {
      blocks: [...request.input],
      text: dispatchInputText(request.input),
    },
    requestedExecution: { ...request.requestedExecution },
    executionSources: { ...request.executionSources },
    origin: request.origin,
    originPluginId: request.originPluginId,
    startedOnBehalfOf: request.startedOnBehalfOf,
    parentThreadId: request.parentThreadId,
    queuedMessage: request.queuedMessage,
  };
}

/**
 * Runs one full gate pass at the single dispatch checkpoint.
 *
 * Order is plugin install order; a `reject` short-circuits the pass and throws
 * a 409; `wait` verdicts are COLLECTED across the whole pass rather than
 * short-circuiting, so every gate that would have parked the message gets its
 * reason onto the one row. The attempt proceeds only when a pass yields no
 * waits.
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
    return { kind: "proceed" };
  }
  const gates = orderedGates(provider, "dispatch");
  if (gates.length === 0) {
    return { kind: "proceed" };
  }

  return withEvaluationLock(async () => {
    const context = buildGateContext(deps, request);
    const waits: DispatchGateWaitVerdict[] = [];

    for (const gate of gates) {
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
    }

    const waiter = waits[0];
    if (waiter === undefined) {
      // Still inside the lock, deliberately: see `commitAdmission`.
      await request.commitAdmission?.();
      return { kind: "proceed" };
    }
    return { kind: "wait", waiter, additionalWaiters: waits.slice(1) };
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
 * - **The first `retry` wins and stops the chain.** One failure earns at most
 *   one retry row, so continuing past a decided retry would only ask later
 *   gates to answer a question that is already settled.
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
  const gates = orderedGates(provider, "turn.failed");
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
