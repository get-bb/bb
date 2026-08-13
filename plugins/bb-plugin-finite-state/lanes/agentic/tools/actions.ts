import type { BbPluginApi, PluginAgentToolContext } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../lib/context.js";
import {
  ACTION_TOOL_ALLOWLIST,
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

const STATUS_HINT = "The dispatch outcome is ambiguous. Query the corresponding run/status surface using the returned durable id; do not dispatch a duplicate.";

function toolResponse(result: ToolResult<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    ...(!result.ok ? { isError: true } : {}),
  };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Action failed";
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
        bb.realtime.publish("verifications:changed", { projectId: call.projectId, jobId: result.jobId });
        audit(bb, "fs_verification_run", call, "result", { outcome: "queued", jobId: result.jobId, runId: result.runId });
        return toolResponse(ok({ job_id: result.jobId, ...(result.runId ? { run_id: result.runId } : {}), status: "queued", hint: "Refetch verification evidence by job id; queued is not passed evidence." }));
      } catch (error) {
        const message = safeMessage(error);
        audit(bb, "fs_verification_run", call, "result", { outcome: "error" });
        const ambiguous = /timeout|ambiguous|unknown outcome|connection|abort/iu.test(message);
        return toolResponse(fail(ambiguous ? "verification_dispatch_ambiguous" : "verification_action_failed", message, ambiguous ? STATUS_HINT : "Resolve the requirement/check mapping, then retry once.", false));
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
        const message = safeMessage(error);
        audit(bb, "fs_bench_run", call, "result", { outcome: "error" });
        const ambiguous = /timeout|ambiguous|unknown outcome|connection|abort/iu.test(message);
        return toolResponse(fail(ambiguous ? "bench_dispatch_ambiguous" : "bench_action_failed", message, ambiguous ? STATUS_HINT : "Fix the selected firmware mount or bench prerequisites before retrying.", false));
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
        const message = safeMessage(error);
        audit(bb, "fs_firmware_materialize", call, "result", { outcome: "error" });
        const admin = /403|admin|VIEW_ANY_PROJECT_FILE|permission/iu.test(message);
        const whole = input.mode === "hydrate_all";
        return toolResponse(fail(admin ? "firmware_admin_required" : "firmware_action_failed", message, admin || whole ? "Metadata remains available. Use local standalone unpack for a whole image, or ask an org admin for VIEW_ANY_PROJECT_FILE before hydrating explicit API files." : "Inspect firmware status and retry only the explicit failed paths.", false));
      }
    },
  });

  if (ACTION_TOOL_ALLOWLIST.length !== 8) throw new Error("ACTION_ALLOWLIST_AMENDMENT_REQUIRED");
}
