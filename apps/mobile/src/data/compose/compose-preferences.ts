import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { ThreadEnvironmentSelection } from "./environment-selection";

/**
 * Client-local thread-creation preferences (the "last picked" provider,
 * model + reasoning per provider, permission mode, service tier, environment
 * mode per project, navigate-after-create, last project). Persisted under
 * the web app's `bb.promptbox.*` / `bb.root-compose.*` key names and value
 * spellings (apps/app/src/hooks/thread-creation-options/
 * persisted-selection-fields.ts, lib/root-compose-*.ts) so the two clients
 * read alike. Storage is injected (MMKV in the app, a Map in tests); the
 * store is the single writer and notifies subscribers in-process.
 */

export const COMPOSE_PROVIDER_STORAGE_KEY = "bb.promptbox.provider";
export const COMPOSE_MODEL_STORAGE_KEY = "bb.promptbox.model";
export const COMPOSE_REASONING_STORAGE_KEY = "bb.promptbox.reasoning";
export const COMPOSE_SERVICE_TIER_STORAGE_KEY = "bb.promptbox.service-tier";
export const COMPOSE_PERMISSION_MODE_STORAGE_KEY =
  "bb.promptbox.permission-mode";
export const COMPOSE_ENVIRONMENT_STORAGE_KEY = "bb.promptbox.environment";
export const COMPOSE_NAVIGATE_AFTER_CREATE_STORAGE_KEY =
  "bb.root-compose.navigate-after-create";
export const COMPOSE_LAST_PROJECT_STORAGE_KEY = "bb.root-compose.project-id";
/** Suffix version the web app appends to provider/project-scoped keys. */
const SCOPED_STORAGE_VERSION = "1";

export type StoredServiceTier = "" | ServiceTier;
export type StoredReasoningLevel = "" | ReasoningLevel;
export type StoredPermissionMode = "" | PermissionMode;

/** How work should run on a host, without the transient branch/path picks. */
export type StoredEnvironmentMode = "local" | "worktree";

export interface StoredProjectEnvironment {
  hostId: string;
  mode: StoredEnvironmentMode;
}

export interface StoredProviderSelection {
  model: string;
  reasoningLevel: StoredReasoningLevel;
}

export interface ComposePreferences {
  providerId: string;
  serviceTier: StoredServiceTier;
  permissionMode: StoredPermissionMode;
  navigateAfterCreate: boolean;
  /** Last project composed in ("" = none). */
  lastProjectId: string;
  /** Bumped on every write so scoped getters re-read after a change. */
  revision: number;
}

export interface ComposePreferencesStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface ComposePreferencesStore {
  getSnapshot(): ComposePreferences;
  subscribe(listener: () => void): () => void;
  setProviderId(providerId: string): void;
  setServiceTier(tier: StoredServiceTier): void;
  setPermissionMode(mode: StoredPermissionMode): void;
  setNavigateAfterCreate(value: boolean): void;
  setLastProjectId(projectId: string): void;
  getProviderSelection(providerId: string): StoredProviderSelection;
  setProviderSelection(
    providerId: string,
    selection: Partial<StoredProviderSelection>,
  ): void;
  getProjectEnvironment(projectId: string): StoredProjectEnvironment | null;
  setProjectEnvironment(
    projectId: string,
    environment: StoredProjectEnvironment | null,
  ): void;
}

export const NAVIGATE_AFTER_CREATE_DEFAULT = true;

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

export function parseStoredReasoningLevel(
  value: string | undefined,
): StoredReasoningLevel {
  return value !== undefined && isReasoningLevel(value) ? value : "";
}

/**
 * The web's legacy "workspace-write" maps onto "accept-edits"; anything else
 * unknown (including the retired read-only mode) is dropped rather than
 * reinterpreted as a writable mode.
 */
export function parseStoredPermissionMode(
  value: string | undefined,
): StoredPermissionMode {
  if (value === "workspace-write") return "accept-edits";
  return value !== undefined && isPermissionMode(value) ? value : "";
}

export function parseStoredServiceTier(
  value: string | undefined,
): StoredServiceTier {
  return value !== undefined && isServiceTier(value) ? value : "";
}

function scopedKey(prefix: string, scope: string): string {
  return `${prefix}-${encodeURIComponent(scope.trim())}-${SCOPED_STORAGE_VERSION}`;
}

/** `host:<hostId>:<local|worktree>`, the web picker's persisted spelling. */
export function encodeStoredEnvironment(
  environment: StoredProjectEnvironment,
): string {
  return `host:${environment.hostId}:${environment.mode}`;
}

/**
 * Reads the web spelling. Reuse values (`reuse:<id>`) are transient by
 * design and never resurrected; anything unparseable reads as no preference.
 */
export function parseStoredEnvironment(
  value: string | undefined,
): StoredProjectEnvironment | null {
  if (!value || !value.startsWith("host:")) return null;
  const parts = value.split(":");
  const hostId = parts[1];
  const mode = parts[2];
  if (hostId && (mode === "local" || mode === "worktree")) {
    return { hostId, mode };
  }
  return null;
}

/** The typed compose selection a stored host preference expands to. */
export function storedEnvironmentToSelection(
  environment: StoredProjectEnvironment,
): ThreadEnvironmentSelection {
  return environment.mode === "worktree"
    ? {
        type: "host",
        hostId: environment.hostId,
        workspace: { type: "managed-worktree", baseBranch: null },
      }
    : {
        type: "host",
        hostId: environment.hostId,
        workspace: { type: "unmanaged", path: null, branch: null },
      };
}

