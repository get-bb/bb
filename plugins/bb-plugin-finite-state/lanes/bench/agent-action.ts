import type { PluginContext } from "../../lib/context.js";
import {
  BENCH_ACTION_SERVICE,
  type ActionInvocationScope,
  type ScopedBenchAction,
} from "../../lib/agentic/action-allowlist.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { computeForgeArtifactHash } from "../firmware/forge/artifact-hash.js";
import { loadFirmwareReadiness } from "../firmware/forge/readiness.js";
import { createDefaultBenchExecutionDeps, runBench, type BenchExecutionDeps } from "./execute/run.js";

interface MountRow {
  root_path: string;
  artifact_hash: string | null;
  file_count: number;
  materialized_files: number;
  error_count: number;
  state: string;
}

export function registerBenchAgentAction(
  ctx: PluginContext,
  remote: () => RemoteServices,
  jobQueue: BenchExecutionDeps["jobQueue"],
): void {
  ctx.service<ScopedBenchAction>(BENCH_ACTION_SERVICE, () => ({
    async run(input, scope?: ActionInvocationScope) {
      if (!scope) throw new Error("ACTION_SCOPE_REQUIRED");
      const thread = await ctx.bb.sdk.threads.get({ threadId: scope.threadId, signal: scope.signal });
      if (thread.projectId !== scope.projectId || !thread.environmentId) throw new Error("BENCH_ACTION_CONTEXT_INVALID");
      const environment = await ctx.bb.sdk.environments.get({ environmentId: thread.environmentId, signal: scope.signal });
      if (environment.projectId !== scope.projectId || !environment.path || !environment.hostId) {
        throw new Error("BENCH_ACTION_CONTEXT_INVALID: a verified host worktree is required");
      }
      const mount = ctx.db().prepare<[string, string], MountRow>(
        `SELECT root_path, artifact_hash, file_count, materialized_files, error_count, state
           FROM firmware_mounts WHERE project_id=? AND project_version_id=?
          ORDER BY pulled_at DESC, generation_id DESC LIMIT 1`,
      ).get(scope.projectId, input.pvId);
      if (!mount || mount.state !== "ready" || mount.file_count === 0 || mount.materialized_files !== mount.file_count || mount.error_count !== 0) {
        throw new Error("MOUNT_INCOMPLETE: bench dispatch requires a fully materialized, error-free firmware mount");
      }
      const readiness = await loadFirmwareReadiness({ worktreeRoot: environment.path }, input.pvId);
      const computed = await computeForgeArtifactHash(readiness.rootfsPath, scope.signal);
      if (!mount.artifact_hash || computed.artifactHash !== mount.artifact_hash) {
        throw new Error("FIRMWARE_DIGEST_MISMATCH: selected firmware bytes do not match the recorded artifact digest");
      }
      const request = {
        projectId: scope.projectId,
        pvId: input.pvId,
        tier: input.tier === "tier1" ? "tier1" as const : "tier0" as const,
        hostId: environment.hostId,
        ...(input.requirement ? { requirementId: input.requirement } : {}),
        ...(input.target ? { target: input.target } : {}),
      };
      const started = await runBench(
        createDefaultBenchExecutionDeps(ctx, request, remote(), jobQueue),
        request,
        scope.signal,
      );
      return { runId: started.runId, threadId: started.threadId, status: started.status };
    },
  }));
}
