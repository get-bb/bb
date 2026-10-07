import { z } from "zod";
import type { AvailableModel, ProviderInfo } from "./provider-types.js";

export const modelOptionIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
export type ModelOptionId = z.infer<typeof modelOptionIdSchema>;

export const modelOptionValuesSchema = z.record(
  modelOptionIdSchema,
  modelOptionIdSchema,
);
export type ModelOptionValues = z.infer<typeof modelOptionValuesSchema>;

export const supportedModelOptionsSchema = z.record(
  modelOptionIdSchema,
  z.array(modelOptionIdSchema),
);
export type SupportedModelOptions = z.infer<typeof supportedModelOptionsSchema>;

export const providerModelOptionValueSchema = z.object({
  id: modelOptionIdSchema,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  modelUnavailableReason: z.string().min(1).optional(),
});
export type ProviderModelOptionValue = z.infer<
  typeof providerModelOptionValueSchema
>;

export const providerModelOptionSchema = z.object({
  id: modelOptionIdSchema,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  values: z.array(providerModelOptionValueSchema).min(2),
  defaultValue: modelOptionIdSchema,
});
export type ProviderModelOption = z.infer<typeof providerModelOptionSchema>;

type ModelOptionProviderSource = Pick<
  ProviderInfo,
  "experimental_modelOptions"
>;
type ModelOptionModelSource = Pick<
  AvailableModel,
  "experimental_supportedModelOptions"
>;

export const EMPTY_MODEL_OPTION_VALUES: ModelOptionValues = Object.freeze({});

export function providerModelOptions(
  provider: ModelOptionProviderSource | null | undefined,
): readonly ProviderModelOption[] {
  return provider?.experimental_modelOptions ?? [];
}

export function modelAcceptsOptionValue(
  model: ModelOptionModelSource | null | undefined,
  optionId: string,
  valueId: string,
): boolean {
  const accepted = model?.experimental_supportedModelOptions?.[optionId];
  return accepted === undefined || accepted.includes(valueId);
}

export function defaultModelOptionValues(
  provider: ModelOptionProviderSource | null | undefined,
): ModelOptionValues {
  return Object.fromEntries(
    providerModelOptions(provider).map((option) => [
      option.id,
      option.defaultValue,
    ]),
  );
}

export function reconcileModelOptionValues(
  provider: ModelOptionProviderSource | null | undefined,
  values: Readonly<Record<string, string>> | null | undefined,
): ModelOptionValues {
  return Object.fromEntries(
    providerModelOptions(provider).map((option) => {
      const requested = values?.[option.id];
      const declared = option.values.some((value) => value.id === requested);
      return [
        option.id,
        declared && requested !== undefined ? requested : option.defaultValue,
      ];
    }),
  );
}

export function visibleModelOptions(args: {
  provider: ModelOptionProviderSource | null | undefined;
  models: readonly ModelOptionModelSource[];
}): readonly ProviderModelOption[] {
  return providerModelOptions(args.provider).filter((option) =>
    option.values.some(
      (value) =>
        value.id !== option.defaultValue &&
        args.models.some(
          (model) =>
            model.experimental_supportedModelOptions?.[option.id]?.includes(
              value.id,
            ) === true,
        ),
    ),
  );
}

export function modelOptionConflictReason(args: {
  provider: ModelOptionProviderSource | null | undefined;
  model: ModelOptionModelSource | null | undefined;
  values: Readonly<Record<string, string>>;
}): string | null {
  for (const option of providerModelOptions(args.provider)) {
    const valueId = args.values[option.id] ?? option.defaultValue;
    if (modelAcceptsOptionValue(args.model, option.id, valueId)) {
      continue;
    }
    const value = option.values.find((candidate) => candidate.id === valueId);
    return (
      value?.modelUnavailableReason ??
      `Unavailable with ${option.label} ${value?.label ?? valueId}`
    );
  }
  return null;
}

export function findModelForOptionValues<
  TModel extends ModelOptionModelSource &
    Pick<AvailableModel, "model" | "isDefault">,
>(args: {
  provider: ModelOptionProviderSource | null | undefined;
  models: readonly TModel[];
  currentModel: string;
  values: Readonly<Record<string, string>>;
}): TModel | null {
  const compatible = args.models.filter(
    (model) =>
      modelOptionConflictReason({
        provider: args.provider,
        model,
        values: args.values,
      }) === null,
  );
  return (
    compatible.find((model) => model.model === args.currentModel) ??
    compatible.find((model) => model.isDefault) ??
    compatible[0] ??
    null
  );
}

export function serializeModelOptionValues(
  values: Readonly<Record<string, string>>,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(values)
        .sort()
        .map((optionId) => [optionId, values[optionId]]),
    ),
  );
}

export function parseStoredModelOptionValues(
  stored: string,
): ModelOptionValues {
  try {
    const parsed = modelOptionValuesSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
