import type { PluginContext } from "../../lib/context.js";
import {
  ActionServiceError,
  BENCH_ACTION_SERVICE,
  type ActionInvocationScope,
  type ScopedBenchAction,
} from "../../lib/agentic/action-allowlist.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { BENCH_DISPATCH_AMBIGUOUS_CODE } from "./ambiguity.js";
import { computeForgeArtifactHash } from "../firmware/forge/artifact-hash.js";
import { loadFirmwareReadiness } from "../firmware/forge/readiness.js";
import {
  BenchRunError,
  createDefaultBenchExecutionDeps,
  type BenchExecutionDeps,
} from "./execute/run.js";
import { startBenchRunAttempt } from "./execute/start-attempt.js";

interface MountRow {
  root_path: string;
  artifact_hash: string | null;
  file_count: number;
  materialized_files: number;
  error_count: number;
  state: string;
}

interface BenchRunIdentityRow {
  thread_id: string | null;
}

type BenchExecutionDepsFactory = typeof createDefaultBenchExecutionDeps;

function precondition(code: string, message: string): ActionServiceError {
  return new ActionServiceError(code, message, "precondition");
}

export function registerBenchAgentAction(
  ctx: PluginContext,
  remote: () => RemoteServices,
  jobQueue: BenchExecutionDeps["jobQueue"],
  createExecutionDeps: BenchExecutionDepsFactory = createDefaultBenchExecutionDeps,
): void {
  ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => ({
    async run(input, scope?: ActionInvocationScope) {
      if (!scope)
        throw precondition(
          "ACTION_SCOPE_REQUIRED",
          "An explicit action scope is required",
        );
      const thread = await ctx.bb.sdk.threads.get({
        threadId: scope.threadId,
        signal: scope.signal,
      });
      if (thread.projectId !== scope.projectId || !thread.environmentId) {
        throw precondition(
          "BENCH_ACTION_CONTEXT_INVALID",
          "The thread is not attached to a verified project environment",
        );
      }
      const environment = await ctx.bb.sdk.environments.get({
        environmentId: thread.environmentId,
        signal: scope.signal,
      });
      if (
        environment.projectId !== scope.projectId ||
        !environment.path ||
        !environment.hostId
      ) {
        throw precondition(
          "BENCH_ACTION_CONTEXT_INVALID",
          "A verified host worktree is required",
        );
      }
      const mount = ctx
        .db()
        .prepare<[string, string], MountRow>(
          `SELECT root_path, artifact_hash, file_count, materialized_files, error_count, state
           FROM firmware_mounts WHERE project_id=? AND project_version_id=?
          ORDER BY pulled_at DESC, generation_id DESC LIMIT 1`,
        )
        .get(scope.projectId, input.pvId);
      if (
        !mount ||
        mount.state !== "ready" ||
        mount.file_count === 0 ||
        mount.materialized_files !== mount.file_count ||
        mount.error_count !== 0
      ) {
        throw precondition(
          "MOUNT_INCOMPLETE",
          "Bench dispatch requires a fully materialized, error-free firmware mount",
        );
      }
      const readiness = await loadFirmwareReadiness(
        { worktreeRoot: environment.path },
        input.pvId,
      );
      const computed = await computeForgeArtifactHash(
        readiness.rootfsPath,
        scope.signal,
      );
      if (
        !mount.artifact_hash ||
        computed.artifactHash !== mount.artifact_hash
      ) {
        throw precondition(
          "FIRMWARE_DIGEST_MISMATCH",
          "Selected firmware bytes do not match the recorded artifact digest",
        );
      }
      const request = {
        projectId: scope.projectId,
        pvId: input.pvId,
        tier: input.tier === "tier1" ? ("tier1" as const) : ("tier0" as const),
        hostId: environment.hostId,
        ...(input.requirement ? { requirementId: input.requirement } : {}),
        ...(input.target ? { target: input.target } : {}),
      };
      const ownerDeps = createExecutionDeps(ctx, request, remote(), jobQueue);
      let durableRunId: string | undefined;
      const guardedDeps: BenchExecutionDeps = {
        ...ownerDeps,
        createRunId() {
          durableRunId = ownerDeps.createRunId();
          return durableRunId;
        },
      };
      try {
        const attempt = await startBenchRunAttempt(
          guardedDeps,
          request,
          scope.signal,
        );
        if (attempt.success) {
          return {
            runId: attempt.run.runId,
            threadId: attempt.run.threadId,
            status: attempt.run.status,
          };
        }
        const identity = ctx
          .db()
          .prepare<[string, string], BenchRunIdentityRow>(
            `SELECT thread_id FROM verification_runs
            WHERE project_id=? AND run_id=? AND kind='bench'
            ORDER BY synced_at DESC LIMIT 1`,
          )
          .get(scope.projectId, attempt.runId);
        throw new ActionServiceError(
          attempt.code,
          attempt.message,
          attempt.code === BENCH_DISPATCH_AMBIGUOUS_CODE
            ? "dispatch_ambiguous"
            : "failed",
          {
            runId: attempt.runId,
            ...(identity?.thread_id ? { threadId: identity.thread_id } : {}),
          },
        );
      } catch (error) {
        if (error instanceof ActionServiceError) throw error;
        if (durableRunId === undefined) {
          if (error instanceof BenchRunError) {
            throw precondition(error.code, error.message);
          }
          throw new ActionServiceError(
            "BENCH_PREFLIGHT_FAILED",
            "Bench preflight failed before a durable run was created.",
            "precondition",
          );
        }
        const identity = ctx
          .db()
          .prepare<[string, string], BenchRunIdentityRow>(
            `SELECT thread_id FROM verification_runs
            WHERE project_id=? AND run_id=? AND kind='bench'
            ORDER BY synced_at DESC LIMIT 1`,
          )
          .get(scope.projectId, durableRunId);
        throw new ActionServiceError(
          "bench_dispatch_ambiguous",
          "A durable bench run exists, but dispatch completion could not be established. Its liveness is unknown.",
          "dispatch_ambiguous",
          {
            runId: durableRunId,
            ...(identity?.thread_id ? { threadId: identity.thread_id } : {}),
          },
        );
      }
    },
  }));
}
