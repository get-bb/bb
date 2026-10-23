import { useCallback, useMemo } from "react";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { createTabScopedStorage } from "@/lib/browser-storage";

const ENVIRONMENT_INPUTS_STORAGE_KEY = "bb.promptbox.environment-inputs";
const ENVIRONMENT_INPUTS_STORAGE_VERSION = "1";

export interface EnvironmentInputsPreferenceScope {
  projectId: string;
  environmentValue: string;
  hostId: string | null;
}

const environmentInputsStorage = createTabScopedStorage<JsonValue | null>({
  parse: (storedValue, initialValue) => {
    if (storedValue === null) return initialValue;
    try {
      const parsed = jsonValueSchema.safeParse(JSON.parse(storedValue));
      return parsed.success ? parsed.data : initialValue;
    } catch {
      return initialValue;
    }
  },
  serialize: (value) => JSON.stringify(value),
});

function getEnvironmentInputsStorageKey({
  projectId,
  environmentValue,
  hostId,
}: EnvironmentInputsPreferenceScope): string {
  const scope = [projectId, environmentValue, hostId ?? ""]
    .map((segment) => encodeURIComponent(segment.trim()))
    .join(":");
  return `${ENVIRONMENT_INPUTS_STORAGE_KEY}-${scope}-${ENVIRONMENT_INPUTS_STORAGE_VERSION}`;
}

export function usePromptBoxEnvironmentInputsPreference(
  scope: EnvironmentInputsPreferenceScope | null,
): { value: JsonValue | null; setValue: (value: JsonValue) => void } {
  const storageKey =
    scope === null ? null : getEnvironmentInputsStorageKey(scope);
  const value = useMemo(
    () =>
      storageKey === null
        ? null
        : environmentInputsStorage.getItem(storageKey, null),
    [storageKey],
  );
  const setValue = useCallback(
    (nextValue: JsonValue) => {
      if (storageKey === null) return;
      environmentInputsStorage.setItem(storageKey, nextValue);
    },
    [storageKey],
  );
  return { value, setValue };
}
