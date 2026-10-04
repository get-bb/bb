import { z } from "zod";
import { automationAgentExecutionSchema } from "./rpc-types.js";

export const automationRunMarkerSchema = z.object({
  automationId: z.string(),
  projectId: z.string(),
  name: z.string(),
  runId: z.string(),
  execution: automationAgentExecutionSchema,
});
