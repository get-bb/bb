import type {
  TimelineApprovalStatus,
  TimelineRowStatus,
} from "@bb/server-contract";

interface DisplayStatusArgs {
  approvalStatus: TimelineApprovalStatus;
  status: TimelineRowStatus;
}

export function displayWorkApprovalStatus({
  approvalStatus,
  status,
}: DisplayStatusArgs): "waiting" | "denied" | TimelineRowStatus {
  if (approvalStatus === "waiting_for_approval") {
    return "waiting";
  }
  if (approvalStatus === "denied") {
    return "denied";
  }
  return status;
}
