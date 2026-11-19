export interface PiModelRef {
  provider: string;
  id: string;
}

export type PiModelSelectionResult =
  | { kind: "resolved"; model: PiModelRef }
  | { kind: "missing"; error: Error }
  | { kind: "ambiguous"; error: Error };

function listedModels(models: readonly unknown[]): PiModelRef[] {
  return models.flatMap((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    "provider" in entry &&
    "id" in entry &&
    typeof entry.provider === "string" &&
    typeof entry.id === "string"
      ? [{ provider: entry.provider, id: entry.id }]
      : [],
  );
}

export function resolvePiModelSelection(
  selection: string,
  available: readonly unknown[],
): PiModelSelectionResult {
  const models = listedModels(available);
  const canonical = models.find(
    (model) => `${model.provider}/${model.id}` === selection,
  );
  if (canonical) return { kind: "resolved", model: canonical };
  const served = models.filter((model) => model.id === selection);
  if (served.length > 1) {
    return {
      kind: "ambiguous",
      error: new Error(
        `Ambiguous Pi model "${selection}": served by ${served
          .map((model) => model.provider)
          .join(", ")}. Prefix it with the provider you want.`,
      ),
    };
  }
  const match = served[0];
  return match
    ? { kind: "resolved", model: match }
    : {
        kind: "missing",
        error: new Error(`Failed to resolve Pi model "${selection}"`),
      };
}
