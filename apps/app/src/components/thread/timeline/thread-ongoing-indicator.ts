import { isRunningThreadRuntimeDisplayStatus } from "@bb/client-core";
import type { ThreadRuntimeDisplayStatus } from "@bb/domain";

export function resolveThreadOngoingIndicator({
  activeBackgroundAgentCount,
  activeBackgroundCommandCount,
  activeWorkflowCount,
  displayStatus,
  isStopping,
  isTurnSubmitting,
  timelineLoading,
}: {
  activeBackgroundAgentCount: number;
  activeBackgroundCommandCount: number;
  activeWorkflowCount: number;
  displayStatus: ThreadRuntimeDisplayStatus;
  isStopping: boolean;
  isTurnSubmitting: boolean;
  timelineLoading: boolean;
}): { label: string | undefined; show: boolean } {
  const isProvisioningDisplayStatus =
    displayStatus === "provisioning" || displayStatus === "starting";
  const hasActiveBackgroundWork =
    activeWorkflowCount > 0 ||
    activeBackgroundCommandCount > 0 ||
    activeBackgroundAgentCount > 0;
  const backgroundOnlyIndicatorLabel =
    displayStatus === "idle" && hasActiveBackgroundWork
      ? "Background work running"
      : undefined;
  return {
    label: isProvisioningDisplayStatus
      ? "Provisioning thread..."
      : backgroundOnlyIndicatorLabel,
    show:
      !isStopping &&
      (isProvisioningDisplayStatus ||
        (!timelineLoading &&
          (isTurnSubmitting ||
            isRunningThreadRuntimeDisplayStatus(displayStatus) ||
            backgroundOnlyIndicatorLabel !== undefined))),
  };
}
