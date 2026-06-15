import { useAtom } from "jotai";
import { useCallback } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import {
  createPersistedEnumAtom,
  createProjectScopedStorageAtomFamily,
  rawStringLocalStorage,
} from "@/lib/browser-storage";

const MODEL_STORAGE_KEY = "bb.promptbox.model";
const SERVICE_TIER_STORAGE_KEY = "bb.promptbox.service-tier";
const REASONING_STORAGE_KEY = "bb.promptbox.reasoning";
const PERMISSION_MODE_STORAGE_KEY = "bb.promptbox.permission-mode";
const ENVIRONMENT_STORAGE_KEY = "bb.promptbox.environment";
const PROVIDER_STORAGE_KEY = "bb.promptbox.provider";

export type StoredServiceTier = "" | ServiceTier;
export type StoredReasoningLevel = "" | ReasoningLevel;
export type StoredPermissionMode = "" | PermissionMode;

type ProjectScopedStorageParam = string | null | undefined;
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

const providerIdAtomFamily = createProjectScopedStorageAtomFamily(
  PROVIDER_STORAGE_KEY,
  "",
  rawStringLocalStorage,
);
const modelAtomFamily = createProjectScopedStorageAtomFamily(
  MODEL_STORAGE_KEY,
  "",
  rawStringLocalStorage,
);
const serviceTierAtomFamily = createPersistedEnumAtom<StoredServiceTier>({
  baseKey: SERVICE_TIER_STORAGE_KEY,
  initialValue: "",
  isValue: isStoredServiceTier,
});
const reasoningLevelAtomFamily = createPersistedEnumAtom<StoredReasoningLevel>({
  baseKey: REASONING_STORAGE_KEY,
  initialValue: "",
  isValue: isStoredReasoningLevel,
});
const permissionModeAtomFamily = createPersistedEnumAtom<StoredPermissionMode>({
  baseKey: PERMISSION_MODE_STORAGE_KEY,
  initialValue: "",
  isValue: isStoredPermissionMode,
});
const environmentSelectionAtomFamily = createProjectScopedStorageAtomFamily(
  ENVIRONMENT_STORAGE_KEY,
  "",
  rawStringLocalStorage,
);

export function usePersistedProviderSelection(
  projectId: ProjectScopedStorageParam,
): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(providerIdAtomFamily(projectId));
  const setValue = useCallback(
    (nextValue: string) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePersistedModelSelection(
  projectId: ProjectScopedStorageParam,
): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(modelAtomFamily(projectId));
  const setValue = useCallback(
    (nextValue: string) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePersistedServiceTierSelection(
  projectId: ProjectScopedStorageParam,
): PersistedServiceTierSelectionField {
  const [value, setAtomValue] = useAtom(serviceTierAtomFamily(projectId));
  const setValue = useCallback(
    (nextValue: StoredServiceTier) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePersistedReasoningLevelSelection(
  projectId: ProjectScopedStorageParam,
): PersistedReasoningLevelSelectionField {
  const [value, setAtomValue] = useAtom(reasoningLevelAtomFamily(projectId));
  const setValue = useCallback(
    (nextValue: StoredReasoningLevel) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePersistedPermissionModeSelection(
  projectId: ProjectScopedStorageParam,
): PersistedPermissionModeSelectionField {
  const [value, setAtomValue] = useAtom(permissionModeAtomFamily(projectId));
  const setValue = useCallback(
    (nextValue: StoredPermissionMode) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}

export function usePersistedEnvironmentSelection(
  projectId: ProjectScopedStorageParam,
): PersistedStringSelectionField {
  const [value, setAtomValue] = useAtom(
    environmentSelectionAtomFamily(projectId),
  );
  const setValue = useCallback(
    (nextValue: string) => {
      setAtomValue(nextValue);
    },
    [setAtomValue],
  );
  return { setValue, value };
}
