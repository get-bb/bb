import { createHash } from "node:crypto";
import {
  deleteStoredProviderModelCatalogsForHost,
  getHost,
  getStoredProviderModelCatalog,
  replaceStoredProviderModelCatalog,
  type ProviderModelCatalogRowKey,
} from "@bb/db";
import {
  availableModelSchema,
  providerModelCatalogDependsOnWorkspace,
  type AvailableModel,
  type ProviderInfo,
} from "@bb/domain";
import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type { SystemExecutionOptionsModelLoadErrorCode } from "@bb/server-contract";
import { z } from "zod";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import {
  callHostOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";
import {
  expectedFallbackErrorLogFields,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import {
  requireBridgeLaunchForProviderId,
  resolveBridgeLaunchForProviderId,
} from "../system/provider-bridge-launch.js";

export const PROVIDER_MODEL_CATALOG_PUSH_COALESCE_MS = 250;
export const PROVIDER_MODEL_CATALOG_MEMORY_ENTRY_LIMIT = 256;
const FRESH_MS = 10 * 60_000;
const VALIDATION_MIN_AGE_MS = 60_000;
const FAILURE_TTL_MS = 30_000;
const PREWARM_MIN_AGE_MS = 4 * 60 * 60_000;
const WORKSPACE_ROW_RETENTION_MS = 7 * 24 * 60 * 60_000;

type ProviderModelCatalogFailureCode = Exclude<
  SystemExecutionOptionsModelLoadErrorCode,
  "provider_unavailable"
>;

export type ProviderModelCatalogAccess =
  | { kind: "picker" }
  | { kind: "validation"; requiredModel: string | null };

type ProviderModelCatalogReadResult =
  | {
      kind: "catalog";
      models: AvailableModel[];
      selectedOnlyModels: AvailableModel[];
    }
  | { kind: "error"; code: ProviderModelCatalogFailureCode };

export interface ProviderModelCatalogStore {
  read(
    deps: WorkSessionDeps,
    args: {
      hostId: string;
      provider: ProviderInfo;
      cwd: string | null;
      access: ProviderModelCatalogAccess;
    },
  ): Promise<ProviderModelCatalogReadResult>;
  refreshForPrewarm(
    deps: WorkSessionDeps,
    args: { hostId: string; provider: ProviderInfo },
  ): Promise<void>;
  clearFailure(hostId: string, providerId: string): void;
  markAllStale(): void;
  forgetHost(deps: WorkSessionDeps, hostId: string): void;
}

interface CatalogGood {
  fingerprint: string;
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
  modelsJson: string;
  selectedOnlyModelsJson: string;
  fetchedAt: number;
}

interface CatalogFailure {
  fingerprint: string;
  code: ProviderModelCatalogFailureCode;
  failedAt: number;
}

interface CatalogRefresh {
  fingerprint: string;
  sessionId: string | null;
  startedAt: number;
  markedStale: boolean;
  promise: Promise<void>;
}

interface CatalogEntry {
  key: ProviderModelCatalogRowKey;
  good: CatalogGood | null;
  failure: CatalogFailure | null;
  refresh: CatalogRefresh | null;
}

type RefreshSettlement =
  | { ok: true; models: AvailableModel[]; selectedOnlyModels: AvailableModel[] }
  | { ok: false; error: unknown };

type CatalogDecision =
  | {
      kind: "serve";
      result: ProviderModelCatalogReadResult;
      backgroundRefresh: boolean;
    }
  | { kind: "wait" };

const storedModelListSchema = z.array(availableModelSchema);

export function toProviderModelCatalogFailureCode(
  error: ApiError,
): ProviderModelCatalogFailureCode {
  switch (error.body.code) {
    case "command_timeout":
      return "timeout";
    case "missing_executable":
      return "missing_executable";
    case "auth_required":
      return "auth_required";
    default:
      return "failed";
  }
}

function catalogFingerprint(
  providerId: string,
  bridgeLaunch: HostDaemonBridgeLaunch,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        providerId,
        bridgeLaunch.pluginId,
        bridgeLaunch.source,
        bridgeLaunch.providerOptions,
        bridgeLaunch.envPassthrough,
      ]),
    )
    .digest("hex");
}

