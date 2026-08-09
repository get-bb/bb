import { z } from "zod";

export const threadDashboardStatusValues = [
  "backlog",
  "in-progress",
  "in-review",
  "done",
  "canceled",
] as const;

export const threadDashboardStatusSchema = z.enum(threadDashboardStatusValues);
export type ThreadDashboardStatus = z.infer<typeof threadDashboardStatusSchema>;
