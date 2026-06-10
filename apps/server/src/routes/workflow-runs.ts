// Public workflow surfaces (plan §7): registry listings, run launch with
// boundary-resolved defaults and clientRequestId idempotency, run reads
// (list/detail/events), the wait-to-terminal long-poll, cancel/resume
// requests (routes only ever call the lifecycle `request*` functions), and
// the daemon-proxied per-agent provider-event log.

import {
  createWorkflowRun,
  getWorkflowRun,
  getWorkflowRunByClientRequestId,
  listWorkflowRunEvents,
  listWorkflowRuns,
  markWorkflowRunUserArchived,
  markWorkflowRunUserDeleted,
  type WorkflowRunRow,
} from "@bb/db";
import {
  isTerminalWorkflowRunStatus,
  parseThreadEventRow,
  workflowRunEventSchema,
  type ThreadEventRow,
  type WorkflowRunEvent,
  type WorkflowRunSourceTier,
} from "@bb/domain";
import {
  createWorkflowRunRequestSchema,
  typedRoutes,
  workflowListQuerySchema,
  workflowRunEventsQuerySchema,
  workflowRunListQuerySchema,
  workflowRunWaitQuerySchema,
  type CreateWorkflowRunRequest,
  type CreateWorkflowRunSource,
  type PublicApiSchema,
  type WorkflowRunEventRowResponse,
  type WorkflowRunResponse,
} from "@bb/server-contract";
import type { Hono } from "hono";
import path from "node:path";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import {
  decodeDaemonFileContent,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import { ensureHostSessionReadyForWork } from "../services/hosts/host-lifecycle.js";
import { callHostRetryableOnlineRpc } from "../services/hosts/online-rpc.js";
import {
  requirePublicProject,
  requirePublicThread,
  requirePublicThreadEnvironment,
  requirePublicWorkflowRun,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { parseOptionalInteger } from "../services/lib/validation.js";
import {
  resolveProjectSourcePath,
  type ResolvedHostPath,
} from "../services/projects/project-source-path.js";
import { parseWorkflowRunProgressSnapshotColumn } from "../services/workflows/workflow-run-anchor.js";
import {
  requestWorkflowRunCancel,
  requestWorkflowRunResume,
  requestWorkflowRunStart,
} from "../services/workflows/workflow-run-lifecycle.js";
import {
  buildWorkflowRunCreateInput,
  getEffectiveProjectWorkflowPolicy,
  type WorkflowRunDefaultOverrides,
} from "../services/workflows/workflow-run-policy.js";
import {
  listHostWorkflows,
  resolveNamedWorkflowForLaunch,
  validateWorkflowScriptSource,
  type ValidatedWorkflowScript,
} from "../services/workflows/workflow-registry.js";

const WORKFLOW_RUN_WAIT_DEFAULT_MS = 30_000;
const WORKFLOW_RUN_WAIT_MAX_MS = 60_000;

function toWorkflowRunResponse(run: WorkflowRunRow): WorkflowRunResponse {
  return {
    id: run.id,
    projectId: run.projectId,
    hostId: run.hostId,
    workspacePath: run.workspacePath,
    anchorThreadId: run.anchorThreadId,
    workflowName: run.workflowName,
    sourceTier: run.sourceTier,
    scriptHash: run.scriptHash,
    argsJson: run.argsJson,
    seed: run.seed,
    keyVersion: run.keyVersion,
    providerId: run.providerId,
    model: run.model,
    effort: run.effort,
    sandbox: run.sandbox,
    concurrency: run.concurrency,
    maxAgents: run.maxAgents,
    maxFanout: run.maxFanout,
    budgetOutputTokens: run.budgetOutputTokens,
    status: run.status,
    failureReason: run.failureReason,
    progressSnapshot:
      parseWorkflowRunProgressSnapshotColumn(run.progressSnapshot) ?? null,
    usage: {
      inputTokens: run.usageInputTokens,
      outputTokens: run.usageOutputTokens,
      toolUses: run.usageToolUses,
      durationMs: run.usageDurationMs,
    },
    resultJson: run.resultJson,
    retention: run.retention,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    settledAt: run.settledAt,
    updatedAt: run.updatedAt,
  };
}

/**
 * Tolerant payload reader for the public events route (the
 * `parseWorkflowRunProgressSnapshotColumn` stance): one unreadable row must
 * not 500 the whole event stream, so it is skipped with a warning instead.
 */
function parseWorkflowRunEventPayload(payload: string): WorkflowRunEvent | null {
  try {
    const parsed = workflowRunEventSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface ResolvedLaunchScript {
  script: ValidatedWorkflowScript;
  sourceTier: WorkflowRunSourceTier;
}

interface ResolveLaunchScriptArgs {
  source: CreateWorkflowRunSource;
  /**
   * The launch target resolved once at the route boundary — the same
   * {hostId, path} the run row persists, so the recorded provenance always
   * matches the source root a named script was resolved against.
   */
  target: ResolvedHostPath;
}

/**
 * Resolve and validate the launch source. Inline source validates with no
 * host round-trip; named source resolves through the registry gate against
 * the server-resolved source root, deriving `sourceTier` from the winning
 * listing's registry tier (the recorded M3 note — `workflow.resolve` returns
 * raw source only, so the tier comes from `workflow.list`).
 */
async function resolveLaunchScript(
  deps: AppDeps,
  args: ResolveLaunchScriptArgs,
): Promise<ResolvedLaunchScript> {
  if (args.source.type === "inline") {
    return {
      script: validateWorkflowScriptSource(args.source.script),
      sourceTier: "inline",
    };
  }
  const resolved = await resolveNamedWorkflowForLaunch(deps, {
    hostId: args.target.hostId,
    name: args.source.name,
    rootPath: args.target.path,
  });
  return { script: resolved.script, sourceTier: resolved.tier };
}

interface ResolveWorkflowRunLaunchTargetArgs {
  /** Route-validated anchor thread id; null = unanchored launch. */
  anchorThreadId: string | null;
  /** Explicit launch host; null = inherit (anchored) or the default source. */
  hostId: string | null;
  projectId: string;
}

/**
 * Launch-target resolution (plan §7), exactly once at the route boundary:
 * an explicit `hostId` always wins and resolves the project's source on that
 * host; an anchored launch without an explicit host inherits
 * `{hostId, workspacePath}` from the anchor thread's environment — the
 * calling thread's own checkout, so a worktree thread's run resolves that
 * worktree's `.bb/workflows` — failing explicitly with the standard
 * environment errors (409 `thread_environment_unavailable` /
 * `environment_not_ready`) rather than silently falling back to the project
 * source, which would be implicit host selection; an unanchored launch
 * without a host resolves the project's default source.
 */
function resolveWorkflowRunLaunchTarget(
  deps: AppDeps,
  args: ResolveWorkflowRunLaunchTargetArgs,
): ResolvedHostPath {
  if (args.hostId === null && args.anchorThreadId !== null) {
    const { environment } = requirePublicThreadEnvironment(
      deps.db,
      args.anchorThreadId,
    );
    const ready = requireReadyEnvironment(deps.db, environment.id);
    return { hostId: ready.hostId, path: ready.path };
  }
  return resolveProjectSourcePath(deps, {
    projectId: args.projectId,
    hostId: args.hostId,
  });
}

function buildLaunchOverrides(
  payload: CreateWorkflowRunRequest,
): WorkflowRunDefaultOverrides {
  return {
    ...(payload.providerId !== undefined
      ? { providerId: payload.providerId }
      : {}),
    ...(payload.model !== undefined ? { model: payload.model } : {}),
    ...(payload.effort !== undefined ? { effort: payload.effort } : {}),
    ...(payload.sandbox !== undefined ? { sandbox: payload.sandbox } : {}),
    ...(payload.budgetOutputTokens !== undefined
      ? { budgetOutputTokens: payload.budgetOutputTokens }
      : {}),
  };
}

/**
 * Archive/delete are settled-run actions: a `created`/`starting`/`running`
 * run must be cancelled first so the lifecycle (not a metadata flip) is what
 * stops work. `interrupted` counts as settled — abandoning a paused run is
 * exactly what archive/delete are for, at the cost of its resumability.
 */
function requireSettledWorkflowRun(run: WorkflowRunRow): void {
  if (!isTerminalWorkflowRunStatus(run.status) && run.status !== "interrupted") {
    throw new ApiError(
      409,
      "workflow_run_not_settled",
      "Workflow run is still active; cancel it first",
    );
  }
}

/**
 * clientRequestId idempotency demands an identical request: a retried POST
 * carrying the same key with a different source, args, anchor, host, or
 * explicit override is a buggy client whose "new" launch would otherwise
 * silently never run, so it conflicts (409) instead of replaying. Omitted
 * optional fields always match — omission means "default"/"no override",
 * which is consistent with whatever the original launch resolved. Named
 * sources compare by registry name (on-disk content drift between retries is
 * still the same client request); explicit overrides compare against the
 * persisted resolved columns. Returns the divergent field name, or null when
 * the replay matches.
 */
function findDivergentReplayField(
  run: WorkflowRunRow,
  payload: CreateWorkflowRunRequest,
): string | null {
  if (run.projectId !== payload.projectId) return "projectId";
  if (payload.source.type === "inline") {
    if (
      run.sourceTier !== "inline" ||
      run.scriptSource !== payload.source.script
    ) {
      return "source";
    }
  } else if (
    run.sourceTier === "inline" ||
    run.workflowName !== payload.source.name
  ) {
    return "source";
  }
  const argsJson =
    payload.args === undefined ? null : JSON.stringify(payload.args);
  if (argsJson !== run.argsJson) return "args";
  if ((payload.anchorThreadId ?? null) !== run.anchorThreadId) {
    return "anchorThreadId";
  }
  if (payload.hostId !== undefined && payload.hostId !== run.hostId) {
    return "hostId";
  }
  if (
    payload.providerId !== undefined &&
    payload.providerId !== run.providerId
  ) {
    return "providerId";
  }
  if (payload.model !== undefined && payload.model !== run.model) {
    return "model";
  }
  if (payload.effort !== undefined && payload.effort !== run.effort) {
    return "effort";
  }
  if (payload.sandbox !== undefined && payload.sandbox !== run.sandbox) {
    return "sandbox";
  }
  if (
    payload.budgetOutputTokens !== undefined &&
    payload.budgetOutputTokens !== run.budgetOutputTokens
  ) {
    return "budgetOutputTokens";
  }
  return null;
}

/**
 * clientRequestId replay: reject divergent payloads, then return the original
 * run. A replay that lost the race between create and start (run still
 * `created`) re-requests the start, so a crash-and-retry launch self-heals
 * instead of stranding the run.
 */
async function startReplayedWorkflowRun(
  deps: AppDeps,
  run: WorkflowRunRow,
  payload: CreateWorkflowRunRequest,
): Promise<void> {
  const divergentField = findDivergentReplayField(run, payload);
  if (divergentField !== null) {
    throw new ApiError(
      409,
      "invalid_request",
      `clientRequestId was already used by a launch with a different ${divergentField}`,
    );
  }
  if (run.status === "created") {
    await requestWorkflowRunStart(deps, { runId: run.id });
  }
}

export function registerWorkflowRunRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/workflows", workflowListQuerySchema, async (context, query) => {
    requirePublicProject(deps.db, query.projectId);
    const target = resolveProjectSourcePath(deps, {
      projectId: query.projectId,
      hostId: query.hostId ?? null,
    });
    const workflows = await listHostWorkflows(deps, {
      hostId: target.hostId,
      rootPath: target.path,
    });
    return context.json(workflows);
  });

  get("/workflow-runs", workflowRunListQuerySchema, (context, query) => {
    const projectId = query.projectId ?? null;
    if (projectId !== null) {
      requirePublicProject(deps.db, projectId);
    }
    const limit = parseOptionalInteger(query.limit, "limit");
    if (limit !== undefined && limit <= 0) {
      throw new ApiError(400, "invalid_request", "limit must be positive");
    }
    const runs = listWorkflowRuns(deps.db, {
      projectId,
      ...(limit !== undefined ? { limit } : {}),
    });
    return context.json(runs.map(toWorkflowRunResponse));
  });

  post(
    "/workflow-runs",
    createWorkflowRunRequestSchema,
    async (context, payload) => {
      requirePublicProject(deps.db, payload.projectId);
      const anchorThreadId = payload.anchorThreadId ?? null;
      if (anchorThreadId !== null) {
        const anchorThread = requirePublicThread(deps.db, anchorThreadId);
        if (anchorThread.projectId !== payload.projectId) {
          throw new ApiError(
            400,
            "invalid_request",
            "Anchor thread belongs to a different project",
          );
        }
      }

      const clientRequestId = payload.clientRequestId ?? null;
      if (clientRequestId !== null) {
        // Cheap replay fast-path before any validation or host round-trip.
        const existing = getWorkflowRunByClientRequestId(
          deps.db,
          clientRequestId,
        );
        if (existing) {
          await startReplayedWorkflowRun(deps, existing, payload);
          const fresh = getWorkflowRun(deps.db, existing.id) ?? existing;
          return context.json(toWorkflowRunResponse(fresh), 201);
        }
      }

      // One launch-target resolution for both the named-source registry root
      // and the persisted hostId/workspacePath (a concurrent default-source
      // change can never make the run's provenance disagree with its target).
      const launchTarget = resolveWorkflowRunLaunchTarget(deps, {
        anchorThreadId,
        hostId: payload.hostId ?? null,
        projectId: payload.projectId,
      });
      const resolved = await resolveLaunchScript(deps, {
        source: payload.source,
        target: launchTarget,
      });
      const input = buildWorkflowRunCreateInput({
        projectId: payload.projectId,
        launchTarget,
        anchorThreadId,
        argsJson:
          payload.args === undefined ? null : JSON.stringify(payload.args),
        clientRequestId,
        overrides: buildLaunchOverrides(payload),
        // Effective per-project policy, resolved once here at the boundary:
        // the sandbox ceiling gates the resolved run default (422) and is
        // snapshotted on the run row for the executor's per-call enforcement.
        projectPolicy: getEffectiveProjectWorkflowPolicy(
          deps.db,
          payload.projectId,
        ),
        script: resolved.script,
        sourceTier: resolved.sourceTier,
      });

      // Get-or-create inside one immediate transaction: a concurrent retry
      // with the same clientRequestId must return the same run, never a
      // unique-constraint 500 or a double-created run.
      const created = deps.db.transaction(
        (tx) => {
          if (clientRequestId !== null) {
            const existing = getWorkflowRunByClientRequestId(
              tx,
              clientRequestId,
            );
            if (existing) {
              return { run: existing, replayed: true as const };
            }
          }
          return { run: createWorkflowRun(tx, input), replayed: false as const };
        },
        { behavior: "immediate" },
      );

      if (created.replayed) {
        await startReplayedWorkflowRun(deps, created.run, payload);
      } else {
        await requestWorkflowRunStart(deps, { runId: created.run.id });
      }
      const fresh = getWorkflowRun(deps.db, created.run.id) ?? created.run;
      return context.json(toWorkflowRunResponse(fresh), 201);
    },
  );

  get("/workflow-runs/:id", (context) => {
    const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
    return context.json(toWorkflowRunResponse(run));
  });

  get(
    "/workflow-runs/:id/events",
    workflowRunEventsQuerySchema,
    (context, query) => {
      const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
      const afterSequence = parseOptionalInteger(query.afterSeq, "afterSeq");
      const rows = listWorkflowRunEvents(deps.db, {
        runId: run.id,
        ...(afterSequence !== undefined ? { afterSequence } : {}),
      });

      const responses: WorkflowRunEventRowResponse[] = [];
      for (const row of rows) {
        const event = parseWorkflowRunEventPayload(row.payload);
        if (!event) {
          deps.logger.warn(
            { runId: run.id, sequence: row.sequence },
            "Skipped workflow run event with unreadable payload",
          );
          continue;
        }
        responses.push({
          sequence: row.sequence,
          agentIndex: row.agentIndex,
          createdAt: row.createdAt,
          event,
        });
      }
      return context.json(responses);
    },
  );

  get(
    "/workflow-runs/:id/wait",
    workflowRunWaitQuerySchema,
    async (context, query) => {
      const runId = requirePublicWorkflowRun(
        deps.db,
        context.req.param("id"),
      ).id;
      const waitMs = Math.min(
        parseOptionalInteger(query.waitMs, "waitMs") ??
          WORKFLOW_RUN_WAIT_DEFAULT_MS,
        WORKFLOW_RUN_WAIT_MAX_MS,
      );

      const findTerminal = () => {
        const run = getWorkflowRun(deps.db, runId);
        return run && isTerminalWorkflowRunStatus(run.status) ? run : null;
      };

      // Register-then-recheck (the /threads/:id/events/wait discipline): a
      // notify landing between the check and the registration must not be
      // missed.
      const deadline = Date.now() + waitMs;
      let match = findTerminal();
      while (!match) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const waiter = deps.hub.registerWorkflowRunWaiter(runId, remaining);
        match = findTerminal();
        if (match) {
          waiter.cancel();
          break;
        }
        await waiter.promise;
        match = findTerminal();
      }

      if (!match) {
        return new Response(null, { status: 204 });
      }
      return context.json(toWorkflowRunResponse(match));
    },
  );

  post("/workflow-runs/:id/cancel", async (context) => {
    const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
    await requestWorkflowRunCancel(deps, { runId: run.id });
    return context.json({ ok: true });
  });

  post("/workflow-runs/:id/resume", async (context) => {
    const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
    await requestWorkflowRunResume(deps, { runId: run.id });
    return context.json({ ok: true });
  });

  post("/workflow-runs/:id/archive", (context) => {
    const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
    requireSettledWorkflowRun(run);
    markWorkflowRunUserArchived(deps.db, { id: run.id });
    deps.hub.notifyWorkflowRun(run.id, ["run-updated"]);
    return context.json({ ok: true });
  });

  del("/workflow-runs/:id", (context) => {
    const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
    requireSettledWorkflowRun(run);
    markWorkflowRunUserDeleted(deps.db, { id: run.id });
    deps.hub.notifyWorkflowRun(run.id, ["run-updated"]);
    return context.json({ ok: true });
  });

  get("/workflow-runs/:id/agents/:index/events", async (context) => {
    const run = requirePublicWorkflowRun(deps.db, context.req.param("id"));
    const agentIndex = context.req.param("index");
    if (!/^\d+$/.test(agentIndex)) {
      throw new ApiError(400, "invalid_request", "Invalid agent index");
    }

    // The per-agent log lives in the run dir on the run's host
    // (`<dataDir>/workflow-runs/<runId>/agents/<index>.events.jsonl`,
    // ThreadEventRow JSON lines appended by the workflow agent executor).
    const session = await ensureHostSessionReadyForWork(deps, {
      hostId: run.hostId,
    });
    let result;
    try {
      result = await callHostRetryableOnlineRpc(deps, {
        hostId: run.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file_relative",
          rootPath: path.join(session.dataDir, "workflow-runs", run.id),
          path: `agents/${agentIndex}.events.jsonl`,
          dotfiles: "deny",
        },
      });
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }

    const text = new TextDecoder().decode(decodeDaemonFileContent(result));
    const events: ThreadEventRow[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      // Tolerate a torn tail line: the executor appends to a live log, so the
      // last line may be mid-write when the read lands.
      try {
        events.push(parseThreadEventRow(JSON.parse(line)));
      } catch {
        deps.logger.warn(
          { runId: run.id, agentIndex },
          "Skipped unparsable workflow agent event log line",
        );
      }
    }
    return context.json(events);
  });
}
