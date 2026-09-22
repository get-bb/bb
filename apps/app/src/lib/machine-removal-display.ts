import type { ThreadRuntimeState } from "@bb/domain";

export type MachineRemovalStatus = NonNullable<
  ThreadRuntimeState["machineRemoval"]
>["status"];

export const machineRemovalLabels: Record<MachineRemovalStatus, string> = {
  removed: "Machine removed",
  removing: "Machine removal in progress",
  "cleanup-failed": "Machine cleanup failed",
};

export const machineRemovalDescriptions: Record<MachineRemovalStatus, string> =
  {
    removed:
      "This thread’s machine was removed. You can still view its history.",
    removing:
      "This thread is unavailable while its machine is being removed. Its history will be preserved.",
    "cleanup-failed":
      "This thread is unavailable while machine cleanup is pending. Retry cleanup in machine settings.",
  };
