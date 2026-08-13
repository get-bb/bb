import type { BbPluginApi, PluginAgentToolContext } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../lib/context.js";
import {
  ActionServiceError,
  BENCH_ACTION_SERVICE,
  FIRMWARE_ACTION_SERVICE,
  VERIFICATION_ACTION_SERVICE,
  assertActionBoundary,
  requireActionService,
  type ScopedBenchAction,
  type ScopedFirmwareAction,
  type ScopedVerificationAction,
} from "../../../lib/agentic/action-allowlist.js";
import { AGENT_SURFACE } from "../../../lib/agentic/registry.js";
import { fail, ok } from "../../../lib/agentic/result.js";
import type { ToolResult } from "../../../lib/agentic/types.js";
import {
  benchActionSchema,
  firmwareActionSchema,
  verificationActionSchema,
} from "./action-schemas.js";

function toolResponse(result: ToolResult<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    ...(!result.ok ? { isError: true } : {}),
  };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Action failed";
}

function actionFailure(
  action: "verification" | "bench" | "firmware",
  error: unknown,
): ActionServiceError {
  if (error instanceof ActionServiceError) return error;
  if (action === "firmware") {
    return new ActionServiceError(
      "firmware_action_failed",
      safeMessage(error),
      "failed",
    );
  }
  return new ActionServiceError(
    `${action}_dispatch_ambiguous`,
    `${action === "bench" ? "Bench" : "Verification"} dispatch liveness is unknown.`,
    "dispatch_ambiguous",
  );
}

function ambiguityHint(error: ActionServiceError): string {
  if (error.ids.runId) {
    return `Query the corresponding run/status surface using run id ${error.ids.runId}; do not dispatch a duplicate.`;
  }
  if (error.ids.jobId) {
    return `Query the corresponding run/status surface using job id ${error.ids.jobId}; do not dispatch a duplicate.`;
  }
  return "No durable id was returned and dispatch liveness is unknown. Do not retry; inspect the corresponding status surface and owner-service logs before deciding whether another dispatch is safe.";
}

function failureHint(action: "verification" | "bench" | "firmware", error: ActionServiceError): string {
  if (error.kind === "dispatch_ambiguous") return ambiguityHint(error);
  if (action === "verification") return "Resolve the requirement/check mapping, then retry once.";
  if (action === "bench") return "Fix the selected firmware mount or bench prerequisites before retrying.";
  if (error.kind === "permission") {
    return "Metadata remains available. Use local standalone unpack for a whole image, or ask an org admin for VIEW_ANY_PROJECT_FILE before hydrating explicit API files.";
  }
  return "Inspect firmware status and retry only the explicit failed paths.";
}

function audit(
  bb: BbPluginApi,
  action: string,
  call: PluginAgentToolContext,
  phase: "start" | "result",
  fields: Record<string, string | number | undefined>,
): void {
  bb.log.info(JSON.stringify({
    event: "finite_state_agent_action",
    action,
    phase,
    actor: "agent",
    projectId: call.projectId,
    threadId: call.threadId,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  }));
}

function scope(call: PluginAgentToolContext) {
  return { projectId: call.projectId, threadId: call.threadId, signal: call.signal };
}

export function registerActionTools(bb: BbPluginApi, ctx: PluginContext): void {
  assertActionBoundary(AGENT_SURFACE);

  bb.agents.registerTool({
    name: "fs_verification_run",
    description: "Queue one mapped Assurance Studio verification check and return its durable job id without claiming a result.",
    parameters: verificationActionSchema,
    async execute(input, call) {
      audit(bb, "fs_verification_run", call, "start", {
        requirement: input.requirement,
        tier: input.tier,
        check: input.check,
      });
      try {
        const result = await requireActionService<ScopedVerificationAction>(ctx, VERIFICATION_ACTION_SERVICE)
          .run(input, scope(call));
        audit(bb, "fs_verification_run", call, "result", { outcome: "queued", jobId: result.jobId, runId: result.runId });
        return toolResponse(ok({ job_id: result.jobId, ...(result.runId ? { run_id: result.runId } : {}), status: "queued", hint: "Refetch verification evidence by job id; queued is not passed evidence." }));
      } catch (error) {
        const failure = actionFailure("verification", error);
        audit(bb, "fs_verification_run", call, "result", { outcome: "error", errorCode: failure.code, classification: failure.kind, jobId: failure.ids.jobId, runId: failure.ids.runId });
        return toolResponse(fail(failure.code, failure.message, failureHint("verification", failure), false, failure.ids));
      }
    },
  });

  bb.agents.registerTool({
    name: "fs_bench_run",
    description: "Dispatch one bench run after owner-side firmware digest and full-materialization preflight.",
    parameters: benchActionSchema,
    async execute(input, call) {
      audit(bb, "fs_bench_run", call, "start", { pvId: input.pvId, tier: input.tier, requirement: input.requirement, targetPresent: input.target ? 1 : 0 });
      try {
        const result = await requireActionService<ScopedBenchAction>(ctx, BENCH_ACTION_SERVICE)
          .run(input, scope(call));
        bb.realtime.publish("bench:changed", { projectId: call.projectId, runId: result.runId, status: result.status });
        audit(bb, "fs_bench_run", call, "result", { outcome: result.status, runId: result.runId, resultThreadId: result.threadId });
        return toolResponse(ok({ run_id: result.runId, thread_id: result.threadId, status: result.status }));
      } catch (error) {
        const failure = actionFailure("bench", error);
        audit(bb, "fs_bench_run", call, "result", { outcome: "error", errorCode: failure.code, classification: failure.kind, runId: failure.ids.runId, resultThreadId: failure.ids.threadId, jobId: failure.ids.jobId });
        return toolResponse(fail(failure.code, failure.message, failureHint("bench", failure), false, failure.ids));
      }
    },
  });

  bb.agents.registerTool({
    name: "fs_firmware_materialize",
    description: "Read firmware metadata or hydrate explicit files through the firmware owner; whole-image hydration requires local standalone unpack.",
    instructions: "For a whole image, lead with local standalone unpack. API hydration is an admin-gated explicit-file fallback.",
    parameters: firmwareActionSchema,
    async execute(input, call) {
      audit(bb, "fs_firmware_materialize", call, "start", { pvId: input.pvId, mode: input.mode, scanId: input.scanId, pathCount: input.paths?.length });
      try {
        const result = await requireActionService<ScopedFirmwareAction>(ctx, FIRMWARE_ACTION_SERVICE)
          .materialize(input, scope(call));
        bb.realtime.publish("firmware:changed", { pvId: result.pvId });
        audit(bb, "fs_firmware_materialize", call, "result", { outcome: "completed", source: result.source, hydrated: result.hydrated, remaining: result.remaining, errors: result.errors });
        return toolResponse(ok({ ...result, serverAccess: input.mode === "hydrate_all" ? "none" : "read-fetch" }));
      } catch (error) {
        const failure = actionFailure("firmware", error);
        audit(bb, "fs_firmware_materialize", call, "result", { outcome: "error", errorCode: failure.code, classification: failure.kind });
        const wholeImage = input.mode === "hydrate_all" && failure.kind !== "permission";
        const hint = wholeImage
          ? "Metadata remains available. Use local standalone unpack for a whole image before invoking hydrate_all."
          : failureHint("firmware", failure);
        return toolResponse(fail(failure.code, failure.message, hint, false));
      }
    },
  });
}
