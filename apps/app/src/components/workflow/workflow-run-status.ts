import { assertNever } from "@bb/core-ui";
import type { WorkflowRunStatus } from "@bb/domain";
import type { PillVariant } from "@/components/ui/pill.js";

/** One canonical status → Pill variant map for every workflow-run surface. */
export function workflowRunStatusPillVariant(
  status: WorkflowRunStatus,
): PillVariant {
  switch (status) {
    case "created":
    case "starting":
    case "completed":
      return "secondary";
    case "running":
      return "emphasis";
    case "failed":
      return "destructive";
    case "cancelled":
    case "interrupted":
      return "outline";
    default:
      return assertNever(status);
  }
}