/** What to persist for a selection: host mode only, never reuse/branches. */
export function selectionToStoredEnvironment(
  selection: ThreadEnvironmentSelection,
): StoredProjectEnvironment | null {
  if (selection.type !== "host") return null;
  return {
    hostId: selection.hostId,
    mode:
      selection.workspace.type === "managed-worktree" ? "worktree" : "local",
  };
}

function readSnapshot(
  storage: ComposePreferencesStorage,
  revision: number,
): ComposePreferences {
  const navigate = storage.getString(COMPOSE_NAVIGATE_AFTER_CREATE_STORAGE_KEY);
  return {
    providerId: storage.getString(COMPOSE_PROVIDER_STORAGE_KEY) ?? "",
    serviceTier: parseStoredServiceTier(
      storage.getString(COMPOSE_SERVICE_TIER_STORAGE_KEY),
    ),
    permissionMode: parseStoredPermissionMode(
      storage.getString(COMPOSE_PERMISSION_MODE_STORAGE_KEY),
    ),
    navigateAfterCreate:
      navigate === undefined
        ? NAVIGATE_AFTER_CREATE_DEFAULT
        : navigate === "true",
    lastProjectId: storage.getString(COMPOSE_LAST_PROJECT_STORAGE_KEY) ?? "",
    revision,
  };
}

export function createComposePreferencesStore(
  storage: ComposePreferencesStorage,
): ComposePreferencesStore {
  let snapshot = readSnapshot(storage, 0);
  const listeners = new Set<() => void>();

  function commit(): void {
    snapshot = readSnapshot(storage, snapshot.revision + 1);
    for (const listener of listeners) listener();
  }

  function write(key: string, value: string): void {
    if (value.length === 0) storage.remove(key);
    else storage.set(key, value);
    commit();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setProviderId(providerId) {
      if (providerId === snapshot.providerId) return;
      // The web app once kept a single unscoped model/reasoning pair owned by
      // the current provider; a provider change orphans it.
      storage.remove(COMPOSE_MODEL_STORAGE_KEY);
      storage.remove(COMPOSE_REASONING_STORAGE_KEY);
      write(COMPOSE_PROVIDER_STORAGE_KEY, providerId);
    },
    setServiceTier(tier) {
      write(COMPOSE_SERVICE_TIER_STORAGE_KEY, tier);
    },
    setPermissionMode(mode) {
      write(COMPOSE_PERMISSION_MODE_STORAGE_KEY, mode);
    },
    setNavigateAfterCreate(value) {
      write(
        COMPOSE_NAVIGATE_AFTER_CREATE_STORAGE_KEY,
        value ? "true" : "false",
      );
    },
    setLastProjectId(projectId) {
      write(COMPOSE_LAST_PROJECT_STORAGE_KEY, projectId);
    },
    getProviderSelection(providerId) {
      if (providerId.trim().length === 0)
        return { model: "", reasoningLevel: "" };
      const scopedModel = storage.getString(
        scopedKey(COMPOSE_MODEL_STORAGE_KEY, providerId),
      );
      const scopedReasoning = storage.getString(
        scopedKey(COMPOSE_REASONING_STORAGE_KEY, providerId),
      );
      // Legacy unscoped pair, valid only for the provider that wrote it.
      const legacyOwner = storage.getString(COMPOSE_PROVIDER_STORAGE_KEY);
      const legacyApplies = legacyOwner === providerId;
      return {
        model:
          scopedModel ??
          (legacyApplies
            ? storage.getString(COMPOSE_MODEL_STORAGE_KEY)
            : undefined) ??
          "",
        reasoningLevel: parseStoredReasoningLevel(
          scopedReasoning ??
            (legacyApplies
              ? storage.getString(COMPOSE_REASONING_STORAGE_KEY)
              : undefined),
        ),
      };
    },
    setProviderSelection(providerId, selection) {
      if (providerId.trim().length === 0) return;
      if (selection.model !== undefined) {
        const key = scopedKey(COMPOSE_MODEL_STORAGE_KEY, providerId);
        if (selection.model.length === 0) storage.remove(key);
        else storage.set(key, selection.model);
      }
      if (selection.reasoningLevel !== undefined) {
        const key = scopedKey(COMPOSE_REASONING_STORAGE_KEY, providerId);
        if (selection.reasoningLevel.length === 0) storage.remove(key);
        else storage.set(key, selection.reasoningLevel);
      }
      commit();
    },
    getProjectEnvironment(projectId) {
      const key =
        projectId.trim().length > 0
          ? scopedKey(COMPOSE_ENVIRONMENT_STORAGE_KEY, projectId)
          : COMPOSE_ENVIRONMENT_STORAGE_KEY;
      return parseStoredEnvironment(storage.getString(key));
    },
    setProjectEnvironment(projectId, environment) {
      const key =
        projectId.trim().length > 0
          ? scopedKey(COMPOSE_ENVIRONMENT_STORAGE_KEY, projectId)
          : COMPOSE_ENVIRONMENT_STORAGE_KEY;
      write(
        key,
        environment === null ? "" : encodeStoredEnvironment(environment),
      );
    },
  };
}
