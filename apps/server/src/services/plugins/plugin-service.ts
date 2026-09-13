import { watch } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Context } from "hono";
import {
  CUSTOM_THEME_CSS_MAX_LENGTH,
  deepFreezePluginMetadata,
  derivePluginId,
  formatPluginThemeId,
  isNamespacedGlyph,
  isPluginOwnedIconPath,
  parsePersistedPluginMetadata,
  type DeclaredCodeTheme,
  type JsonObject,
  type JsonValue,
  type PluginThemeMeta,
  type SystemChangeKind,
  type ThreadEventItemPresentation,
  type ToolCallResponse,
} from "@bb/domain";
import {
  type ExperimentalPluginWebSocketContext,
  type ExperimentalPluginWebSocketHandlers,
  type PluginCliExecutionResult,
  type ExperimentalPluginProviderEnvContext,
  type ExperimentalPluginProviderEnvHealthContext,
  type PluginRpcError,
} from "@get-bb/plugin-sdk";
import {
  enforcePluginCliOutputLimit,
  normalizePluginAgentConfiguration,
  normalizeRpcJsonResult,
  RESERVED_AGENT_TOOL_NAMES,
  adoptHttpRouteResponse,
  validatePluginProviderEnvEntries,
  validateRpcValue,
  validateSettingsUpdate,
} from "@get-bb/plugin-sdk/internal/host-policy";
import {
  buildPluginApp,
  buildPluginHost,
  createPluginDevLoop,
} from "@bb/plugin-build";
import { getPluginBuildToolchain } from "./build-toolchain.js";
import {
  marketplacePublisherLabel,
  pluginPublisherLabel,
} from "../plugin-catalog/marketplace-publishers.js";
import { deleteSecretFile, readOrCreateSecretFile } from "@bb/secret-storage";
import {
  pluginUpdateCheckEntrySchema,
  ROOT_PLUGIN_SOURCE_SELECTION,
  type InstalledPlugin,
  type PluginCapabilitySummary,
  type PluginSourceDetail,
  type PluginSourceSelection,
  type PluginUpdateCheckEntry,
} from "@bb/server-contract";
import {
  claimPluginScheduledRun,
  deleteAllPluginSettings,
  deleteInstalledPlugin,
  deletePluginSchedules,
  getInstalledPlugin,
  getThread,
  getLatestThreadSequence,
  listDuePluginSchedules,
  listInstalledPlugins,
  listPendingGitPluginArtifacts,
  listPluginMarketplaces,
  listPluginSchedules,
  listThreadPluginMetadataRows,
  markInstalledPluginRemoved,
  recordPluginScheduleResult,
  setInstalledPluginEnabled,
  type InstalledPluginRow,
  type PluginMarketplaceRow,
} from "@bb/db";
import {
  catalogEntryMetadata,
  isBundledMarketplaceEntry,
  marketplaceEntryCollections,
  marketplaceRowIconBase,
  parseStoredMarketplaceManifest,
  type MarketplaceManifest,
} from "../plugin-catalog/marketplace-manifest.js";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";
import { buildTurnFailedEvent } from "../threads/turn-failed.js";
import type {
  PluginBrandingAssetSet,
  PluginBrandingAssetSnapshot,
  PluginBrandingAssetVariant,
} from "./app-bundle.js";
import { readPluginThemeCodeTheme } from "../system/code-themes.js";
import {
  npmInstallPrefix,
  parsePluginSource,
  recoverInterruptedGitPluginPromotion,
} from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
import { listBundledPluginRegistrations } from "./builtin-registry.js";
import {
  type BbPluginApi,
  type PluginAgentConfigurationContext,
  type PluginAgentToolContext,
  type PluginAgentToolRecord,
  type PluginCliContext,
  type PluginHttpRouteRecord,
  type PluginMentionTrigger,
  type PluginRpcHandler,
  type PluginWebSocketRouteRecord,
} from "./plugin-api.js";
import {
  syncPluginCommandsSkill,
  type PluginCliContribution,
} from "./plugin-commands-skill.js";
import { readPluginLogTail } from "./plugin-log.js";
import {
  buildPluginSettingsView,
  pluginSecretsDir,
  readPluginSettingsValues,
  writePluginSettingsUpdate,
  PluginSettingsValidationError,
  type PluginSettingsView,
} from "./plugin-settings.js";
import { createPluginActivation } from "./plugin-activation.js";
import {
  createManagedPluginArtifacts,
  type InstallContext,
  type RegisterInstalledArgs,
} from "./managed-plugin-artifacts.js";
import {
  DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
  type PluginHookInvocation,
  type PluginHookProvider,
} from "./plugin-hook-registry.js";
import type { PluginEnvironmentProviderBridge } from "./plugin-environment-provider-registry.js";
import { createPluginRegistration } from "./plugin-registration.js";
import { createPluginRuntime, forgetMutableRoot } from "./plugin-runtime.js";
import { nextCronRunAt, raceTimeout } from "./plugin-time-box.js";
import { createPluginUpdates } from "./plugin-updates.js";

import type {
  LoadedPlugin,
  PluginAgentToolContribution,
  PluginApplyUpdateOutcome,
  PluginInstructionContribution,
  PluginMentionProviderContribution,
  PluginMentionResolveResult,
  PluginMentionSearchGroup,
  PluginMentionSearchItem,
  PluginServiceDeps,
  PluginThreadEventEmitter,
  PluginWireLookup,
  PluginResolvedAgentConfiguration,
  PluginResolvedProviderEnv,
  PluginResolvedProviderEnvHealth,
} from "./plugin-service-internal.js";
import type { PluginMachineProviderBridge } from "./plugin-machine-provider-registry.js";
export type {
  PluginAgentToolContribution,
  PluginMentionResolveResult,
  PluginServiceDeps,
  PluginThreadEventEmitter,
  PluginWireLookup,
} from "./plugin-service-internal.js";

export interface PluginSkillRootContribution {
  pluginId: string;
  rootPath: string;
}

export type PluginReloadOutcome =
  | { ok: true; plugins: InstalledPlugin[] }
  | { ok: false; error: string; plugins: InstalledPlugin[] };

export function dispatchPluginSourceWatchChange(
  handleChange: (relativePath: string) => void,
  filename: string | null,
): void {
  handleChange(filename === null || filename.length === 0 ? "." : filename);
}

