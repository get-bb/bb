import { availableModelSchema, type AvailableModel } from "@bb/domain";
import { z } from "zod";

const modelListResultSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
});

interface ParsedModelListResult {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}

export function parseAvailableModelList<TModelListResult>(
  result: TModelListResult,
): ParsedModelListResult {
  return modelListResultSchema.parse(result);
}