function parseStoredModels(json: string): AvailableModel[] | null {
  try {
    const parsed = storedModelListSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function currentState(entry: CatalogEntry, fingerprint: string) {
  const good = entry.good?.fingerprint === fingerprint ? entry.good : null;
  const failure =
    entry.failure?.fingerprint === fingerprint ? entry.failure : null;
  const servable =
    failure === null || failure.code === "timeout" || failure.code === "failed"
      ? good
      : null;
  return { good, failure, servable };
}

function pickerView(entry: CatalogEntry, fingerprint: string): string {
  const { failure, servable } = currentState(entry, fingerprint);
  if (servable !== null) {
    return `catalog:${servable.modelsJson}\0${servable.selectedOnlyModelsJson}`;
  }
  return failure === null ? "none" : `error:${failure.code}`;
}

function lacksRequiredModel(
  good: CatalogGood,
  requiredModel: string | null,
): boolean {
  if (requiredModel === null) {
    return good.models.length === 0;
  }
  return ![...good.models, ...good.selectedOnlyModels].some(
    (entry) => entry.model === requiredModel,
  );
}

function evaluate(
  entry: CatalogEntry,
  fingerprint: string,
  access: ProviderModelCatalogAccess,
  now: number,
  refreshed: boolean,
): CatalogDecision {
  const { failure, servable } = currentState(entry, fingerprint);
  const active = failure !== null && now - failure.failedAt < FAILURE_TTL_MS;
  if (servable !== null) {
    const age = now - servable.fetchedAt;
    if (
      access.kind === "validation" &&
      !refreshed &&
      !active &&
      age >= VALIDATION_MIN_AGE_MS &&
      lacksRequiredModel(servable, access.requiredModel)
    ) {
      return { kind: "wait" };
    }
    return {
      kind: "serve",
      result: {
        kind: "catalog",
        models: servable.models,
        selectedOnlyModels: servable.selectedOnlyModels,
      },
      backgroundRefresh: !refreshed && !active && age >= FRESH_MS,
    };
  }
  if (refreshed) {
    return {
      kind: "serve",
      result: { kind: "error", code: failure?.code ?? "failed" },
      backgroundRefresh: false,
    };
  }
  if (access.kind === "validation" || failure === null) {
    return { kind: "wait" };
  }
  if (active || failure.code === "timeout") {
    return {
      kind: "serve",
      result: { kind: "error", code: failure.code },
      backgroundRefresh: !active,
    };
  }
  return { kind: "wait" };
}

export function createProviderModelCatalogStore(options: {
  now: () => number;
  pushCoalesceMs: number;
  memoryEntryLimit: number;
}): ProviderModelCatalogStore {
  const entries = new Map<string, CatalogEntry>();
  const pendingPushByHost = new Map<string, ReturnType<typeof setTimeout>>();

  function loadStoredGood(
    deps: WorkSessionDeps,
    key: ProviderModelCatalogRowKey,
  ): CatalogGood | null {
    const row = getStoredProviderModelCatalog(deps.db, key);
    if (row === null) {
      return null;
    }
    const models = parseStoredModels(row.modelsJson);
    const selectedOnlyModels = parseStoredModels(row.selectedOnlyModelsJson);
    if (models === null || selectedOnlyModels === null) {
      return null;
    }
    return {
      fingerprint: row.fingerprint,
      models,
      selectedOnlyModels,
      modelsJson: row.modelsJson,
      selectedOnlyModelsJson: row.selectedOnlyModelsJson,
      fetchedAt: row.fetchedAt,
    };
  }

  function loadEntry(
    deps: WorkSessionDeps,
    key: ProviderModelCatalogRowKey,
  ): CatalogEntry {
    const mapKey = JSON.stringify([key.hostId, key.providerId, key.scopeKey]);
    const existing = entries.get(mapKey);
    if (existing !== undefined) {
      entries.delete(mapKey);
      entries.set(mapKey, existing);
      return existing;
    }
    const entry: CatalogEntry = {
      key,
      good: loadStoredGood(deps, key),
      failure: null,
      refresh: null,
    };
    entries.set(mapKey, entry);
    for (const [victimKey, victim] of entries) {
      if (entries.size <= options.memoryEntryLimit) {
        break;
      }
      if (victim !== entry && victim.refresh === null) {
        entries.delete(victimKey);
      }
    }
    return entry;
  }

  function schedulePush(deps: WorkSessionDeps, hostId: string): void {
    if (pendingPushByHost.has(hostId)) {
      return;
    }
    const timer = setTimeout(() => {
      pendingPushByHost.delete(hostId);
      deps.hub.notifyHost(hostId, ["provider-model-catalog-changed"]);
    }, options.pushCoalesceMs);
    timer.unref?.();
    pendingPushByHost.set(hostId, timer);
  }

  function persistGood(
    deps: WorkSessionDeps,
    key: ProviderModelCatalogRowKey,
    good: CatalogGood,
  ): void {
    try {
      const host = getHost(deps.db, key.hostId);
      if (
        host === null ||
        host.destroyedAt !== null ||
        host.type === "ephemeral"
      ) {
        return;
      }
      replaceStoredProviderModelCatalog(deps.db, {
        row: {
          ...key,
          fingerprint: good.fingerprint,
          modelsJson: good.modelsJson,
          selectedOnlyModelsJson: good.selectedOnlyModelsJson,
          fetchedAt: good.fetchedAt,
        },
        pruneWorkspaceRowsFetchedBefore:
          key.scopeKey === ""
            ? null
            : good.fetchedAt - WORKSPACE_ROW_RETENTION_MS,
      });
    } catch (error) {
      deps.logger.warn(
        {
          hostId: key.hostId,
          providerId: key.providerId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Failed to persist provider model catalog",
      );
    }
  }

  function settle(
    deps: WorkSessionDeps,
    entry: CatalogEntry,
    refresh: CatalogRefresh,
    settlement: RefreshSettlement,
  ): void {
    const { hostId, providerId, scopeKey } = entry.key;
    const now = options.now();
    const log = (
      level: "info" | "warn" | "error",
      fields: Record<string, unknown>,
    ): void => {
      deps.logger[level](
        {
          hostId,
          providerId,
          scope: scopeKey === "" ? "host" : "workspace",
          durationMs: now - refresh.startedAt,
          ...fields,
        },
        "Provider model catalog refresh settled",
      );
    };
    if (entry.refresh !== refresh) {
      log("info", { outcome: "superseded", changed: false });
      return;
    }
    entry.refresh = null;
    const before = pickerView(entry, refresh.fingerprint);
    let level: "info" | "warn" | "error" = "info";
    let fields: Record<string, unknown>;
    if (settlement.ok) {
      entry.good = {
        fingerprint: refresh.fingerprint,
        models: settlement.models,
        selectedOnlyModels: settlement.selectedOnlyModels,
        modelsJson: JSON.stringify(settlement.models),
        selectedOnlyModelsJson: JSON.stringify(settlement.selectedOnlyModels),
        fetchedAt: refresh.markedStale ? 0 : now,
      };
      entry.failure = null;
      persistGood(deps, entry.key, entry.good);
      fields = {
        outcome: "success",
        modelCount:
          settlement.models.length + settlement.selectedOnlyModels.length,
      };
    } else {
      const { error } = settlement;
      const errorFields =
        error instanceof ApiError
          ? expectedFallbackErrorLogFields(error)
          : runtimeErrorLogFields(deps.config, error);
      if (
        isHostUnavailableApiError(error) ||
        refresh.sessionId !== deps.hub.getDaemonSessionIdForHost(hostId)
      ) {
        log("info", {
          outcome: "host_unavailable",
          changed: false,
          ...errorFields,
        });
        return;
      }
      const code =
        error instanceof ApiError &&
        (error.status === 502 || error.status === 504)
          ? toProviderModelCatalogFailureCode(error)
          : null;
      entry.failure = {
        fingerprint: refresh.fingerprint,
        code: code ?? "failed",
        failedAt: now,
      };
      level = code === null ? "error" : "warn";
      fields = { outcome: code ?? "failed", ...errorFields };
    }
    const changed = before !== pickerView(entry, refresh.fingerprint);
    if (changed) {
      schedulePush(deps, hostId);
    }
    log(level, { ...fields, changed });
  }

  function startRefresh(
    deps: WorkSessionDeps,
    entry: CatalogEntry,
    fingerprint: string,
    bridgeLaunch: HostDaemonBridgeLaunch,
  ): Promise<void> {
    const { hostId, providerId, scopeKey } = entry.key;
    const refresh: CatalogRefresh = {
      fingerprint,
      sessionId: deps.hub.getDaemonSessionIdForHost(hostId),
      startedAt: options.now(),
      markedStale: false,
      promise: Promise.resolve(),
    };
    entry.refresh = refresh;
    refresh.promise = callHostOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider.list_models",
        providerId,
        ...(scopeKey === "" ? {} : { cwd: scopeKey }),
        bridgeLaunch,
      },
    }).then(
      (result) =>
        settle(deps, entry, refresh, {
          ok: true,
          models: result.models,
          selectedOnlyModels: result.selectedOnlyModels,
        }),
      (error: unknown) => settle(deps, entry, refresh, { ok: false, error }),
    );
    return refresh.promise;
  }

  function joinOrStartRefresh(
    deps: WorkSessionDeps,
    entry: CatalogEntry,
    fingerprint: string,
    bridgeLaunch: HostDaemonBridgeLaunch,
  ): Promise<void> {
    return entry.refresh?.fingerprint === fingerprint
      ? entry.refresh.promise
      : startRefresh(deps, entry, fingerprint, bridgeLaunch);
  }

  return {
    async read(deps, args) {
      const bridgeLaunch = requireBridgeLaunchForProviderId(
        deps,
        args.provider.id,
      );
      const fingerprint = catalogFingerprint(args.provider.id, bridgeLaunch);
      const entry = loadEntry(deps, {
        hostId: args.hostId,
        providerId: args.provider.id,
        scopeKey:
          args.cwd !== null &&
          providerModelCatalogDependsOnWorkspace(
            args.provider.capabilities.modelCatalogScope,
          )
            ? args.cwd
            : "",
      });
      for (let refreshed = false; ; refreshed = true) {
        const decision = evaluate(
          entry,
          fingerprint,
          args.access,
          options.now(),
          refreshed,
        );
        if (decision.kind === "serve") {
          if (decision.backgroundRefresh) {
            void joinOrStartRefresh(deps, entry, fingerprint, bridgeLaunch);
          }
          return decision.result;
        }
        await joinOrStartRefresh(deps, entry, fingerprint, bridgeLaunch);
      }
    },

    async refreshForPrewarm(deps, args) {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(
        deps,
        args.provider.id,
      );
      if (bridgeLaunch === null) {
        return;
      }
      const fingerprint = catalogFingerprint(args.provider.id, bridgeLaunch);
      const entry = loadEntry(deps, {
        hostId: args.hostId,
        providerId: args.provider.id,
        scopeKey: "",
      });
      if (entry.refresh?.fingerprint === fingerprint) {
        return;
      }
      const { good, failure } = currentState(entry, fingerprint);
      const lastAttemptAt = Math.max(
        good?.fetchedAt ?? Number.NEGATIVE_INFINITY,
        failure?.failedAt ?? Number.NEGATIVE_INFINITY,
      );
      if (options.now() - lastAttemptAt < PREWARM_MIN_AGE_MS) {
        return;
      }
      await startRefresh(deps, entry, fingerprint, bridgeLaunch);
    },

    clearFailure(hostId, providerId) {
      for (const entry of entries.values()) {
        if (
          entry.key.hostId === hostId &&
          entry.key.providerId === providerId
        ) {
          entry.failure = null;
        }
      }
    },

    markAllStale() {
      for (const entry of entries.values()) {
        entry.failure = null;
        if (entry.good !== null) {
          entry.good.fetchedAt = 0;
        }
        if (entry.refresh !== null) {
          entry.refresh.markedStale = true;
        }
      }
    },

    forgetHost(deps, hostId) {
      for (const [mapKey, entry] of entries) {
        if (entry.key.hostId === hostId) {
          entry.refresh = null;
          entries.delete(mapKey);
        }
      }
      const timer = pendingPushByHost.get(hostId);
      if (timer !== undefined) {
        clearTimeout(timer);
        pendingPushByHost.delete(hostId);
      }
      deleteStoredProviderModelCatalogsForHost(deps.db, hostId);
    },
  };
}
