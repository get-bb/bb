import { z } from "zod";
import type { JsonValue } from "@get-bb/plugin-sdk";

export const WORKFLOW_RUNS_REALTIME_CHANNEL = "workflow-runs";

const workflowRunsSignalPayloadSchema = z
  .object({ threadId: z.string().optional() })
  .passthrough();

export function workflowRunsSignalThreadId(payload: JsonValue): string | null {
  const parsed = workflowRunsSignalPayloadSchema.safeParse(payload);
  return parsed.success ? (parsed.data.threadId ?? null) : null;
}
