import { useCallback, useMemo, useState } from "react";
import {
  reconcileModelOptionValues,
  type ModelOptionValues,
  type ProviderInfo,
  type ProviderModelOption,
} from "@bb/domain";
import { usePromptBoxModelOptionsPreference } from "./persisted-selection-fields";

const EMPTY_MODEL_OPTION_DECLARATIONS: readonly ProviderModelOption[] = [];

export interface ModelOptionSelection {
  declarations: readonly ProviderModelOption[];
  values: ModelOptionValues;
  setValues: (values: ModelOptionValues) => void;
  requestValues: ModelOptionValues | undefined;
}

export function useModelOptionSelection(args: {
  scope: "new-thread" | "thread";
  provider: Pick<ProviderInfo, "id" | "experimental_modelOptions"> | undefined;
  initialValues?: Readonly<Record<string, string>>;
  resetKey?: string | number | null;
}): ModelOptionSelection {
  const { scope, provider, initialValues, resetKey } = args;
  const providerId = provider?.id ?? "";
  const declarations =
    provider?.experimental_modelOptions ?? EMPTY_MODEL_OPTION_DECLARATIONS;
  const { value: storedValues, setValue: setStoredValues } =
    usePromptBoxModelOptionsPreference(
      scope === "new-thread" ? providerId : "",
    );
  const localKey = `${resetKey ?? ""}:${providerId}`;
  const [local, setLocal] = useState<{
    key: string;
    values: ModelOptionValues;
  } | null>(null);
  const localValues = local?.key === localKey ? local.values : null;
  const chosenValues = scope === "new-thread" ? storedValues : localValues;
  const values = useMemo(
    () => reconcileModelOptionValues(provider, chosenValues ?? initialValues),
    [chosenValues, initialValues, provider],
  );
  const setValues = useCallback(
    (nextValues: ModelOptionValues) => {
      if (scope === "new-thread") {
        setStoredValues(nextValues);
        return;
      }
      setLocal({ key: localKey, values: nextValues });
    },
    [localKey, scope, setStoredValues],
  );
  const requestValues =
    declarations.length === 0
      ? undefined
      : scope === "new-thread" || localValues !== null
        ? values
        : undefined;
  return { declarations, values, setValues, requestValues };
}
