import { z } from "zod";

export const threadStatusValues = [
  "idle",
  "starting",
  "active",
  "stopping",
  "error",
] as const;
export const threadStatusSchema = z.enum(threadStatusValues);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export function isThreadWaitTargetUnreachable(
  currentStatus: ThreadStatus,
  targetStatus: ThreadStatus,
): boolean {
  return targetStatus === "idle" && currentStatus === "error";
}
