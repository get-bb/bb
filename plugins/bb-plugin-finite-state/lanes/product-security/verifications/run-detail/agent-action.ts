import type Database from "better-sqlite3";
import type { PluginContext } from "../../../../lib/context.js";
import {
  ActionServiceError,
  VERIFICATION_ACTION_SERVICE,
  type ActionInvocationScope,
  type ScopedVerificationAction,
} from "../../../../lib/agentic/action-allowlist.js";
import type { AssuranceStudioClient } from "../../../../lib/remote/types.js";
import { runVerification } from "./actions.js";
import { isVerificationTier } from "../matrix/status.js";

interface MappedCheckRow {
  project_id: string;
  project_version_id: string;
  requirement_key: string;
  check_id: string;
}

function mappedCheck(
  db: Database.Database,
  input: { projectId: string; requirement: string; check?: string; tier?: string },
): MappedCheckRow {
  const tier = input.tier ?? null;
  const check = input.check ?? null;
  const rows = db.prepare<unknown[], MappedCheckRow>(
    `SELECT rcm.project_id, rcm.project_version_id, rcm.requirement_key, rcm.check_id
       FROM requirement_check_mappings rcm
       JOIN sync_state s
         ON s.project_id=rcm.project_id AND s.project_version_id=rcm.project_version_id
        AND s.entity_kind='requirement' AND s.accepted_generation_id=rcm.generation_id
       JOIN verification_checks vc
         ON vc.project_id=rcm.project_id AND vc.project_version_id=rcm.project_version_id
        AND vc.generation_id=rcm.generation_id AND vc.check_id=rcm.check_id
      WHERE rcm.project_id=? AND rcm.requirement_key=? AND rcm.suppressed=0
        AND (? IS NULL OR rcm.check_id=? OR vc.code=?)
        AND (? IS NULL OR CASE
          WHEN lower(vc.check_type) IN ('static','sca','sast','config') THEN 'static'
          WHEN lower(vc.check_type) IN ('dynamic','emulation','dast') THEN 'emulation'
          WHEN lower(vc.check_type) IN ('hil','hardware-in-loop') THEN 'hil'
          WHEN lower(vc.check_type) IN ('hardware','physical') THEN 'hardware'
          ELSE 'manual' END = ?)
      ORDER BY rcm.project_version_id, rcm.check_id LIMIT 2`,
  ).all(input.projectId, input.requirement, check, check, check, tier, tier);
  if (rows.length === 0) {
    throw new ActionServiceError("CHECK_REQUIRED", "No accepted mapped verification check matches the requirement and tier", "precondition");
  }
  if (rows.length > 1) {
    throw new ActionServiceError("VERIFICATION_CHECK_AMBIGUOUS", "Pass the exact check id", "precondition");
  }
  return rows[0]!;
}

export function registerVerificationAgentAction(
  ctx: PluginContext,
  client: Pick<AssuranceStudioClient, "runVerificationChecks">,
): void {
  ctx.service<ScopedVerificationAction>(VERIFICATION_ACTION_SERVICE, () => ({
    async run(input, scope?: ActionInvocationScope) {
      if (!scope) throw new ActionServiceError("ACTION_SCOPE_REQUIRED", "An explicit action scope is required", "precondition");
      if (input.tier !== undefined && !isVerificationTier(input.tier)) {
        throw new ActionServiceError("VERIFICATION_TIER_INVALID", "The verification tier is invalid", "precondition");
      }
      const selected = mappedCheck(ctx.db(), { projectId: scope.projectId, ...input });
      let first: { jobId: string } | null = null;
      try {
        for await (const job of runVerification({
          projectId: selected.project_id,
          client,
          maxPolls: 0,
          publish(update) {
            ctx.bb.realtime.publish("verifications:changed", {
              projectId: selected.project_id,
              jobId: update.jobId,
              state: update.state,
            });
          },
        }, { requirementId: selected.requirement_key, checkId: selected.check_id, ...(input.tier ? { tier: input.tier } : {}) })) {
          first ??= { jobId: job.jobId };
          break;
        }
      } catch {
        throw new ActionServiceError(
          "verification_dispatch_ambiguous",
          "Verification dispatch liveness is unknown.",
          "dispatch_ambiguous",
        );
      }
      if (!first) {
        throw new ActionServiceError(
          "verification_dispatch_ambiguous",
          "Verification dispatch returned no durable job id; liveness is unknown.",
          "dispatch_ambiguous",
        );
      }
      return { jobId: first.jobId };
    },
  }));
}
