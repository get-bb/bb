import { atom, useAtom, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { useCallback } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import {
  createTabScopedStorage,
  withLocalStorage,
} from "@/lib/browser-storage";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";

const MODEL_STORAGE_KEY = "bb.promptbox.model";
const SERVICE_TIER_STORAGE_KEY = "bb.promptbox.service-tier";
const REASONING_STORAGE_KEY = "bb.promptbox.reasoning";
const PERMISSION_MODE_STORAGE_KEY = "bb.promptbox.permission-mode";
const ENVIRONMENT_STORAGE_KEY = "bb.promptbox.environment";
const MACHINE_STORAGE_KEY = "bb.promptbox.machine";
const PROVIDER_STORAGE_KEY = "bb.promptbox.provider";
const PROVIDER_SELECTION_STORAGE_VERSION = "1";

export type StoredServiceTier = "" | ServiceTier;
export type StoredReasoningLevel = "" | ReasoningLevel;
export type StoredPermissionMode = "" | PermissionMode;

type StringSelectionSetter = (value: string) => void;
type StoredServiceTierSetter = (value: StoredServiceTier) => void;
type StoredReasoningLevelSetter = (value: StoredReasoningLevel) => void;
type StoredPermissionModeSetter = (value: StoredPermissionMode) => void;

interface PersistedStringSelectionField {
  setValue: StringSelectionSetter;
  value: string;
}

interface PersistedServiceTierSelectionField {
  setValue: StoredServiceTierSetter;
  value: StoredServiceTier;
}

interface PersistedReasoningLevelSelectionField {
  setValue: StoredReasoningLevelSetter;
  value: StoredReasoningLevel;
}

interface PersistedPermissionModeSelectionField {
  setValue: StoredPermissionModeSetter;
  value: StoredPermissionMode;
}

interface PromptBoxProviderModelReasoningPreference {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
}

function isReasoningLevel(value: string): value is ReasoningLevel {
  return (
    value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "ultracode" ||
    value === "max" ||
    value === "ultra"
  );
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === "accept-edits" || value === "auto" || value === "full";
}

function isServiceTier(value: string): value is ServiceTier {
  return value === "fast" || value === "default";
}

function isStoredServiceTier(value: string): value is StoredServiceTier {
  return value === "" || isServiceTier(value);
}

function isStoredReasoningLevel(value: string): value is StoredReasoningLevel {
  return value === "" || isReasoningLevel(value);
}

function isStoredPermissionMode(value: string): value is StoredPermissionMode {
  return value === "" || isPermissionMode(value);
}

const stringSelectionStorage = createTabScopedStorage<string>(
  {
    parse: (value, initialValue) => value ?? initialValue,
    serialize: (value) => value,
  },
  { persistInitialValue: true },
);

const providerIdAtom = atomWithStorage<string>(
  PROVIDER_STORAGE_KEY,
  "",
  stringSelectionStorage,
  { getOnInit: true },
);
const emptyModelAtom = atom("");
const emptyReasoningLevelAtom = atom<StoredReasoningLevel>("");

function getProviderSelectionStorageKey(
  storageKey: string,
  providerId: string,
): string {
  return `${storageKey}-${encodeURIComponent(providerId.trim())}-${PROVIDER_SELECTION_STORAGE_VERSION}`;
}

function getLegacyProviderSelection(
  providerId: string,
  storageKey: string,
): string | null {
  return withLocalStorage((storage) => {
    if (storage.getItem(PROVIDER_STORAGE_KEY) !== providerId) return null;
    return storage.getItem(storageKey);
  }, null);
}

function createProviderModelStorage(providerId: string) {
  return createTabScopedStorage<string>(
    {
      parse: (storedValue, initialValue) =>
        storedValue ??
        getLegacyProviderSelection(providerId, MODEL_STORAGE_KEY) ??
        initialValue,
      serialize: (value) => value,
    },
    { persistInitialValue: true },
  );
}

function createProviderReasoningStorage(providerId: string) {
  return createTabScopedStorage<StoredReasoningLevel>(
    {
      parse: (storedValue, initialValue) => {
        const value =
          storedValue ??
          getLegacyProviderSelection(providerId, REASONING_STORAGE_KEY);
        return value !== null && isStoredReasoningLevel(value)
          ? value
          : initialValue;
      },
      serialize: (value) => value,
    },
    { persistInitialValue: true },
  );
}

const modelAtomFamily = atomFamily((providerId: string) =>
  atomWithStorage<string>(
    getProviderSelectionStorageKey(MODEL_STORAGE_KEY, providerId),
    "",
    createProviderModelStorage(providerId),
    { getOnInit: true },
  ),
);
const serviceTierAtom = atomWithStorage<StoredServiceTier>(
  SERVICE_TIER_STORAGE_KEY,
  "",
  createTabScopedStorage<StoredServiceTier>(
    {
      parse: (value, initialValue) =>
        value !== null && isStoredServiceTier(value) ? value : initialValue,
      serialize: (value) => value,
    },
    { persistInitialValue: true },
  ),
  { getOnInit: true },
);
const reasoningLevelAtomFamily = atomFamily((providerId: string) =>
  atomWithStorage<StoredReasoningLevel>(
    getProviderSelectionStorageKey(REASONING_STORAGE_KEY, providerId),
    "",
    createProviderReasoningStorage(providerId),
    { getOnInit: true },
  ),
);
const permissionModePreferenceStorage =
  createTabScopedStorage<StoredPermissionMode>(
    {
      parse: (storedValue, initialValue) => {
        if (storedValue === "workspace-write") {
          return "accept-edits";
        }
        return storedValue !== null && isStoredPermissionMode(storedValue)
          ? storedValue
          : initialValue;
      },
      serialize: (value) => value,
    },
    { persistInitialValue: true },
  );

const permissionModeAtom = atomWithStorage<StoredPermissionMode>(
  PERMISSION_MODE_STORAGE_KEY,
  "",
  permissionModePreferenceStorage,
  { getOnInit: true },
);
const environmentSelectionAtom = atomWithStorage<string>(
  ENVIRONMENT_STORAGE_KEY,
  "",
  stringSelectionStorage,
  { getOnInit: true },
);
const projectEnvironmentSelectionAtomFamily = atomFamily((projectId: string) =>
  atomWithStorage<string>(
    getProjectScopedStorageKey(ENVIRONMENT_STORAGE_KEY, projectId),
    "",
    stringSelectionStorage,
    { getOnInit: true },
  ),
);

const machineSelectionAtomFamily = atomFamily((projectId: string) =>
  atomWithStorage<string>(
    getProjectScopedStorageKey(MACHINE_STORAGE_KEY, projectId),
    "",
    stringSelectionStorage,
    { getOnInit: true },
  ),
);

export function usePromptBoxMachinePreference(
  projectId: string,
): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(machineSelectionAtomFamily(projectId));
  const setValue = useCallback(
    (nextValue: string) => setAtomValue(nextValue),
    [setAtomValue],
  );
  return { value, setValue };
}

