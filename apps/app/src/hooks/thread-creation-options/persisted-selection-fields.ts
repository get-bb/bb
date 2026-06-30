import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { useCallback } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import {
  createLocalStorageEnumStorage,
  rawStringLocalStorage,
} from "@/lib/browser-storage";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";

const MODEL_STORAGE_KEY = "bb.promptbox.model";
const SERVICE_TIER_STORAGE_KEY = "bb.promptbox.service-tier";
const REASONING_STORAGE_KEY = "bb.promptbox.reasoning";
const PERMISSION_MODE_STORAGE_KEY = "bb.promptbox.permission-mode";
const ENVIRONMENT_STORAGE_KEY = "bb.promptbox.environment";
const PROVIDER_STORAGE_KEY = "bb.promptbox.provider";

export type StoredServiceTier = "" | ServiceTier;
export type StoredReasoningLevel = "" | ReasoningLevel;
export type StoredPermissionMode = "" | PermissionMode;

type StringSelectionSetter = (value: string) => void;
type StoredServiceTierSetter = (value: StoredServiceTier) => void;
type StoredReasoningLevelSetter = (value: StoredReasoningLevel) => void;
type StoredPermissionModeSetter = (value: StoredPermissionMode) => void;

export interface PersistedStringSelectionField {
  setValue: StringSelectionSetter;
  value: string;
}

export interface PersistedServiceTierSelectionField {
  setValue: StoredServiceTierSetter;
  value: StoredServiceTier;
}

export interface PersistedReasoningLevelSelectionField {
  setValue: StoredReasoningLevelSetter;
  value: StoredReasoningLevel;
}

export interface PersistedPermissionModeSelectionField {
  setValue: StoredPermissionModeSetter;
  value: StoredPermissionMode;
}

function isReasoningLevel(value: string): value is ReasoningLevel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "ultracode" ||
    value === "max"
  );
}

function isPermissionMode(value: string): value is PermissionMode {
  return (
    value === "readonly" || value === "workspace-write" || value === "full"
  );
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

const providerIdAtom = atomWithStorage<string>(
  PROVIDER_STORAGE_KEY,
  "",
  rawStringLocalStorage,
  { getOnInit: true },
);
const modelAtom = atomWithStorage<string>(
  MODEL_STORAGE_KEY,
  "",
  rawStringLocalStorage,
  { getOnInit: true },
);
const serviceTierAtom = atomWithStorage<StoredServiceTier>(
  SERVICE_TIER_STORAGE_KEY,
  "",
  createLocalStorageEnumStorage(isStoredServiceTier),
  { getOnInit: true },
);
const reasoningLevelAtom = atomWithStorage<StoredReasoningLevel>(
  REASONING_STORAGE_KEY,
  "",
  createLocalStorageEnumStorage(isStoredReasoningLevel),
  { getOnInit: true },
);
const permissionModeAtom = atomWithStorage<StoredPermissionMode>(
  PERMISSION_MODE_STORAGE_KEY,
  "",
  createLocalStorageEnumStorage(isStoredPermissionMode),
  { getOnInit: true },
);
const environmentSelectionAtom = atomWithStorage<string>(
  ENVIRONMENT_STORAGE_KEY,
  "",
  rawStringLocalStorage,
  { getOnInit: true },
);
const projectEnvironmentSelectionAtomFamily = atomFamily((projectId: string) =>
  atomWithStorage<string>(
    getProjectScopedStorageKey(ENVIRONMENT_STORAGE_KEY, projectId),
    "",
    rawStringLocalStorage,
    { getOnInit: true },
  ),
);

export function usePromptBoxProviderPreference(): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(providerIdAtom);
  const setValue = useCallback(
    (nextValue: string) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePromptBoxModelPreference(): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(modelAtom);
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

export function usePromptBoxReasoningLevelPreference(): PersistedReasoningLevelSelectionField {
  const [value, setAtomValue] = useAtom(reasoningLevelAtom);
  const setValue = useCallback(
    (nextValue: StoredReasoningLevel) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
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