export interface PluginService {
  isBuiltin(id: string): boolean;
  events: PluginThreadEventEmitter;
  /** The hook chain the dispatch pipeline consults; registered in createApp. */
  hooks: PluginHookProvider;
  environmentProviders: PluginEnvironmentProviderBridge;
  machineProviders: PluginMachineProviderBridge;
  serverAccessProviders: import("./plugin-server-access-registry.js").ServerAccessBridge;
  /**
   * Bind the in-process BB SDK to the running server. Call once the HTTP
   * listener is up, before start(): bb.sdk throws until this runs.
   */
  bindSdk(args: { baseUrl: string }): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  handleUncaughtException(error: unknown): boolean;
  list(): InstalledPlugin[];
  listThemes(): PluginThemeMeta[];
  readThemeCss(themeId: string): Promise<string | null>;
  readThemeCodeTheme(themeId: string): DeclaredCodeTheme | null;
  install(
    source: string,
    selection: PluginSourceSelection,
  ): Promise<InstalledPlugin>;
  installOfficialPlugin(name: string): Promise<InstalledPlugin>;
  installCatalogPlugin(args: {
    marketplace: string;
    entryId: string;
    pluginId: string;
    source: string;
    selection: PluginSourceSelection;
    npmRegistry?: string;
    expectedGitCommit?: string;
    expectedNpmVersion?: string;
    expectedNpmIntegrity?: string;
  }): Promise<InstalledPlugin>;
  resolveCatalogNpmSource(args: {
    packageName: string;
    registry?: string;
    requestedSpec: string;
    specKind: "default" | "exact" | "tag" | "range";
  }): Promise<
    | { outcome: "resolved"; version: string; integrity: string }
    | { outcome: "unavailable"; detail: string }
  >;
  installPath(path: string): Promise<InstalledPlugin>;
  checkForUpdates(id?: string): Promise<PluginUpdateCheckEntry[]>;
  startPeriodicUpdateChecks(): void;
  stopPeriodicUpdateChecks(): Promise<void>;
  listUpdateResults(): PluginUpdateCheckEntry[];
  getSource(id: string): Promise<PluginSourceDetail | undefined>;
  applyUpdate(id: string): Promise<PluginApplyUpdateOutcome>;
  remove(id: string): Promise<boolean>;
  setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<InstalledPlugin | undefined>;
  reload(id?: string): Promise<PluginReloadOutcome>;
  getApi(id: string): BbPluginApi | undefined;
  /**
   * Whether this plugin's runtime is live right now. Core uses it to decide
   * whether a `plugin:<id>` owner still exists — a queue wait whose owner is
   * gone is cleared as `orphaned` rather than stranding the user's turn.
   */
  isPluginLoaded(id: string): boolean;
  /**
   * On-disk asset backing GET /plugins/:id/assets/app.{js,css}: file path
   * plus the current content hash (the route compares ?h against it for
   * cache policy). Undefined when the plugin has no loadable bundle, or no
   * CSS for kind "css".
   */
  getAppAsset(
    id: string,
    kind: "js" | "css",
  ): { path: string; hash: string } | undefined;
  getBrandingAsset(
    id: string,
    variant: PluginBrandingAssetVariant,
  ): { bytes: Uint8Array; contentType: string; hash: string } | undefined;
  getIconAsset(
    id: string,
    name: string,
  ): { bytes: Uint8Array; contentType: string; hash: string } | undefined;
  listHostArtifactGenerations(): Array<{
    pluginId: string;
    generation: string;
  }>;
  handleHostWorkerExit(args: {
    authenticatedHostId: string;
    pluginId: string;
    generation: string;
  }): void;
  handleHostSignal(args: {
    authenticatedHostId: string;
    pluginId: string;
    generation: string;
    signal: string;
    payload: JsonValue;
  }): void;
  getSettings(id: string): Promise<PluginSettingsView | undefined>;
  updateSettings(
    id: string,
    values: Record<string, unknown>,
  ): Promise<PluginSettingsView | undefined>;
  getHttpRoute(
    id: string,
    method: string,
    path: string,
  ): PluginWireLookup<PluginHttpRouteRecord>;
  getWebSocketRoute(
    id: string,
    path: string,
  ): PluginWireLookup<PluginWebSocketRouteRecord>;
  getRpcHandler(id: string, method: string): PluginWireLookup<PluginRpcHandler>;
  invokeHttpRoute(
    id: string,
    route: PluginHttpRouteRecord,
    context: Context,
  ): Promise<Response>;
  invokeWebSocketRoute(
    id: string,
    route: PluginWebSocketRouteRecord,
    context: ExperimentalPluginWebSocketContext,
  ): Promise<
    | { ok: true; handlers: ExperimentalPluginWebSocketHandlers }
    | { ok: false; error: string }
  >;
  invokeWebSocketEvent(
    id: string,
    route: PluginWebSocketRouteRecord,
    event: "open" | "message" | "close" | "error",
    run: () => void | Promise<void>,
  ): Promise<void>;
  invokeRpcHandler(
    id: string,
    method: string,
    handler: PluginRpcHandler,
    input: unknown,
  ): Promise<
    { ok: true; result: JsonValue } | { ok: false; error: PluginRpcError }
  >;
  httpToken(
    id: string,
    options?: { rotate?: boolean },
  ): Promise<string | undefined>;
  listCliContributions(): PluginCliContribution[];
  runCliCommand(
    id: string,
    argv: string[],
    ctx: PluginCliContext,
  ): Promise<PluginCliExecutionResult>;
  listSkillRootContributions(): PluginSkillRootContribution[];
  listAgentTools(): PluginAgentToolContribution[];
  resolveAgentConfiguration(args: {
    context: Omit<PluginAgentConfigurationContext, "pluginMetadata">;
    skillIdsByPlugin: ReadonlyMap<string, readonly string[]>;
  }): Promise<PluginResolvedAgentConfiguration>;
  resolveProviderEnv(args: {
    providerId: string;
    context: ExperimentalPluginProviderEnvContext;
  }): Promise<PluginResolvedProviderEnv>;
  resolveProviderEnvHealth(args: {
    providerId: string;
    context: ExperimentalPluginProviderEnvHealthContext;
  }): Promise<PluginResolvedProviderEnvHealth | null>;
  listInstructionContributions(): PluginInstructionContribution[];
  findAgentTool(
    name: string,
  ): { pluginId: string; record: PluginAgentToolRecord } | undefined;
  invokeAgentTool(args: {
    pluginId: string;
    record: PluginAgentToolRecord;
    input: unknown;
    ctx: PluginAgentToolContext;
  }): Promise<ToolCallResponse>;
  listMentionProviderContributions(): PluginMentionProviderContribution[];
  searchMentions(args: {
    trigger: PluginMentionTrigger;
    query: string;
    projectId: string | null;
    threadId: string | null;
  }): Promise<PluginMentionSearchGroup[]>;
  resolveMention(args: {
    pluginId: string;
    itemId: string;
  }): Promise<PluginMentionResolveResult>;
  readLogTail(id: string, tail: number): Promise<string[] | undefined>;
  sweepDueSchedules(now: number): Promise<void>;
}

const DEFAULT_MENTION_SEARCH_TIMEOUT_MS = 2_000;
const DEFAULT_MENTION_RESOLVE_TIMEOUT_MS = 10_000;
const DEFAULT_PROVIDER_ENV_RESOLVE_TIMEOUT_MS = 5_000;
const DEFAULT_STABILIZATION_WINDOW_MS = 30_000;
const DEFAULT_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const SCHEDULE_SWEEP_BATCH_SIZE = 100;

class PluginRpcBoundaryError extends Error {
  constructor(readonly rpcError: PluginRpcError) {
    super(rpcError.message);
    this.name = "PluginRpcBoundaryError";
  }
}

function throwRpcBoundaryError(error: PluginRpcError): never {
  throw new PluginRpcBoundaryError(error);
}

function normalizeAgentToolResult(
  name: string,
  result: unknown,
): ToolCallResponse {
  if (typeof result === "string") {
    return {
      success: true,
      contentItems: [{ type: "inputText", text: result }],
    };
  }
  if (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const { content, isError } = result as {
      content: unknown[];
      isError?: unknown;
    };
    const contentItems = content.map((part, index) => {
      const typed = part as {
        type?: unknown;
        text?: unknown;
        data?: unknown;
        mimeType?: unknown;
      };
      if (typed?.type === "text" && typeof typed.text === "string") {
        return { type: "inputText" as const, text: typed.text };
      }
      if (
        typed?.type === "image" &&
        typeof typed.data === "string" &&
        typeof typed.mimeType === "string"
      ) {
        return {
          type: "inputImage" as const,
          imageUrl: `data:${typed.mimeType};base64,${typed.data}`,
        };
      }
      throw new Error(
        `content[${index}] must be { type: "text", text } or { type: "image", data, mimeType }`,
      );
    });
    return { success: isError !== true, contentItems };
  }
  throw new Error(
    `tool "${name}" execute() must return a string or { content: [...], isError? }`,
  );
}

function normalizeMentionSearchItems(
  providerId: string,
  result: unknown,
): PluginMentionSearchItem[] {
  if (!Array.isArray(result)) {
    throw new Error(
      `mention provider "${providerId}" search() must return an array of items`,
    );
  }
  return result.map((item, index) => {
    const typed = item as {
      id?: unknown;
      title?: unknown;
      subtitle?: unknown;
      icon?: unknown;
    } | null;
    if (
      typeof typed?.id !== "string" ||
      typed.id.length === 0 ||
      typeof typed.title !== "string" ||
      typed.title.trim().length === 0 ||
      (typed.subtitle !== undefined && typeof typed.subtitle !== "string") ||
      (typed.icon !== undefined && typeof typed.icon !== "string")
    ) {
      throw new Error(
        `mention provider "${providerId}" items[${index}] must be { id: string, title: string, subtitle?, icon? }`,
      );
    }
    return {
      itemId: `${providerId}:${typed.id}`,
      title: typed.title,
      subtitle:
        typeof typed.subtitle === "string" && typed.subtitle.trim().length > 0
          ? typed.subtitle
          : null,
      icon:
        typeof typed.icon === "string" && typed.icon.trim().length > 0
          ? typed.icon
          : null,
    };
  });
}

const GENERIC_AGENT_TOOL_GLYPH = "Toolbox";

