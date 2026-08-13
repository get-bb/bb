import { z } from "zod";
import {
  buildPiAvailableModels,
  type BuildPiAvailableModelsResult,
} from "../pi/model-list.js";

const PRIME_BASE_REASONING_LEVELS = ["low", "medium", "high"] as const;
const PRIME_EXTENDED_REASONING_LEVELS = ["xhigh", "max"] as const;

const primeAgentModelSchema = z
  .object({
    id: z.string().min(1),
    input: z.array(z.string()),
    name: z.string().min(1),
    provider: z.string().min(1),
    reasoning: z.boolean(),
    thinkingLevelMap: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const primeAgentModelListSchema = z.object({
  models: z.array(primeAgentModelSchema),
});

export function buildPrimeAgentAvailableModels(
  value: unknown,
): BuildPiAvailableModelsResult {
  const parsed = primeAgentModelListSchema.parse(value);
  return buildPiAvailableModels({
    agentDisplayName: "Prime Agent",
    models: parsed.models.map((model) => ({
      id: model.id,
      input: model.input,
      name: model.name,
      provider: model.provider,
      reasoning: model.reasoning,
      supportedThinkingLevels: model.reasoning
        ? [
            ...PRIME_BASE_REASONING_LEVELS.filter(
              (level) => model.thinkingLevelMap?.[level] !== null,
            ),
            ...PRIME_EXTENDED_REASONING_LEVELS.filter(
              (level) => model.thinkingLevelMap?.[level] != null,
            ),
          ]
        : [],
    })),
  });
}