export function usePromptBoxProviderPreference(): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(providerIdAtom);
  const setValue = useCallback(
    (nextValue: string) => {
      if (nextValue !== value) {
        withLocalStorage((storage) => {
          storage.removeItem(MODEL_STORAGE_KEY);
          storage.removeItem(REASONING_STORAGE_KEY);
        }, undefined);
      }
      setAtomValue(nextValue);
    },
    [setAtomValue, value],
  );
  return { setValue, value };
}

export function usePromptBoxModelPreference(
  providerId: string,
): PersistedStringSelectionField {
  const selectionAtom = providerId
    ? modelAtomFamily(providerId)
    : emptyModelAtom;
  const [value, setAtomValue] = useAtom(selectionAtom);
  const setValue = useCallback(
    (nextValue: string) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePromptBoxServiceTierPreference(): PersistedServiceTierSelectionField {
  const [value, setAtomValue] = useAtom(serviceTierAtom);
  const setValue = useCallback(
    (nextValue: StoredServiceTier) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePromptBoxReasoningLevelPreference(
  providerId: string,
): PersistedReasoningLevelSelectionField {
  const selectionAtom = providerId
    ? reasoningLevelAtomFamily(providerId)
    : emptyReasoningLevelAtom;
  const [value, setAtomValue] = useAtom(selectionAtom);
  const setValue = useCallback(
    (nextValue: StoredReasoningLevel) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function useSetPromptBoxProviderModelReasoningPreference(): (
  preference: PromptBoxProviderModelReasoningPreference,
) => void {
  const store = useStore();
  return useCallback(
    ({ providerId, model, reasoningLevel }) => {
      if (providerId.length === 0) return;
      store.set(modelAtomFamily(providerId), model);
      store.set(reasoningLevelAtomFamily(providerId), reasoningLevel);
    },
    [store],
  );
}

export function usePromptBoxPermissionModePreference(): PersistedPermissionModeSelectionField {
  const [value, setAtomValue] = useAtom(permissionModeAtom);
  const setValue = useCallback(
    (nextValue: StoredPermissionMode) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePromptBoxEnvironmentPreference(
  projectId?: string | null,
): PersistedStringSelectionField {
  const normalizedProjectId = projectId?.trim();
  const atom =
    normalizedProjectId && normalizedProjectId.length > 0
      ? projectEnvironmentSelectionAtomFamily(normalizedProjectId)
      : environmentSelectionAtom;
  const [value, setAtomValue] = useAtom(atom);
  const setValue = useCallback(
    (nextValue: string) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}
