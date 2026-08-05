import { availableModelSchema, type AvailableModel } from "@bb/domain";
import { z } from "zod";

const modelListResultSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
  // Live per-agent capability from the ACP `initialize` handshake
  // (agentCapabilities.loadSession). Only ACP bridges set this; absent for
  // every other provider.
  supportsSessionImport: z.boolean().optional(),
});

export interface ParsedModelListResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  supportsSessionImport?: boolean;
}

export function parseAvailableModelList(
  result: unknown,
): ParsedModelListResult {
  return modelListResultSchema.parse(result);
}
