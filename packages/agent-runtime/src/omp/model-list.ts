import { z } from "zod";
import type { AvailableModel } from "@bb/domain";

/**
 * omp (on-my-pi) owns its model registry and auth store (`~/.omp/agent`), so
 * model discovery is "ask omp, relay the answer." omp's RPC
 * `get_available_models` returns the entries its `ModelRegistry.getAvailable()`
 * considers selectable. The exact wire shape vary across omp versions, so we
 * validate defensively and map every entry that carries enough identity.
 */

// A single omp model entry. omp identifiers are usually `provider/modelId`
// (e.g. `anthropic/claude-sonnet-4-6`); some entries carry `provider` + `id`
// separately. We accept both and canonicalize below.
const ompModelEntrySchema = z
  .object({
    id: z.string().optional(),
    provider: z.string().optional(),
    name: z.string().optional(),
    contextWindow: z.number().optional(),
  })
  .passthrough();

export const ompAvailableModelsResultSchema = z.object({
  models: z.array(ompModelEntrySchema),
  selectedOnlyModels: z.array(ompModelEntrySchema).default([]),
});

export type OmpAvailableModelsResult = z.infer<
  typeof ompAvailableModelsResultSchema
>;

export type OmpRawModelEntry = z.infer<typeof ompModelEntrySchema>;

function canonicalOmpModelId(entry: OmpRawModelEntry): string | null {
  if (entry.id && entry.id.includes("/")) {
    return entry.id;
  }
  if (entry.id && entry.provider) {
    return `${entry.provider}/${entry.id}`;
  }
  return entry.id ?? null;
}

function toAvailableModel(entry: OmpRawModelEntry): AvailableModel | null {
  const model = canonicalOmpModelId(entry);
  if (!model) {
    return null;
  }
  return {
    id: model,
    model,
    displayName: entry.name ?? model,
    description: entry.name ?? model,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

/**
 * Parse the raw result relayed from the omp bridge's `model/list`. The bridge
 * forwards omp's `get_available_models` payload verbatim; this normalizes it to
 * bb's `AvailableModel[]`. Entries lacking a usable id are dropped.
 */
export function parseOmpAvailableModels(raw: unknown): {
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
} {
  // omp may answer with a bare array or a `{models, selectedOnlyModels}` object.
  const arrayParse = z.array(ompModelEntrySchema).safeParse(raw);
  if (arrayParse.success) {
    const models = arrayParse.data
      .map(toAvailableModel)
      .filter((m): m is AvailableModel => m !== null);
    return { models, selectedOnlyModels: [] };
  }

  const parsed = ompAvailableModelsResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { models: [], selectedOnlyModels: [] };
  }
  return {
    models: parsed.data.models
      .map(toAvailableModel)
      .filter((m): m is AvailableModel => m !== null),
    selectedOnlyModels: parsed.data.selectedOnlyModels
      .map(toAvailableModel)
      .filter((m): m is AvailableModel => m !== null),
  };
}
