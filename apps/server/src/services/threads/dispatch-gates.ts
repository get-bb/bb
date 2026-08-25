import { getAppSettings, getEnvironment, type DispatchHoldRow } from "@bb/db";
import {
  permissionModeSchema,
  promptInputSchema,
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
  PluginDispatchExecution,
  PluginDispatchExecutionSources,
  PluginDispatchGateStage,
  PluginThreadCreateGateContext,
  PluginTurnSubmitGateContext,
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
import { toDispatchHoldResponse } from "./dispatch-holds.js";

type DispatchGateDeps = Pick<AppDeps, "db" | "hub" | "providerRegistry">;

/**
 * The plugin id a `plugin:` holder wraps. `DispatchHoldHolder` keeps the
 * prefix discriminable at the type level, so composing one is a template
 * literal rather than a cast.
 */
export function dispatchGateHolder(pluginId: string): `plugin:${string}` {
  return `plugin:${pluginId}`;
}

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
 * the dispatch with the plugin named, exactly like a throw.
 */
const dispatchGateAmendmentsSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    serviceTier: serviceTierSchema.optional(),
    permissionMode: permissionModeSchema.optional(),
    environment: createThreadEnvironmentArgsSchema.optional(),
    input: z.array(promptInputSchema).min(1).optional(),
  })
  .strict();
type DispatchGateAmendments = z.infer<typeof dispatchGateAmendmentsSchema>;

const dispatchGateDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("proceed"),
    amend: dispatchGateAmendmentsSchema.optional(),
  }),
  z.object({
    action: z.literal("hold"),
    reason: z.string().min(1).max(200),
    resumeAt: z.number().int().nonnegative().nullable().optional(),
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

export interface DispatchGateHoldVerdict {
  pluginId: string;
  reason: string;
  resumeAt: number | null;
}

export type DispatchGatePassOutcome =
  | { kind: "proceed"; amendments: DispatchAmendmentResult }
  | {
      kind: "hold";
      /**
       * The pass creates ONE hold row, owned by the FIRST plugin that voted to
       * hold. Several rows would multiply the user's Release/Cancel affordances
       * for one decision and make "release this dispatch" ambiguous, while one
       * row keeps a single card whose reason line names every holder. The
       * losers' reasons ride `additionalHolders` onto the timeline event; each
       * of them re-votes at release, so nothing is lost by not owning the row.
       */
      holder: DispatchGateHoldVerdict;
      additionalHolders: readonly DispatchGateHoldVerdict[];
      amendments: DispatchAmendmentResult;
    };

export interface DispatchGatePassRequest {
  stage: DispatchGateStage;
  /** Null at `thread.create`; the target thread at `turn.submit`. */
  thread: Thread | null;
  /** The `turn.submit` thread's public DTO; null at `thread.create`. */
  threadResponse: ThreadResponse | null;
  project: Project;
  environmentId: string | null;
  input: PromptInput[];
  requestedExecution: PluginDispatchExecution;
  executionSources: PluginDispatchExecutionSources;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  parentThreadId: string | null;
  pluginInputs: PluginInputs;
  /**
   * Set when this pass re-decides a hold that is being released. `skipPluginId`
   * is the owner a user "Release now" exempts for this one pass — the user
   * overrode that gate's decision, and re-asking it would undo the override.
   */
  release: {
    hold: DispatchHoldRow;
    skipPluginId: string | null;
  } | null;
}

/**
 * Minimum gap between a release that re-held and the next release attempt on
 * that thread.
 *
 * Releasing re-runs the gate pipeline, and a pass that votes to hold again
 * creates a new hold — so an owner that releases the moment it sees
 * `dispatch.held` would spin release → re-hold → release at whatever rate its
 * event handler fires. Core owns the pacing rather than trusting owners, the
 * same way `STALE_QUEUED_MESSAGE_CLAIM_MS` in the queue owns claim recovery
 * rather than trusting senders.
 *
 * Only a re-hold starts the clock. A release that dispatched is not a loop and
 * must never be delayed — a timer release that re-parks for an offline host and
 * then dispatches the moment the host reconnects is one normal sequence of two
 * releases milliseconds apart. And the window is per thread, not per hold,
 * because a re-hold is a *different* row: keying it to the hold id would
 * measure nothing.
 */
const RELEASE_REHOLD_MIN_INTERVAL_MS = 1_000;

/**
 * When each thread last had a release turn straight back into a hold.
 * In-memory on purpose: this paces a live spin, and a restart is already a hard
 * stop for one. Entries are dropped as they age out, so a long-lived server
 * does not accumulate one per thread ever released.
 */
const lastReleaseReheldAtByThreadId = new Map<string, number>();

function noteDispatchReleaseReheld(threadId: string): void {
  const now = Date.now();
  for (const [id, at] of lastReleaseReheldAtByThreadId) {
    if (now - at >= RELEASE_REHOLD_MIN_INTERVAL_MS) {
      lastReleaseReheldAtByThreadId.delete(id);
    }
  }
  lastReleaseReheldAtByThreadId.set(threadId, now);
}

/**
 * True when this thread re-held on release moments ago and the next attempt
 * should wait. The caller settles nothing, so the hold stays live and the next
 * timer tick, sweep or user action tries again.
 */
export function isDispatchReleaseReheldRecently(threadId: string): boolean {
  const at = lastReleaseReheldAtByThreadId.get(threadId);
  return at !== undefined && Date.now() - at < RELEASE_REHOLD_MIN_INTERVAL_MS;
}

/**
 * True when at least one plugin registered a gate for this stage. Every wiring
 * site checks this first: with no gates the dispatch path must be
 * byte-for-byte what it was before gates existed — no lock, no context
 * assembly, no hold row.
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
    `The "${pluginId}" plugin's ${stage} dispatch gate failed: ${detail}`,
    { details: { pluginId, stage } },
  );
}

function dispatchRejection(
  pluginId: string,
  stage: DispatchGateStage,
  message: string,
): ApiError {
  return new ApiError(409, "dispatch_rejected", message, {
    details: { pluginId, stage },
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
  stage: PluginDispatchGateStage,
): DispatchGateRegistration<PluginDispatchGateStage>[] {
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

function environmentAndHost(
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
 * face. An invalid amendment fails the dispatch (fail-closed) with the plugin
 * named — an amendment that cannot be honored is a bug in the plugin, and
 * silently ignoring it would run the turn with settings nobody chose.
 */
function applyGateAmendment(deps: DispatchGateDeps, args: ApplyAmendmentArgs) {
  const { amend, pluginId, request } = args;
  const fail = (detail: string): never => {
    throw dispatchGateFailure(pluginId, request.stage, detail);
  };

  if (amend.providerId !== undefined) {
    if (request.stage !== "thread.create") {
      fail(
        "amended providerId on an existing thread; a thread's provider is fixed when its row is inserted",
      );
    }
    if (request.release !== null) {
      // The row already carries the provider it was inserted with, so an
      // amendment here would silently disagree with the persisted thread.
      fail(
        "amended providerId while releasing a hold; the provider was locked when the thread row was inserted",
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

  if (amend.model !== undefined) {
    args.execution.model = amend.model;
    args.amendments.model = amend.model;
    args.amendments.amendedBy.model = pluginId;
    args.sources.model = "plugin";
  }

  if (amend.reasoningLevel !== undefined) {
    args.execution.reasoningLevel = amend.reasoningLevel;
    args.amendments.reasoningLevel = amend.reasoningLevel;
    args.amendments.amendedBy.reasoningLevel = pluginId;
    args.sources.reasoningLevel = "plugin";
  }

  if (amend.serviceTier !== undefined) {
    args.execution.serviceTier = amend.serviceTier;
    args.amendments.serviceTier = amend.serviceTier;
    args.amendments.amendedBy.serviceTier = pluginId;
    args.sources.serviceTier = "plugin";
  }

  if (amend.permissionMode !== undefined) {
    const hostId =
      environmentAndHost(deps, request.environmentId).host?.id ?? null;
    // Never fails the dispatch for asking too much: the machine's ceiling wins
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

  if (amend.environment !== undefined) {
    if (request.stage !== "thread.create") {
      fail(
        "amended environment on an existing thread; a thread's workspace is chosen when it is created",
      );
    }
    args.amendments.environment = amend.environment;
    args.amendments.amendedBy.environment = pluginId;
  }

  if (amend.input !== undefined) {
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
): PluginThreadCreateGateContext | PluginTurnSubmitGateContext {
  const { environment, host } = environmentAndHost(
    deps,
    args.request.environmentId,
  );
  const pluginInput: JsonValue | null =
    args.request.pluginInputs[args.pluginId] ?? null;
  const base = {
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
    isReleaseReevaluation: args.request.release !== null,
    hold:
      args.request.release === null
        ? null
        : toDispatchHoldResponse(args.request.release.hold),
  };
  if (args.request.stage === "thread.create") {
    return { ...base, stage: "thread.create", thread: null };
  }
  if (args.request.threadResponse === null) {
    throw new Error("turn.submit dispatch gate pass has no thread");
  }
  return {
    ...base,
    stage: "turn.submit",
    thread: args.request.threadResponse,
  };
}

/**
 * Runs one full gate pass.
 *
 * Order is install order with the user's per-stage override on top;
 * amendments accumulate left to right so every gate sees its predecessors'
 * effects; a `reject` short-circuits the pass and throws a 409; `hold` verdicts
 * are COLLECTED across the whole pass rather than short-circuiting, so the
 * provider and model a held row freezes are the ones the whole chain agreed
 * on. The operation proceeds only when a pass yields no holds.
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
  const gates = orderedGates(deps, provider, request.stage).filter(
    (gate) => gate.pluginId !== request.release?.skipPluginId,
  );
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
    const holds: DispatchGateHoldVerdict[] = [];

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
        `${request.stage} dispatch gate`,
        () =>
          decideWithinBox(
            async () => gate.handler(context),
            provider.decisionTimeoutMs,
          ),
      );
      if (!invocation.ok) {
        throw dispatchGateFailure(gate.pluginId, request.stage, invocation.error);
      }
      if (!invocation.value.ok) {
        throw dispatchGateFailure(
          gate.pluginId,
          request.stage,
          invocation.value.error,
        );
      }
      const parsed = dispatchGateDecisionSchema.safeParse(
        invocation.value.value,
      );
      if (!parsed.success) {
        throw dispatchGateFailure(
          gate.pluginId,
          request.stage,
          `returned an invalid verdict: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
        );
      }
      const decision = parsed.data;
      if (decision.action === "reject") {
        throw dispatchRejection(gate.pluginId, request.stage, decision.message);
      }
      if (decision.action === "hold") {
        holds.push({
          pluginId: gate.pluginId,
          reason: decision.reason,
          resumeAt: decision.resumeAt ?? null,
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

    const holder = holds[0];
    if (holder === undefined) {
      return { kind: "proceed", amendments };
    }
    if (request.release !== null) {
      noteDispatchReleaseReheld(request.release.hold.threadId);
    }
    return {
      kind: "hold",
      holder,
      additionalHolders: holds.slice(1),
      amendments,
    };
  });
}

/**
 * The hold reason for a pass, naming every plugin that voted to hold. The
 * first holder owns the row, so its reason leads; the rest are appended so the
 * user sees the whole picture on one card rather than one card per gate.
 */
export function dispatchHoldReasonForPass(
  outcome: Extract<DispatchGatePassOutcome, { kind: "hold" }>,
): string {
  const extra = outcome.additionalHolders
    .map((entry) => `${entry.pluginId}: ${entry.reason}`)
    .join("; ");
  const reason = extra.length === 0
    ? outcome.holder.reason
    : `${outcome.holder.reason} (also held by ${extra})`;
  return reason.length > 200 ? `${reason.slice(0, 199)}…` : reason;
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