export function createPluginService(deps: PluginServiceDeps): PluginService {
  const logger = deps.logger;
  const bundledPlugins =
    deps.bundledPlugins ?? listBundledPluginRegistrations();
  const mentionSearchTimeoutMs =
    deps.mentionSearchTimeoutMs ?? DEFAULT_MENTION_SEARCH_TIMEOUT_MS;
  const mentionResolveTimeoutMs =
    deps.mentionResolveTimeoutMs ?? DEFAULT_MENTION_RESOLVE_TIMEOUT_MS;
  const providerEnvResolveTimeoutMs =
    deps.providerEnvResolveTimeoutMs ?? DEFAULT_PROVIDER_ENV_RESOLVE_TIMEOUT_MS;
  const stabilizationWindowMs =
    deps.stabilizationWindowMs ?? DEFAULT_STABILIZATION_WINDOW_MS;
  const artifactRetentionMs =
    deps.artifactRetentionMs ?? DEFAULT_ARTIFACT_RETENTION_MS;
  const now = deps.now ?? Date.now;
  const marketplaceManifestCache = new Map<
    string,
    { manifestJson: string; manifest: MarketplaceManifest | null }
  >();
  let lastNotifiedProviderRegistrationRevision =
    deps.providerRegistry?.getRegistrationRevision() ?? 0;
  const scheduleStabilizationWindow =
    deps.scheduleStabilizationWindow ??
    ((durationMs: number, onElapsed: () => void) => {
      const timer = setTimeout(onElapsed, durationMs);
      return () => clearTimeout(timer);
    });

  const HTTP_TOKEN_FILE = ".http-token";

  const {
    REGISTRATION_MUTATION_KEY,
    agentToolProblems,
    appBundles,
    bindSdk: bindRuntimeSdk,
    buildThreadDto,
    builtinSourceWatchers,
    checkEngineRange,
    checkPluginSdkRange,
    disposeAll,
    disposeOne,
    buildQueuedMessageEventEmitter,
    emitThreadEvent,
    getStatus,
    handlerStats,
    handleUncaughtException,
    hungServices,
    hostArtifacts,
    identities,
    invokeWrapped,
    isBuiltinPluginId,
    listPluginHooks,
    listPluginEnvironmentCompositions,
    listPluginEnvironmentProviders,
    getPluginEnvironmentProvider,
    listPluginMachineProviders,
    listPluginServerAccessProviders,
    getPluginMachineProvider,
    isPackagedBuiltinEntry,
    loadAll,
    loaded,
    loadOne,
    brandingAssets,
    setDevBuildProblem,
    setStatus,
    sourceKind,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    wireLookup,
    withArtifactLock,
    withLifecycleLock,
    withPluginOperationLock,
  } = createPluginRuntime({
    deps,
    machineEnrollments: deps.machineEnrollments ?? null,
    settingsChanged: notifyPluginsChanged,
  });

  let managedValidateInstallDir!: (
    args: RegisterInstalledArgs,
  ) => Promise<PluginManifest>;
  const {
    assertInstallRegistrationAvailable,
    backfillNormalizedPluginRegistrations,
    emptyPluginUpdateState,
    installBuiltinSource,
    installPathSource,
    installedUpdateVersion,
    npmIntentForRow,
    provenanceForRow,
    reconcileBundled,
    registerInstalled,
    registrationMatchesForActivation,
    refuseBuiltinShadow,
    restoreRegistration,
    sourceFingerprint,
  } = createPluginRegistration({
    deps,
    bundledPlugins,
    withLifecycleLock,
    disposeOne,
    loadOne,
    statuses,
    validateInstallDir: (args) => managedValidateInstallDir(args),
    checkEngineRange,
    checkPluginSdkRange,
    syncCliSkill,
    notifyPluginsChanged,
    list,
  });

  const {
    activateManagedUpdate,
    recoverIncompletePluginRollbacks,
    runArtifactGc,
  } = createPluginActivation({
    deps,
    now,
    artifactRetentionMs,
    stabilizationWindowMs,
    scheduleStabilizationWindow,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    withArtifactLock,
    withLifecycleLock,
    disposeOne,
    loadOne,
    restoreRegistration,
    provenanceForRow,
    registrationMatchesForActivation,
    emptyPluginUpdateState,
    sourceFingerprint,
    syncCliSkill,
    notifyPluginsChanged,
  });

  const managedPluginArtifacts = createManagedPluginArtifacts({
    deps,
    withArtifactLock,
    sourceKind,
    checkEngineRange,
    checkPluginSdkRange,
    isPackagedBuiltinEntry,
    registerInstalled,
    assertInstallRegistrationAvailable,
    refuseBuiltinShadow,
    activateManagedUpdate,
  });
  managedValidateInstallDir = managedPluginArtifacts.validateInstallDir;
  const { installGitSource, installNpmSource } = managedPluginArtifacts;

  const pluginUpdates = createPluginUpdates({
    deps,
    registrationMutationKey: REGISTRATION_MUTATION_KEY,
    withLifecycleLock,
    withPluginOperationLock,
    notifyPluginsChanged,
    installedUpdateVersion,
    npmIntentForRow,
    managedArtifacts: managedPluginArtifacts,
    runArtifactGc,
  });

  function resolveAgentToolPresentation(
    pluginId: string,
    record: PluginAgentToolRecord,
  ): ThreadEventItemPresentation {
    const declared = record.presentation;
    const brandingIcon = loaded.get(pluginId)?.manifest.branding.icon;
    const glyph =
      declared?.icon?.glyph ??
      (brandingIcon !== undefined &&
      !isPluginOwnedIconPath(brandingIcon) &&
      !isNamespacedGlyph(brandingIcon)
        ? brandingIcon
        : GENERIC_AGENT_TOOL_GLYPH);
    return {
      label: declared?.label ?? {
        pending: `Running ${record.name}`,
        completed: `Ran ${record.name}`,
      },
      icon: { glyph },
      ...(declared?.suppress === undefined
        ? {}
        : { suppress: declared.suppress }),
      ...(declared?.tint === undefined ? {} : { tint: declared.tint }),
    };
  }

  function findLoadedTheme(
    themeId: string,
  ): PluginManifest["themes"][number] | undefined {
    for (const [pluginId, plugin] of loaded) {
      const theme = plugin.manifest.themes.find(
        (entry) => formatPluginThemeId(pluginId, entry.id) === themeId,
      );
      if (theme) return theme;
    }
    return undefined;
  }

  function brandingAssetSetFor(id: string): PluginBrandingAssetSet | undefined {
    return loaded.has(id)
      ? brandingAssets.get(id)
      : identities.get(id)?.brandingAssets;
  }

  function assetPayload(asset: PluginBrandingAssetSnapshot): {
    bytes: Uint8Array;
    contentType: string;
    hash: string;
  } {
    return {
      bytes: asset.bytes,
      contentType: asset.contentType,
      hash: asset.hash,
    };
  }

  async function invokeIsolated<T>(
    pluginId: string,
    label: string,
    run: () => Promise<T>,
  ): Promise<PluginHookInvocation<T>> {
    const outcome = await invokeWrapped(pluginId, label, run);
    return outcome.ok
      ? { ok: true, value: outcome.value }
      : { ok: false, error: outcome.error };
  }

  function toToolContribution(
    pluginId: string,
    record: PluginAgentToolRecord,
    inputSchema: unknown = record.inputSchema,
  ): PluginAgentToolContribution {
    return {
      pluginId,
      tool: {
        name: record.name,
        description: record.description,
        inputSchema,
        presentation: resolveAgentToolPresentation(pluginId, record),
      },
      instructions: record.instructions,
    };
  }

  function collectAgentTools(): Array<{
    pluginId: string;
    record: PluginAgentToolRecord;
  }> {
    const seen = new Set<string>(RESERVED_AGENT_TOOL_NAMES);
    const out: Array<{ pluginId: string; record: PluginAgentToolRecord }> = [];
    for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      for (const record of plugin.handle.agentTools) {
        if (seen.has(record.name)) continue;
        seen.add(record.name);
        out.push({ pluginId: id, record });
      }
    }
    return out;
  }

  function cliContributions(): PluginCliContribution[] {
    const contributions: PluginCliContribution[] = [];
    for (const [id, plugin] of [...loaded.entries()]) {
      const registration = plugin.handle.cli.registration;
      if (!registration) continue;
      contributions.push({
        pluginId: id,
        name: registration.name,
        summary: registration.summary,
        commands: registration.commands.map((command) => ({ ...command })),
      });
    }
    return contributions.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  async function syncCliSkill(): Promise<void> {
    try {
      await syncPluginCommandsSkill(deps.dataDir, cliContributions());
    } catch (error) {
      logger.warn(
        `failed to sync the plugin-commands skill: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function notifyPluginsChanged(): void {
    const changes: SystemChangeKind[] = ["plugins-changed"];
    const providerRegistrationRevision =
      deps.providerRegistry?.getRegistrationRevision();
    if (
      providerRegistrationRevision !== undefined &&
      providerRegistrationRevision !== lastNotifiedProviderRegistrationRevision
    ) {
      lastNotifiedProviderRegistrationRevision = providerRegistrationRevision;
      changes.push("provider-registrations-changed");
    }
    deps.hub.notifySystem(changes);
  }

  function compactPath(path: string): string {
    const home = homedir();
    return path === home
      ? "~"
      : path.startsWith(`${home}/`)
        ? `~/${path.slice(home.length + 1)}`
        : path;
  }

  function updateTrackingForRow(row: InstalledPluginRow): string {
    return (row.sourceKind === "npm" && row.sourceNpmSpecKind !== "exact") ||
      (row.sourceKind === "git" &&
        (row.sourceGitRefKind === "branch" || row.sourceGitRange !== null))
      ? "tracks compatible"
      : "pinned";
  }

  function sourceDisplayForRow(row: InstalledPluginRow): string {
    if (row.sourceKind === "path") {
      return `path · ${compactPath(row.sourcePath ?? row.rootDir)}`;
    }
    if (row.sourceKind === "builtin") return `builtin · ${row.id}`;
    if (row.sourceKind === "npm") {
      return `npm · ${row.sourceNpmPackage ?? row.id} · ${updateTrackingForRow(row)}`;
    }
    const range = row.sourceGitRange === null ? "" : ` · ${row.sourceGitRange}`;
    return `git · ${row.sourceGitUrl ?? row.source}${range} · ${updateTrackingForRow(row)}`;
  }

  function updateStateForRow(
    row: InstalledPluginRow,
  ): InstalledPlugin["updateState"] {
    let persisted: PluginUpdateCheckEntry | undefined;
    if (row.updateStatusDetail !== null) {
      try {
        const parsed = pluginUpdateCheckEntrySchema.safeParse(
          JSON.parse(row.updateStatusDetail),
        );
        if (parsed.success && parsed.data.id === row.id)
          persisted = parsed.data;
      } catch {}
    }
    const failure =
      row.lastFailureVersion !== null &&
      row.lastFailureAt !== null &&
      row.lastFailureDetail !== null
        ? {
            version: row.lastFailureVersion,
            at: row.lastFailureAt,
            detail: row.lastFailureDetail,
          }
        : undefined;
    return {
      ...(persisted === undefined ? {} : { outcome: persisted.outcome }),
      ...(persisted?.outcome === "unavailable"
        ? { detail: persisted.detail }
        : {}),
      ...(row.availableCompatibleVersion === null
        ? {}
        : { availableVersion: row.availableCompatibleVersion }),
      ...(row.newestIncompatibleVersion === null
        ? {}
        : { blockedVersion: row.newestIncompatibleVersion }),
      ...(persisted?.blocked === undefined
        ? {}
        : { blockedReasons: persisted.blocked.reasons }),
      ...(row.lastUpdateCheckAt === null
        ? {}
        : { lastCheckAt: row.lastUpdateCheckAt }),
      ...(failure === undefined ? {} : { lastFailure: failure }),
    };
  }

  function capabilitySummary(
    manifest: PluginManifest | undefined,
    loadedPlugin: LoadedPlugin | undefined,
  ): PluginCapabilitySummary {
    const capabilities: PluginCapabilitySummary = [];
    if (manifest !== undefined) {
      for (const skillName of manifest.skillNames) {
        capabilities.push({
          kind: "skill",
          id: skillName,
          label: skillName,
          detail: "Skill this plugin adds to your agents",
        });
      }
      for (const theme of manifest.themes) {
        capabilities.push({
          kind: "theme",
          id: theme.id,
          label: theme.name,
          detail: theme.description,
        });
      }
    }
    for (const tool of loadedPlugin?.handle.agentTools ?? []) {
      capabilities.push({
        kind: "agent-tool",
        id: tool.name,
        label: tool.name,
        detail: tool.description,
      });
    }
    for (const provider of loadedPlugin?.handle.mentionProviders ?? []) {
      capabilities.push({
        kind: "thread-integration",
        id: `mention:${provider.id}`,
        label: provider.label,
        detail: `Mentions with ${provider.triggers.join(", ")}`,
      });
    }
    return capabilities;
  }

  function list(): InstalledPlugin[] {
    const scheduleRows = listPluginSchedules(deps.db);
    const rows = listInstalledPlugins(deps.db);
    const catalogData = installedCatalogData(rows);
    return rows
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const runtime = getStatus(row);
        const stats = handlerStats.get(row.id);
        const loadedPlugin = loaded.get(row.id);
        const cliRegistration = loadedPlugin?.handle.cli.registration;
        const identity =
          loadedPlugin === undefined ? identities.get(row.id) : undefined;
        const brandingSet = brandingAssetSetFor(row.id);
        const catalogMetadata = catalogData.metadataByPluginId.get(row.id) ?? {
          screenshots: [],
          collections: [],
        };
        return {
          id: row.id,
          source: row.source,
          rootDir: row.rootDir,
          version: loadedPlugin?.manifest.version ?? row.version,
          provenance: row.provenance,
          ...(row.catalogEntryId === null
            ? {}
            : { catalogEntryId: row.catalogEntryId }),
          ...(row.catalogMarketplaceName === null
            ? {}
            : { catalogMarketplaceName: row.catalogMarketplaceName }),
          publisherLabel: pluginPublisherLabel({
            sourceKind: row.sourceKind,
            provenance: row.provenance,
            catalogMarketplaceName: row.catalogMarketplaceName,
            labels: catalogData.publisherLabels,
          }),
          isOrphanedBuiltin:
            row.sourceKind === "builtin" &&
            !bundledPlugins.some(
              (bundled) => bundled.name === row.sourceBuiltinName,
            ),
          sourceDisplay: sourceDisplayForRow(row),
          updateState: updateStateForRow(row),
          enabled: row.enabled,
          description:
            loadedPlugin?.manifest.description ??
            identity?.manifest.description ??
            null,
          name: loadedPlugin?.manifest.name ?? identity?.manifest.name ?? null,
          ...catalogMetadata,
          icon:
            loadedPlugin?.manifest.branding.icon ??
            identity?.manifest.branding.icon ??
            null,
          iconUrl: brandingSet?.compactIcon?.url ?? null,
          status: runtime.status,
          statusDetail: runtime.detail,
          handlerStats: stats
            ? { ...stats }
            : { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
          services: (loadedPlugin?.services ?? []).map((service) => ({
            name: service.record.name,
            state: service.state,
          })),
          schedules: scheduleRows
            .filter((schedule) => schedule.pluginId === row.id)
            .map((schedule) => ({
              name: schedule.name,
              cron: schedule.cron,
              nextRunAt: schedule.nextRunAt,
              lastRunAt: schedule.lastRunAt,
              lastStatus: schedule.lastStatus,
              lastError: schedule.lastError,
            })),
          cliCommand: cliRegistration
            ? { name: cliRegistration.name, summary: cliRegistration.summary }
            : null,
          capabilities: capabilitySummary(
            loadedPlugin?.manifest ?? identity?.manifest,
            loadedPlugin,
          ),
          hasSettings:
            loadedPlugin !== undefined &&
            Object.keys(loadedPlugin.handle.settings.descriptors).length > 0,
          app: appBundles.get(row.id)?.state ?? { hasApp: false, bundle: null },
          logoUrl: brandingSet?.logo?.url ?? null,
          logoDarkUrl: brandingSet?.logoDark?.url ?? null,
          providerIds:
            loadedPlugin?.handle
              .listProviderDeclarations()
              .map((declaration) => declaration.id) ?? [],
          // Declared icons ride the identity like the compact icon, so a
          // row referencing "<pluginId>/<name>" resolves while the plugin is
          // disabled and stops resolving only once it is uninstalled.
          icons: Object.fromEntries(
            [...(brandingSet?.icons ?? [])].map(([name, asset]) => [
              name,
              asset.url,
            ]),
          ),
        };
      });
  }

  type InstalledCatalogMetadata = Pick<
    InstalledPlugin,
    | "categoryId"
    | "category"
    | "screenshots"
    | "collections"
    | "publishedAt"
    | "updatedAt"
  >;

  function cachedMarketplaceManifest(
    marketplace: PluginMarketplaceRow,
  ): MarketplaceManifest | null {
    const cached = marketplaceManifestCache.get(marketplace.name);
    if (cached?.manifestJson === marketplace.manifestJson) {
      return cached.manifest;
    }
    let manifest: MarketplaceManifest | null = null;
    try {
      manifest = parseStoredMarketplaceManifest(marketplace, (message) =>
        logger.warn(message),
      );
    } catch (error) {
      logger.warn(
        `failed to read the stored "${marketplace.name}" marketplace catalog: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    marketplaceManifestCache.set(marketplace.name, {
      manifestJson: marketplace.manifestJson,
      manifest,
    });
    return manifest;
  }

  function installedCatalogData(rows: readonly InstalledPluginRow[]): {
    metadataByPluginId: ReadonlyMap<string, InstalledCatalogMetadata>;
    publisherLabels: ReadonlyMap<string, string>;
  } {
    const rowsByMarketplace = new Map<string, InstalledPluginRow[]>();
    const marketplaceNamesInUse = new Set<string>();
    for (const row of rows) {
      if (row.catalogMarketplaceName === null) continue;
      marketplaceNamesInUse.add(row.catalogMarketplaceName);
      if (row.catalogEntryId === null) continue;
      const marketplaceRows =
        rowsByMarketplace.get(row.catalogMarketplaceName) ?? [];
      marketplaceRows.push(row);
      rowsByMarketplace.set(row.catalogMarketplaceName, marketplaceRows);
    }

    const metadataByPluginId = new Map<string, InstalledCatalogMetadata>();
    const publisherLabels = new Map<string, string>();
    if (marketplaceNamesInUse.size === 0) {
      marketplaceManifestCache.clear();
      return { metadataByPluginId, publisherLabels };
    }
    const marketplaces = listPluginMarketplaces(deps.db);
    const marketplaceByName = new Map(
      marketplaces.map((marketplace) => [marketplace.name, marketplace]),
    );
    const marketplaceNames = new Set(marketplaceByName.keys());
    for (const name of marketplaceManifestCache.keys()) {
      if (!marketplaceNames.has(name)) marketplaceManifestCache.delete(name);
    }
    for (const marketplaceName of marketplaceNamesInUse) {
      const marketplace = marketplaceByName.get(marketplaceName);
      if (marketplace === undefined) continue;
      const manifest = cachedMarketplaceManifest(marketplace);
      publisherLabels.set(
        marketplaceName,
        marketplacePublisherLabel({
          marketplaceName,
          displayName: manifest?.displayName ?? marketplaceName,
        }),
      );
      if (manifest === null) continue;
      const marketplaceRows = rowsByMarketplace.get(marketplaceName) ?? [];
      const entriesById = new Map<
        string,
        MarketplaceManifest["plugins"][number]
      >();
      for (const entry of manifest.plugins) {
        entriesById.set(entry.id, entry);
        if (isBundledMarketplaceEntry(entry)) {
          entriesById.set(entry.source.bundled.plugin, entry);
        }
      }
      for (const row of marketplaceRows) {
        const entry = entriesById.get(row.catalogEntryId ?? "");
        if (entry === undefined) continue;
        try {
          metadataByPluginId.set(row.id, {
            ...catalogEntryMetadata({
              manifest,
              entry,
              base: marketplaceRowIconBase(marketplace),
              warn: (message) => logger.warn(message),
            }),
            collections: marketplaceEntryCollections(manifest, entry.id),
          });
        } catch (error) {
          logger.warn(
            `failed to read catalog metadata for plugin "${row.id}" from marketplace "${marketplace.name}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    return { metadataByPluginId, publisherLabels };
  }

  return {
    isBuiltin: isBuiltinPluginId,

    listThemes() {
      return [...loaded.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([pluginId, plugin]) =>
          plugin.manifest.themes.map((theme) => ({
            id: formatPluginThemeId(pluginId, theme.id),
            pluginId,
            name: theme.name,
            description: theme.description,
          })),
        );
    },

    async readThemeCss(themeId) {
      const theme = findLoadedTheme(themeId);
      if (!theme) return null;
      try {
        const css = await readFile(theme.cssPath, "utf8");
        return css.length <= CUSTOM_THEME_CSS_MAX_LENGTH ? css : null;
      } catch {
        return null;
      }
    },

    readThemeCodeTheme(themeId) {
      const theme = findLoadedTheme(themeId);
      if (!theme) return null;
      return readPluginThemeCodeTheme(
        themeId,
        theme.codeTheme ?? undefined,
        theme.codeThemePaths,
      );
    },

    events: {
      emitThreadEvents(threadId) {
        emitThreadEvent("experimental_thread.events", () => {
          const thread = getThread(deps.db, threadId);
          return thread === null
            ? null
            : {
                thread: buildThreadDto(thread),
                sequence: getLatestThreadSequence(deps.db, { threadId }),
              };
        });
      },
      emitTerminalInput(terminal) {
        emitThreadEvent("experimental_terminal.input", () => ({ terminal }));
      },
      emitThreadCreated(thread) {
        emitThreadEvent("thread.created", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadActive(thread) {
        emitThreadEvent("thread.active", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadIdle(thread) {
        emitThreadEvent("thread.idle", () => ({
          thread: buildThreadDto(thread),
          lastAssistantText: getLastThreadOutput(deps.db, thread.id),
        }));
      },
      emitThreadFailed(thread) {
        emitThreadEvent("thread.failed", () => ({
          thread: buildThreadDto(thread),
          error: getLastThreadErrorMessage(deps.db, thread.id),
        }));
      },
      emitThreadArchived(thread) {
        emitThreadEvent("thread.archived", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadUnarchived(thread) {
        emitThreadEvent("thread.unarchived", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadDeleted(thread) {
        emitThreadEvent("thread.deleted", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitInteractionPending(thread, interaction) {
        emitThreadEvent("interaction.pending", () => ({
          thread: buildThreadDto(thread),
          interaction,
        }));
      },
      emitMessageQueued: buildQueuedMessageEventEmitter("message.queued"),
      emitMessageDispatched:
        buildQueuedMessageEventEmitter("message.dispatched"),
      emitMessageCancelled: buildQueuedMessageEventEmitter("message.cancelled"),
      emitTurnFailed(threadId) {
        // Built lazily inside the emitter: with no listener the failure path
        // pays one map lookup and never touches the database.
        emitThreadEvent("turn.failed", () =>
          buildTurnFailedEvent(deps.db, threadId),
        );
      },
    },

    hooks: {
      listHooks: listPluginHooks,
      invokeHook: invokeIsolated,
      decisionTimeoutMs: DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
    },

    environmentProviders: {
      listEnvironmentCompositions: listPluginEnvironmentCompositions,
      listEnvironmentProviders: listPluginEnvironmentProviders,
      getEnvironmentProvider: getPluginEnvironmentProvider,
      invokeProvider: invokeIsolated,
      decisionTimeoutMs: DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
    },

    serverAccessProviders: {
      list: listPluginServerAccessProviders,
      invoke: async (pluginId, run) => {
        const outcome = await invokeWrapped(pluginId, "server access", run);
        if (!outcome.ok) throw new Error("Server access provider failed");
        return outcome.value;
      },
    },

    machineProviders: {
      listMachineProviders: listPluginMachineProviders,
      getMachineProvider: getPluginMachineProvider,
      invokeProvider: invokeIsolated,
      decisionTimeoutMs: DEFAULT_PLUGIN_HOOK_TIMEOUT_MS,
    },

    bindSdk: bindRuntimeSdk,

    async start() {
      await backfillNormalizedPluginRegistrations();
      await withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        for (const artifact of listPendingGitPluginArtifacts(deps.db)) {
          await withArtifactLock(artifact.path, () =>
            recoverInterruptedGitPluginPromotion(artifact.path),
          );
        }
        await recoverIncompletePluginRollbacks();
      });
      await reconcileBundled();
      await loadAll();
      await withPluginOperationLock(REGISTRATION_MUTATION_KEY, runArtifactGc);
      if (deps.watchBuiltinPluginSources) {
        for (const bundled of bundledPlugins) {
          const row = listInstalledPlugins(deps.db).find(
            (candidate) =>
              candidate.sourceKind === "builtin" &&
              candidate.sourceBuiltinName === bundled.name,
          );
          if (row === undefined) continue;
          const loop = createPluginDevLoop({
            pluginId: row.id,
            targets: async () => {
              const manifest = await readPluginManifest(bundled.rootDir);
              const hasApp = manifest.appEntry !== undefined;
              const hasHost = manifest.hostEntry !== undefined;
              // A dropped entry can no longer rebuild, so its last build
              // problem would otherwise stick forever.
              if (!hasApp) setDevBuildProblem(row.id, "frontend", null);
              if (!hasHost) setDevBuildProblem(row.id, "host", null);
              return { hasApp, hasHost };
            },
            buildApp: async () => {
              try {
                await buildPluginApp(
                  bundled.rootDir,
                  deps.appVersion,
                  await getPluginBuildToolchain(deps),
                );
                setDevBuildProblem(row.id, "frontend", null);
                notifyPluginsChanged();
              } catch (error) {
                setDevBuildProblem(
                  row.id,
                  "frontend",
                  error instanceof Error ? error.message : String(error),
                );
                notifyPluginsChanged();
                throw error;
              }
            },
            buildHost: async () => {
              try {
                await buildPluginHost(
                  bundled.rootDir,
                  deps.appVersion,
                  await getPluginBuildToolchain(deps),
                );
                setDevBuildProblem(row.id, "host", null);
                notifyPluginsChanged();
              } catch (error) {
                setDevBuildProblem(
                  row.id,
                  "host",
                  error instanceof Error ? error.message : String(error),
                );
                notifyPluginsChanged();
                throw error;
              }
            },
            reloadPlugin: async () => {
              const problem = await withLifecycleLock(row.id, async () => {
                const current = getInstalledPlugin(deps.db, row.id);
                if (current === undefined) return null;
                await disposeOne(row.id);
                return loadOne(current);
              });
              await syncCliSkill();
              notifyPluginsChanged();
              if (problem !== null) throw new Error(problem);
            },
            log: (message) => logger.info(`plugin ${row.id}: ${message}`),
          });
          const watcher = watch(
            bundled.rootDir,
            { recursive: true },
            (_event, filename) => {
              dispatchPluginSourceWatchChange(loop.handleChange, filename);
            },
          );
          watcher.on("close", () => loop.dispose());
          builtinSourceWatchers.push(watcher);
        }
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    async stop() {
      for (const watcher of builtinSourceWatchers.splice(0)) watcher.close();
      await disposeAll();
      await syncCliSkill();
      notifyPluginsChanged();
    },

    handleUncaughtException,

    list,

    async install(source, selection) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const parsed = parsePluginSource(source);
        if (parsed.kind === "git") {
          return installGitSource(parsed, source, selection);
        }
        if (parsed.kind === "path") {
          return installPathSource(parsed.path, selection);
        }
        if (selection.kind !== "root") {
          throw new Error(
            `install refused: ${selection.kind === "entry" ? "--plugin" : "--subdirectory"} applies to git: and path: sources only`,
          );
        }
        if (parsed.kind === "builtin") return installBuiltinSource(parsed);
        refuseBuiltinShadow(derivePluginId(parsed.name));
        return installNpmSource(parsed, source);
      });
    },

    async installOfficialPlugin(name) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const bundled = bundledPlugins.find(
          (plugin) => plugin.name === name && !plugin.autoInstall,
        );
        if (bundled === undefined) {
          throw new Error(`unknown official plugin "${name}"`);
        }
        return installBuiltinSource({ kind: "builtin", name });
      });
    },

    async installCatalogPlugin(entry) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const parsed = parsePluginSource(entry.source);
        const context: InstallContext = {
          provenance: {
            kind: "catalog",
            marketplace: entry.marketplace,
            entryId: entry.entryId,
          },
          expectedPluginId: entry.pluginId,
          ...(entry.npmRegistry === undefined
            ? {}
            : { npmRegistry: entry.npmRegistry }),
          ...(entry.expectedGitCommit === undefined
            ? {}
            : { expectedGitCommit: entry.expectedGitCommit }),
          ...(entry.expectedNpmVersion === undefined
            ? {}
            : { expectedNpmVersion: entry.expectedNpmVersion }),
          ...(entry.expectedNpmIntegrity === undefined
            ? {}
            : { expectedNpmIntegrity: entry.expectedNpmIntegrity }),
        };
        if (parsed.kind === "git") {
          return installGitSource(
            parsed,
            entry.source,
            entry.selection,
            context,
          );
        }
        if (parsed.kind === "npm") {
          if (entry.selection.kind !== "root") {
            throw new Error(
              `catalog entry "${entry.entryId}" selects a subdirectory of an npm package`,
            );
          }
          refuseBuiltinShadow(derivePluginId(parsed.name));
          return installNpmSource(parsed, entry.source, context);
        }
        throw new Error(
          `catalog entry "${entry.entryId}" has an unsupported source "${entry.source}"`,
        );
      });
    },

    resolveCatalogNpmSource: (args) =>
      managedPluginArtifacts.resolveNpmCandidateForPlan(args),

    installPath: (path) =>
      withPluginOperationLock(REGISTRATION_MUTATION_KEY, () =>
        installPathSource(path, ROOT_PLUGIN_SOURCE_SELECTION),
      ),

    ...pluginUpdates,

    async remove(id) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const row = getInstalledPlugin(deps.db, id);
        await withLifecycleLock(id, () => disposeOne(id));
        statuses.delete(id);
        handlerStats.delete(id);
        agentToolProblems.delete(id);
        appBundles.delete(id);
        brandingAssets.delete(id);
        identities.delete(id);
        const removed = row
          ? row.sourceKind === "builtin"
            ? markInstalledPluginRemoved(deps.db, id)
            : deleteInstalledPlugin(deps.db, id)
          : false;
        if (removed && row) {
          deps.onPluginUnregistered?.(id);
          // The uninstalled tree is no longer reloadable, so stop the module
          // resolve hook from scanning it on every later import.
          forgetMutableRoot(row.rootDir);
          deletePluginSchedules(deps.db, id);
          deleteAllPluginSettings(deps.db, id);
          await rm(pluginSecretsDir(deps.dataDir, id), {
            recursive: true,
            force: true,
          });
          logger.info(
            `plugin ${id} removed from ${row.source}; its settings, secrets, and schedules were deleted`,
          );
          const managedDir =
            row.activeArtifactId === null && row.sourceKind === "git"
              ? row.rootDir
              : row.activeArtifactId === null &&
                  row.sourceKind === "npm" &&
                  row.sourceNpmPackage !== null &&
                  row.sourceNpmRequestedSpec !== null
                ? npmInstallPrefix(
                    deps.dataDir,
                    row.sourceNpmPackage,
                    row.sourceNpmRequestedSpec || "latest",
                  )
                : undefined;
          if (managedDir !== undefined) {
            await rm(managedDir, { recursive: true, force: true });
          }
        }
        await syncCliSkill();
        notifyPluginsChanged();
        return removed;
      });
    },

    async setEnabled(id, enabled) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        if (!setInstalledPluginEnabled(deps.db, id, enabled)) return undefined;
        if (enabled) {
          const row = getInstalledPlugin(deps.db, id);
          if (row) {
            await withLifecycleLock(id, () => loadOne(row));
          }
        } else {
          await withLifecycleLock(id, async () => {
            await disposeOne(id);
            if ((hungServices.get(id)?.size ?? 0) === 0) {
              setStatus(id, "disabled");
            }
          });
        }
        if (!enabled) {
          deps.onPluginUnregistered?.(id);
        }
        await syncCliSkill();
        notifyPluginsChanged();
        return list().find((p) => p.id === id);
      });
    },

    async reload(id) {
      const rows = listInstalledPlugins(deps.db).filter(
        (row) => id === undefined || row.id === id,
      );
      const failures: string[] = [];
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        const problem = await withLifecycleLock(row.id, () => loadOne(row));
        if (problem !== null) {
          failures.push(`plugin "${row.id}" reload failed: ${problem}`);
        }
      }
      await syncCliSkill();
      notifyPluginsChanged();
      const plugins = list();
      return failures.length === 0
        ? { ok: true, plugins }
        : { ok: false, error: failures.join("; "), plugins };
    },

    getApi(id) {
      return loaded.get(id)?.handle.api;
    },

    isPluginLoaded(id) {
      return loaded.has(id);
    },

    getAppAsset(id, kind) {
      if (!loaded.has(id)) return undefined;
      const assets = appBundles.get(id)?.assets;
      if (!assets) return undefined;
      const path = kind === "js" ? assets.jsPath : assets.cssPath;
      if (path === null) return undefined;
      return { path, hash: assets.hash };
    },

    getBrandingAsset(id, variant) {
      const set = brandingAssetSetFor(id);
      const asset =
        variant === "icon"
          ? set?.compactIcon
          : variant === "logo-dark"
            ? set?.logoDark
            : set?.logo;
      if (!asset) return undefined;
      return assetPayload(asset);
    },

    getIconAsset(id, name) {
      const asset = brandingAssetSetFor(id)?.icons.get(name);
      if (!asset) return undefined;
      return assetPayload(asset);
    },

    listHostArtifactGenerations() {
      return [...hostArtifacts.entries()]
        .filter(([id]) => loaded.has(id))
        .map(([pluginId, artifact]) => ({
          pluginId,
          generation: artifact.generation,
        }))
        .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    },

    handleHostWorkerExit(args) {
      const plugin = loaded.get(args.pluginId);
      const artifact = hostArtifacts.get(args.pluginId);
      if (
        plugin === undefined ||
        artifact === undefined ||
        artifact.generation !== args.generation
      ) {
        return;
      }
      for (const handler of [...plugin.handle.hostWorkerExitHandlers]) {
        void invokeWrapped(args.pluginId, "host worker exit", async () =>
          handler({ hostId: args.authenticatedHostId }),
        );
      }
    },

    handleHostSignal(args) {
      const plugin = loaded.get(args.pluginId);
      const artifact = hostArtifacts.get(args.pluginId);
      if (
        plugin === undefined ||
        artifact === undefined ||
        artifact.generation !== args.generation
      ) {
        return;
      }
      const subscriptions = plugin.handle.hostSignalHandlers.filter(
        (subscription) => subscription.signal === args.signal,
      );
      for (const subscription of subscriptions) {
        void invokeWrapped(
          args.pluginId,
          `host signal ${args.signal}`,
          async () => {
            const result = await subscription.payloadSchema[
              "~standard"
            ].validate(args.payload);
            if (result.issues !== undefined) {
              throw new Error(
                `host signal payload validation failed: ${result.issues
                  .map((issue) => issue.message)
                  .join("; ")}`,
              );
            }
            await subscription.handler({
              hostId: args.authenticatedHostId,
              payload: result.value,
            });
          },
        );
      }
    },

    async getSettings(id) {
      const plugin = loaded.get(id);
      if (!plugin) return undefined;
      return buildPluginSettingsView({
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        descriptors: plugin.handle.settings.descriptors,
      });
    },

    async updateSettings(id, values) {
      const plugin = loaded.get(id);
      if (!plugin) return undefined;
      const storeArgs = {
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        descriptors: plugin.handle.settings.descriptors,
      };
      const errors = validateSettingsUpdate(storeArgs.descriptors, values);
      if (errors.length > 0) {
        throw new PluginSettingsValidationError(errors.join("; "));
      }
      const prev = await readPluginSettingsValues(storeArgs);
      await writePluginSettingsUpdate({ ...storeArgs, values });
      const next = await readPluginSettingsValues(storeArgs);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        for (const listener of plugin.handle.settings.listeners) {
          try {
            listener(next, prev);
          } catch (error) {
            logger.warn(
              `plugin ${id} settings onChange listener failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        deps.onSettingsChanged?.(id);
        notifyPluginsChanged();
        if (statuses.get(id)?.status === "needs-configuration") {
          const row = getInstalledPlugin(deps.db, id);
          if (row) {
            await withLifecycleLock(id, async () => {
              await disposeOne(id);
              await loadOne(row);
            });
            notifyPluginsChanged();
          }
        }
      }
      return buildPluginSettingsView(storeArgs);
    },

    getHttpRoute(id, method, path) {
      const normalizedMethod = method.toUpperCase();
      return wireLookup(id, (plugin) =>
        plugin.handle.httpRoutes.find(
          (route) => route.method === normalizedMethod && route.path === path,
        ),
      );
    },

    getWebSocketRoute(id, path) {
      return wireLookup(id, (plugin) =>
        plugin.handle.websocketRoutes.find((route) => route.path === path),
      );
    },

    getRpcHandler(id, method) {
      return wireLookup(id, (plugin) => plugin.handle.rpcHandlers.get(method));
    },

    async invokeHttpRoute(id, route, context) {
      const outcome = await invokeWrapped(
        id,
        `http ${route.method} ${route.path}`,
        async () => {
          const response = await route.handler(context);
          return adoptHttpRouteResponse(response);
        },
      );
      if (outcome.ok) return outcome.value;
      return context.json(
        { ok: false, error: `plugin route failed: ${outcome.error}` },
        500,
      );
    },

    async invokeWebSocketRoute(id, route, context) {
      const outcome = await invokeWrapped(
        id,
        `websocket ${route.path} connect`,
        () => {
          const handlers = route.handler(context);
          if (
            typeof handlers !== "object" ||
            handlers === null ||
            Array.isArray(handlers)
          ) {
            throw new Error("websocket route handler must return an object");
          }
          for (const name of [
            "onOpen",
            "onMessage",
            "onClose",
            "onError",
          ] as const) {
            const callback = handlers[name];
            if (callback !== undefined && typeof callback !== "function") {
              throw new Error(
                `websocket route handler ${name} must be a function`,
              );
            }
          }
          return handlers;
        },
      );
      return outcome.ok
        ? { ok: true, handlers: outcome.value }
        : { ok: false, error: outcome.error };
    },

    async invokeWebSocketEvent(id, route, event, run) {
      await invokeWrapped(id, `websocket ${route.path} ${event}`, run);
    },

    async invokeRpcHandler(id, method, handler, input) {
      const outcome = await invokeWrapped(id, `rpc ${method}`, async () => {
        const parsedInput = await validateRpcValue(
          handler.inputSchema,
          input,
          "input",
          throwRpcBoundaryError,
        );
        const result = await handler.handler(parsedInput);
        const parsedOutput = await validateRpcValue(
          handler.outputSchema,
          result,
          "output",
          throwRpcBoundaryError,
        );
        return normalizeRpcJsonResult(parsedOutput, throwRpcBoundaryError);
      });
      if (outcome.ok) return { ok: true, result: outcome.value };
      if (outcome.cause instanceof PluginRpcBoundaryError) {
        return { ok: false, error: outcome.cause.rpcError };
      }
      return {
        ok: false,
        error: { code: "handler_error", message: outcome.error },
      };
    },

    async httpToken(id, options) {
      if (!getInstalledPlugin(deps.db, id)) return undefined;
      const dir = pluginSecretsDir(deps.dataDir, id);
      if (options?.rotate) {
        await deleteSecretFile(join(dir, HTTP_TOKEN_FILE));
      }
      return readOrCreateSecretFile({
        bytes: 32,
        dataDir: dir,
        encoding: "hex",
        fileName: HTTP_TOKEN_FILE,
      });
    },

    listCliContributions() {
      return cliContributions();
    },

    async runCliCommand(id, argv, ctx) {
      const fail = (stderr: string) =>
        enforcePluginCliOutputLimit(
          { exitCode: 1, stdout: "", stderr },
          argv.includes("--json"),
        );
      const plugin = loaded.get(id);
      if (!plugin) {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) return fail(`unknown plugin "${id}"`);
        const { status, detail } = getStatus(row);
        return fail(
          `plugin "${id}" is not running (status: ${status}${detail ? ` — ${detail}` : ""})`,
        );
      }
      const registration = plugin.handle.cli.registration;
      if (!registration) {
        return fail(`plugin "${id}" registers no CLI command`);
      }
      const outcome = await invokeWrapped(
        id,
        `cli ${registration.name}`,
        async () => {
          const result = await registration.run(argv, ctx);
          if (typeof result?.exitCode !== "number") {
            throw new Error(
              "cli run() must return { exitCode: number, stdout?, stderr? }",
            );
          }
          return enforcePluginCliOutputLimit(
            {
              exitCode: result.exitCode,
              stdout: typeof result.stdout === "string" ? result.stdout : "",
              stderr: typeof result.stderr === "string" ? result.stderr : "",
            },
            argv.includes("--json"),
          );
        },
      );
      if (outcome.ok) return outcome.value;
      return fail(`bb ${registration.name} failed: ${outcome.error}`);
    },

    listSkillRootContributions() {
      return [...loaded.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([pluginId, plugin]) =>
          plugin.manifest.skillsRootPaths.map((rootPath) => ({
            pluginId,
            rootPath,
          })),
        );
    },

    listAgentTools() {
      return collectAgentTools().map(({ pluginId, record }) =>
        toToolContribution(pluginId, record),
      );
    },

    async resolveAgentConfiguration({ context, skillIdsByPlugin }) {
      const allTools = collectAgentTools();
      const tools: PluginAgentToolContribution[] = [];
      const selectedSkillIdsByPlugin = new Map<string, ReadonlySet<string>>();
      const dynamicInstructions: Array<{ pluginId: string; text: string }> = [];
      const plugins = [...loaded.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pluginId, plugin]) => ({
          pluginId,
          provider: plugin.handle.agentConfigurationProvider,
        }));
      const configuringPluginIds = plugins
        .filter(({ provider }) => provider !== null)
        .map(({ pluginId }) => pluginId);
      const metadataByPluginId = new Map<string, JsonObject>();
      for (const row of listThreadPluginMetadataRows(
        deps.db,
        context.thread.id,
        configuringPluginIds,
      )) {
        const metadata = parsePersistedPluginMetadata(row.metadataJson);
        if (metadata === undefined) {
          logger.warn(
            `Ignoring corrupt plugin metadata for thread ${context.thread.id}, plugin ${row.pluginId}`,
          );
        }
        metadataByPluginId.set(row.pluginId, metadata ?? {});
      }

      for (const { pluginId, provider } of plugins) {
        const pluginTools = allTools.filter(
          (entry) => entry.pluginId === pluginId,
        );
        if (provider === null) {
          tools.push(
            ...pluginTools.map(({ record }) =>
              toToolContribution(pluginId, record),
            ),
          );
          continue;
        }

        const knownSkillIds = new Set(skillIdsByPlugin.get(pluginId) ?? []);
        const knownToolIds = new Set(
          pluginTools.map(({ record }) => record.name),
        );
        const outcome = await invokeWrapped(pluginId, "agent configure", () =>
          normalizePluginAgentConfiguration({
            knownSkillIds,
            knownToolIds,
            pluginId,
            value: provider({
              ...context,
              pluginMetadata: deepFreezePluginMetadata(
                metadataByPluginId.get(pluginId) ?? {},
              ),
            }),
          }),
        );
        if (!outcome.ok) {
          selectedSkillIdsByPlugin.set(pluginId, new Set());
          continue;
        }

        const selectedTools = new Set(outcome.value.toolIds);
        const parameterOverrides = outcome.value.toolParameterOverrides;
        tools.push(
          ...pluginTools
            .filter(({ record }) => selectedTools.has(record.name))
            .map(({ record }) =>
              toToolContribution(
                pluginId,
                record,
                parameterOverrides.get(record.name) ?? record.inputSchema,
              ),
            ),
        );
        selectedSkillIdsByPlugin.set(pluginId, new Set(outcome.value.skillIds));
        if (outcome.value.instructions !== null) {
          dynamicInstructions.push({
            pluginId,
            text: outcome.value.instructions,
          });
        }
      }

      return { tools, selectedSkillIdsByPlugin, dynamicInstructions };
    },

    async resolveProviderEnv({ providerId, context }) {
      const entries: PluginResolvedProviderEnv["entries"] = [];
      const ownerByName = new Map<string, string>();
      for (const [pluginId, plugin] of loaded) {
        const resolve = plugin.handle.providerEnvResolvers.get(providerId);
        if (resolve === undefined) continue;
        const outcome = await invokeWrapped(
          pluginId,
          `provider environment for ${providerId}`,
          async () =>
            raceTimeout(
              Promise.resolve(resolve(context)).then((value) =>
                validatePluginProviderEnvEntries(value),
              ),
              providerEnvResolveTimeoutMs,
              `timed out after ${providerEnvResolveTimeoutMs}ms`,
            ),
        );
        if (!outcome.ok) continue;
        for (const entry of outcome.value) {
          const earlierPluginId = ownerByName.get(entry.name);
          if (earlierPluginId !== undefined) {
            logger.error(
              {
                providerId,
                name: entry.name,
                winnerPluginId: earlierPluginId,
                loserPluginId: pluginId,
              },
              "Plugin provider environment conflict; later contribution dropped",
            );
            continue;
          }
          ownerByName.set(entry.name, pluginId);
          entries.push({ ...entry, source: { plugin: pluginId } });
        }
      }
      return { entries };
    },

    async resolveProviderEnvHealth({ providerId, context }) {
      for (const [pluginId, plugin] of loaded) {
        if (!plugin.handle.providerEnvResolvers.has(providerId)) continue;
        const resolve =
          plugin.handle.providerEnvHealthResolvers.get(providerId);
        if (resolve === undefined) continue;
        const outcome = await invokeWrapped(
          pluginId,
          `provider environment health for ${providerId}`,
          async () => {
            const value = await raceTimeout(
              Promise.resolve(resolve(context)),
              providerEnvResolveTimeoutMs,
              `timed out after ${providerEnvResolveTimeoutMs}ms`,
            );
            if (value === null) return null;
            if (value.label.trim().length === 0) {
              throw new Error("label must not be empty");
            }
            if (value.statusMessage.trim().length === 0) {
              throw new Error("statusMessage must not be empty");
            }
            return value;
          },
        );
        if (outcome.ok && outcome.value !== null) return outcome.value;
      }
      return null;
    },

    listInstructionContributions() {
      const out: PluginInstructionContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const provider = plugin.handle.instructionProvider;
        if (provider === null) continue;
        out.push({ pluginId: id, provider });
      }
      return out;
    },

    findAgentTool(name) {
      return collectAgentTools().find((entry) => entry.record.name === name);
    },

    async invokeAgentTool({ pluginId, record, input, ctx }) {
      const parsed = record.parse(input);
      if (!parsed.ok) {
        return {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: `Invalid arguments for tool "${record.name}": ${parsed.error}`,
            },
          ],
        };
      }
      const outcome = await invokeWrapped(
        pluginId,
        `tool ${record.name}`,
        async () => {
          const result = await record.execute(parsed.value, ctx);
          return normalizeAgentToolResult(record.name, result);
        },
      );
      if (outcome.ok) return outcome.value;
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: `Tool "${record.name}" failed: ${outcome.error}`,
          },
        ],
      };
    },

    listMentionProviderContributions() {
      const contributions: PluginMentionProviderContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.mentionProviders) {
          contributions.push({
            pluginId: id,
            id: record.id,
            label: record.label,
            triggers: record.triggers,
          });
        }
      }
      return contributions;
    },

    async searchMentions(args) {
      const entries = [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (entries.length === 0) return [];
      const tasks: Array<Promise<PluginMentionSearchGroup | null>> = [];
      for (const [id, plugin] of entries) {
        for (const record of [...plugin.handle.mentionProviders]) {
          if (!record.triggers.includes(args.trigger)) continue;
          tasks.push(
            (async () => {
              const outcome = await invokeWrapped(
                id,
                `mention search ${record.id}`,
                async () => {
                  const searchPromise = (async () =>
                    record.search({
                      trigger: args.trigger,
                      query: args.query,
                      projectId: args.projectId,
                      threadId: args.threadId,
                    }))();
                  searchPromise.catch(() => {});
                  const result = await raceTimeout(
                    searchPromise,
                    mentionSearchTimeoutMs,
                    `timed out after ${mentionSearchTimeoutMs}ms`,
                  );
                  return normalizeMentionSearchItems(record.id, result);
                },
              );
              if (!outcome.ok || outcome.value.length === 0) return null;
              return {
                pluginId: id,
                providerId: record.id,
                label: record.label,
                items: outcome.value,
              };
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (group): group is PluginMentionSearchGroup => group !== null,
      );
    },

    async resolveMention({ pluginId, itemId }) {
      const separatorIndex = itemId.indexOf(":");
      const providerId =
        separatorIndex > 0 ? itemId.slice(0, separatorIndex) : "";
      const providerItemId =
        separatorIndex > 0 ? itemId.slice(separatorIndex + 1) : "";
      if (providerId.length === 0 || providerItemId.length === 0) {
        return {
          ok: false,
          error: `malformed plugin mention item id ${JSON.stringify(itemId)}`,
        };
      }
      const lookup = wireLookup(pluginId, (plugin) =>
        plugin.handle.mentionProviders.find(
          (record) => record.id === providerId,
        ),
      );
      if (lookup.outcome === "unknown-plugin") {
        return { ok: false, error: `unknown plugin "${pluginId}"` };
      }
      if (lookup.outcome === "not-running") {
        const detail = lookup.detail ? ` — ${lookup.detail}` : "";
        return {
          ok: false,
          error: `plugin "${pluginId}" is not running (status: ${lookup.status}${detail})`,
        };
      }
      if (lookup.outcome === "not-found") {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no mention provider "${providerId}"`,
        };
      }
      const provider = lookup.value;
      const outcome = await invokeWrapped(
        pluginId,
        `mention resolve ${providerId}`,
        async () => {
          const resolvePromise = (async () =>
            provider.resolve(providerItemId))();
          resolvePromise.catch(() => {});
          const result: unknown = await raceTimeout(
            resolvePromise,
            mentionResolveTimeoutMs,
            `timed out after ${mentionResolveTimeoutMs}ms`,
          );
          const context = (result as { context?: unknown } | null)?.context;
          if (typeof context !== "string" || context.trim().length === 0) {
            throw new Error(
              `mention provider "${providerId}" resolve() must return { context: string }`,
            );
          }
          return context;
        },
      );
      if (outcome.ok) return { ok: true, context: outcome.value };
      return { ok: false, error: outcome.error };
    },

    async readLogTail(id, tail) {
      if (!getInstalledPlugin(deps.db, id)) return undefined;
      return readPluginLogTail(deps.dataDir, id, tail);
    },

    async sweepDueSchedules(now) {
      if (loaded.size === 0) return;
      const due = listDuePluginSchedules(deps.db, {
        now,
        limit: SCHEDULE_SWEEP_BATCH_SIZE,
      });
      for (const row of due) {
        const schedule = loaded
          .get(row.pluginId)
          ?.handle.schedules.find((record) => record.name === row.name);
        if (!schedule) continue;
        let newNextRunAt: number;
        try {
          newNextRunAt = nextCronRunAt(schedule.cron, now);
        } catch (error) {
          logger.warn(
            `[plugin:${row.pluginId}] schedule ${row.name} has an invalid cron: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
        const claimed = claimPluginScheduledRun(deps.db, {
          pluginId: row.pluginId,
          name: row.name,
          expectedNextRunAt: row.nextRunAt,
          newNextRunAt,
          now,
        });
        if (!claimed) continue;
        const outcome = await invokeWrapped(
          row.pluginId,
          `schedule ${row.name}`,
          () => schedule.fn(),
        );
        recordPluginScheduleResult(deps.db, {
          pluginId: row.pluginId,
          name: row.name,
          status: outcome.ok ? "ok" : "error",
          error: outcome.ok ? null : outcome.error,
          now: Date.now(),
        });
      }
    },
  };
}
