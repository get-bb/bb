import { watch, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { CronExpressionParser } from "cron-parser";
import type { Context } from "hono";
import { createJiti } from "jiti";
import semver from "semver";
import { z } from "zod";
import type { DbConnection } from "@bb/db";
import {
  PLUGIN_SDK_MAJOR,
  PLUGIN_SDK_VERSION,
  CUSTOM_THEME_CSS_MAX_LENGTH,
  formatPluginThemeId,
  type PluginThemeMeta,
  type DynamicTool,
  type Thread,
  type ToolCallResponse,
} from "@bb/domain";
// The build engine's natives (esbuild, Tailwind oxide) are dynamically
// imported inside buildPluginApp — importing this loads nothing heavy.
import { buildPluginApp, createPluginDevLoop } from "@bb/plugin-build";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk";
import { deleteSecretFile, readOrCreateSecretFile } from "@bb/secret-storage";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import {
  claimPluginScheduledRun,
  createPluginArtifact,
  getPluginArtifact,
  getPluginStateSnapshot,
  deleteAllPluginSettings,
  deleteInstalledPlugin,
  deletePluginSchedules,
  getInstalledPluginRegistration,
  getInstalledPlugin,
  getMarketplace,
  getPluginArtifactByResolution,
  getThread,
  listDuePluginSchedules,
  listInstalledPlugins,
  listIncompletePluginRollbackSnapshots,
  listUnnormalizedPluginRegistrations,
  listPluginSchedules,
  listRecentPluginArtifacts,
  markInstalledPluginRemoved,
  normalizeInstalledPluginRegistration,
  prunePluginSchedules,
  recordPluginScheduleResult,
  setInstalledPluginEnabled,
  setInstalledPluginUpdateState,
  setInstalledPluginSourceClassification,
  setInstalledPluginLastFailure,
  setPluginArtifactValidation,
  setPluginStateSnapshotRollbackPending,
  setPluginStateSnapshotStatus,
  upsertInstalledPlugin,
  upsertPluginSchedule,
  type InstalledPluginRow,
  type LegacyPluginExactResolution,
  type PluginExactResolution,
  type PluginProvenance,
  type PluginSourceIntent,
  type PluginStateSnapshotRow,
} from "@bb/db";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";
import { toThreadResponseFromThread } from "../threads/thread-runtime-display.js";
import {
  loadPluginAppBundle,
  loadPluginLogos,
  parsePluginAppBundleMeta,
  readPluginAppBundleMeta,
  validatePluginArtifactMeta,
  type PluginAppBundleSnapshot,
  type PluginAppState,
  type PluginLogoSet,
  type PluginLogoVariant,
} from "./app-bundle.js";
import {
  isCommitSha,
  gitArtifactCacheDir,
  hashInstallDir,
  npmArtifactCacheDir,
  npmInstallPrefix,
  parsePluginSource,
  promoteImmutableDir,
  realPathInside,
  runInstallCommand,
} from "./install-sources.js";
import {
  createNpmResolverRun,
  evaluateCompatibility,
  gitResolvedVersion,
  resolveGitRef,
  resolveGitUpdate,
  resolveNpmUpdate,
  selectNpmCandidate,
  type CompatibilityProblem,
  type GitRefKind,
  type NpmResolvedCandidate,
  type NpmSourceIntentForResolution,
  type PluginResolvedUpdateVersion,
  type PluginUpdateResolution,
} from "./update-resolver.js";
import {
  derivePluginId,
  readPluginManifest,
  type PluginManifest,
} from "./manifest.js";
import {
  BUILTIN_PLUGIN_NAMES,
  builtinPluginSource,
  listBuiltinPluginRegistrations,
  type BuiltinPluginRegistration,
} from "./builtin-registry.js";
import { marketplacePolicyWideningProblem } from "../marketplaces/catalog.js";
import {
  createPluginApi,
  isNeedsConfigurationError,
  RESERVED_AGENT_TOOL_NAMES,
  type BbPluginApi,
  type PluginAgentToolContext,
  type PluginAgentToolRecord,
  type PluginApiHandle,
  type PluginBackgroundServiceRecord,
  type PluginCliContext,
  type PluginHttpRouteRecord,
  type PluginMentionTrigger,
  type PluginRpcHandler,
  type PluginThreadActionRecord,
  type PluginThreadActionToast,
  type PluginThreadEventName,
  type PluginThreadEventPayloads,
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
  validatePluginSettingsUpdate,
  writePluginSettingsUpdate,
  PluginSettingsValidationError,
  type PluginSettingsView,
} from "./plugin-settings.js";
import {
  createPluginStateSnapshotOnDisk,
  readPluginSnapshotRegistration,
  restorePluginHostStateSnapshot,
  restorePluginStateSnapshot,
} from "./plugin-state-snapshot.js";
import {
  garbageCollectPluginArtifacts,
  pluginArtifactStorageRoot,
} from "./plugin-artifact-gc.js";

/**
 * Live status of an installed plugin. Rows in the `plugins` table hold
 * durable registration facts; this status lives in loader memory and is
 * served via GET /api/v1/plugins.
 */
export type PluginRuntimeStatus =
  | "running"
  | "error"
  | "incompatible"
  | "missing"
  | "disabled"
  // A background service ignored its abort signal past the stop bound; the
  // plugin is not re-loaded until the hung start() promise settles.
  | "degraded"
  // Reported by the plugin itself (bb.status.needsConfiguration or a service
  // throwing NeedsConfigurationError): loaded but waiting on user setup.
  | "needs-configuration";

/**
 * Cumulative wall-time accounting for a plugin's event-handler invocations
 * this server session (design §3 failure isolation: "the app got janky"
 * becomes "plugin X spent Ns"). Survives reloads; dropped on remove.
 */
export interface PluginHandlerStats {
  count: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
}

/** Live state of one registered background service. */
export type PluginServiceState = "running" | "backoff" | "stopped";

export interface PluginServiceEntry {
  name: string;
  state: PluginServiceState;
}

export interface PluginScheduleEntry {
  name: string;
  cron: string;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: "running" | "ok" | "error" | null;
  lastError: string | null;
}

export interface PluginListEntry {
  id: string;
  source: string;
  rootDir: string;
  version: string;
  provenance: "builtin" | "direct" | "marketplace";
  marketplaceName?: string;
  sourceDisplay: string;
  updateState: {
    outcome?: PluginUpdateCheckEntry["outcome"];
    availableVersion?: string;
    blockedVersion?: string;
    blockedReasons?: string[];
    lastCheckAt?: number;
    lastFailure?: { version: string; at: number; detail: string };
  };
  enabled: boolean;
  /** Manifest description (package.json), null when not currently loaded. */
  description: string | null;
  /**
   * `bb.displayName` — human nav/header label; null when not declared or the
   * plugin is not currently loaded (falls back to the id in the UI).
   */
  displayName: string | null;
  /** `bb.icon` — host icon-name hint; null when not declared or unloaded. */
  icon: string | null;
  status: PluginRuntimeStatus;
  statusDetail: string | null;
  handlerStats: PluginHandlerStats;
  /** Background services of the loaded plugin; empty when not loaded. */
  services: PluginServiceEntry[];
  /** Durable schedule rows (survive dispose; deleted with the plugin). */
  schedules: PluginScheduleEntry[];
  /** The plugin's registered `bb` subcommand; null when none or not loaded. */
  cliCommand: { name: string; summary: string } | null;
  /**
   * True when the loaded plugin declared at least one setting via
   * bb.settings.define — drives the app's per-plugin settings nav entries.
   * False while the plugin is not loaded (its schema only exists once the
   * factory has run).
   */
  hasSettings: boolean;
  /**
   * Frontend bundle state (design §5.1), refreshed each time the plugin
   * loads. `{ hasApp: false, bundle: null }` until a load has read the
   * manifest this session (e.g. disabled-at-boot plugins).
   */
  app: PluginAppState;
  /**
   * Hash-busted URL of the plugin's logo asset (logo.(svg|png|webp) at the
   * plugin root, or the manifest's `bb.logo`). Null when the plugin ships
   * no logo — or is not currently loaded (the asset route only serves live
   * plugins, so an unservable URL never rides the inventory).
   */
  logoUrl: string | null;
  /**
   * Hash-busted URL of the optional dark-theme logo variant
   * (logo-dark.(svg|png|webp) at the plugin root, or the manifest's
   * `bb.logoDark`). Same gating as logoUrl; the frontend prefers it while
   * the app is in dark mode.
   */
  logoDarkUrl: string | null;
}

/**
 * Runner state for one background service instance. `current` is the live
 * start() promise; `restartTimer` is pending backoff. `disposed` stops the
 * settle handler from restarting a service that is being shut down.
 */
interface ServiceRuntime {
  record: PluginBackgroundServiceRecord;
  state: PluginServiceState;
  controller: AbortController | null;
  current: Promise<void> | null;
  restartTimer: NodeJS.Timeout | null;
  consecutiveCrashes: number;
  startedAt: number;
  disposed: boolean;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  handle: PluginApiHandle;
  services: ServiceRuntime[];
  isBuiltin: boolean;
  builtinName: string | null;
}

export interface PluginServiceDeps {
  db: DbConnection;
  /** Thread DTO assembly for lifecycle events + plugin-signal broadcast +
   * the `plugins-changed` system broadcast on lifecycle completion. */
  hub: Pick<
    NotificationHub,
    "getDaemonSessionIdForHost" | "notifyPluginSignal" | "notifySystem"
  >;
  logger: ServerLogger;
  pendingInteractions?: Pick<
    import("../interactions/pending-interactions.js").PendingInteractionLifecycle,
    "requestPluginInteraction" | "interruptPluginInteractions"
  >;
  /** BB data dir: plugin sqlite files and secrets live under <dataDir>/plugins/<id>/. */
  dataDir: string;
  /** BB app version, checked against manifests' engines.bb range. */
  appVersion: string;
  /** The `plugins` experiment gate for user-installed plugins, read live. */
  isEnabled: () => boolean;
  /** The `bbConnect` experiment gate for the builtin connect plugin, read live. */
  isConnectEnabled: () => boolean;
  /** Declared first-party plugins installed by default; test-only override. */
  builtinPlugins?: readonly BuiltinPluginRegistration[];
  /** Managed source-development only: rebuild and reload builtin frontends. */
  watchBuiltinPluginSources?: boolean;
  /** Factory-execution time box; overridable in tests. */
  loadTimeoutMs?: number;
  /** Bound on awaiting a service's start() promise at dispose; tests shrink it. */
  serviceStopTimeoutMs?: number;
  /** First restart delay after a service crash (doubles, capped at 60s). */
  serviceRestartBaseMs?: number;
  /** Time box per mention provider search call; tests shrink it. */
  mentionSearchTimeoutMs?: number;
  /** Time box per mention provider resolve call at send; tests shrink it. */
  mentionResolveTimeoutMs?: number;
  /** Failed candidates must remain healthy for this long before activation commits. */
  stabilizationWindowMs?: number;
  /** Previous artifacts and activation snapshots remain rollbackable for this long. */
  artifactRetentionMs?: number;
  /** Injectable policy clock for retention and activation tests. */
  now?: () => number;
  /** Test seam for deterministic stabilization-window completion. */
  scheduleStabilizationWindow?: (
    durationMs: number,
    onElapsed: () => void,
  ) => () => void;
  /** Test failpoint after state replay but before pointer restoration. */
  afterPluginRollbackStateRestored?: (args: {
    pluginId: string;
    snapshotId: string;
  }) => Promise<void>;
  /** Test seam for a crash after canonical promotion but before activation. */
  afterArtifactPromoted?: (args: {
    pluginId: string;
    artifactId: string;
    path: string;
  }) => Promise<void>;
  /** Test observation seam; called immediately before a managed download. */
  onArtifactMaterialize?: (args: { path: string }) => void;
}

/** One native tool contributed by a running plugin (design §4.4). */
export interface PluginAgentToolContribution {
  pluginId: string;
  tool: DynamicTool;
  /** Optional usage snippet for the thread-instructions assembly. */
  instructions: string | null;
}

/** One dynamic instructions provider from a running plugin. */
export interface PluginInstructionContribution {
  pluginId: string;
  provider: (ctx: { threadId: string; projectId: string }) => string | null;
}

/** One thread action contributed by a running plugin (design §4.9). */
export interface PluginThreadActionContribution {
  pluginId: string;
  id: string;
  title: string;
  icon: string | null;
  confirm: string | null;
}

/** Result of running a thread action (POST /plugins/:id/actions/:actionId). */
export type PluginThreadActionRunResult =
  | { outcome: "unknown-thread" }
  | { outcome: "ok"; toast: PluginThreadActionToast | null }
  | { outcome: "error"; error: string };

/** One mention provider contributed by a running plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

/** One row in a mention search group. `itemId` is the wire-composed
 * "<providerId>:<provider item id>" that rides the mention resource. */
export interface PluginMentionSearchItem {
  itemId: string;
  title: string;
  subtitle: string | null;
  icon: string | null;
}

/** One provider's results for GET /plugins/mentions/search, grouped so the
 * composer renders them under the provider's label. */
export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

/** Result of resolving one plugin mention at send time (design §4.9). */
export type PluginMentionResolveResult =
  | { ok: true; context: string }
  | { ok: false; error: string };

/**
 * Narrow emitter the thread lifecycle seams call (design §4.5). Emission is
 * a no-op unless a loaded plugin registered a handler for the event; payload
 * assembly and handler dispatch happen async off the lifecycle path.
 */
export interface PluginThreadEventEmitter {
  emitThreadCreated(thread: Thread): void;
  emitThreadIdle(thread: Thread): void;
  emitThreadFailed(thread: Thread): void;
  emitThreadDeleted(thread: Thread): void;
}

/**
 * Result of resolving a wire request (http route / rpc method) against the
 * live routing tables. "not-running" distinguishes an installed-but-unloaded
 * plugin (503 at the dispatcher) from an unknown plugin or route (404).
 */
export type PluginWireLookup<T> =
  | { outcome: "unknown-plugin" }
  | {
      outcome: "not-running";
      status: PluginRuntimeStatus;
      detail: string | null;
    }
  | { outcome: "not-found" }
  | { outcome: "found"; value: T };

export interface PluginUpdateCheckEntry {
  id: string;
  outcome:
    | "current"
    | "update-available"
    | "pinned"
    | "incompatible"
    | "unavailable";
  devMode?: true;
  installed: PluginResolvedUpdateVersion;
  candidate?: PluginResolvedUpdateVersion;
  blocked?: { version: string; reasons: string[] };
  detail?: string;
}

const pluginResolvedUpdateVersionSchema = z.object({
  version: z.string(),
  display: z.string(),
});

const pluginUpdateCheckEntrySchema = z.object({
  id: z.string(),
  outcome: z.enum([
    "current",
    "update-available",
    "pinned",
    "incompatible",
    "unavailable",
  ]),
  devMode: z.literal(true).optional(),
  installed: pluginResolvedUpdateVersionSchema,
  candidate: pluginResolvedUpdateVersionSchema.optional(),
  blocked: z
    .object({ version: z.string(), reasons: z.array(z.string()) })
    .optional(),
  detail: z.string().optional(),
});

export interface PluginApplyUpdateResult {
  applied: boolean;
  from: PluginResolvedUpdateVersion;
  to?: PluginResolvedUpdateVersion;
  outcome: string;
  detail?: string;
}

export interface PluginSourceView {
  requested: string;
  resolved: string;
  integrity?: string;
  registry?: string;
  engines: { bb?: string; bbPluginSdk?: string };
  installedAt?: number;
  history: Array<{ version: string; activatedAt: number }>;
}

export type PluginApplyUpdateOutcome =
  | { ok: true; result: PluginApplyUpdateResult }
  | { ok: false; error: string };

export interface PluginService {
  /** Whether the `plugins` experiment is currently on. */
  isEnabled(): boolean;
  /** Whether this installed plugin is a builtin. */
  isBuiltin(id: string): boolean;
  /** Thread lifecycle event emitter, called from the lifecycle seams. */
  events: PluginThreadEventEmitter;
  /**
   * Bind the in-process BB SDK to the running server. Call once the HTTP
   * listener is up, before start(): bb.sdk throws until this runs.
   */
  bindSdk(args: { baseUrl: string }): void;
  /** Load all enabled plugins. Call after the HTTP listener is up. */
  start(): Promise<void>;
  /** Dispose all loaded plugins (server shutdown or experiment turned off). */
  stop(): Promise<void>;
  /** React to experiments that affect plugin loading being toggled at runtime. */
  onExperimentsChanged(): Promise<void>;
  list(): PluginListEntry[];
  /** Palettes declared by currently loaded plugins, ordered by plugin id. */
  listThemes(): PluginThemeMeta[];
  /** Read a loaded plugin palette by its globally namespaced id. */
  readThemeCss(themeId: string): Promise<string | null>;
  /**
   * Install from a source spec: `path:<dir>` (bare paths accepted),
   * `git:<url-ish>@<ref>` (ref required; cloned into the managed dir under
   * <dataDir>/plugins/git), or `npm:<name>[@<version|tag|range>]` (installed
   * with npm --ignore-scripts under <dataDir>/plugins/npm). git/npm installs
   * hard-fail on an engines.bb mismatch and refuse already-registered ids;
   * use update for an existing managed plugin.
   */
  install(source: string): Promise<PluginListEntry>;
  installFromMarketplace(args: {
    source: string;
    marketplaceId: string;
    entryId: string;
    installation?: { engines: { bb?: string; bbPluginSdk?: string } };
    gitSubdirectory?: string;
    npmRegistry?: string;
  }): Promise<PluginListEntry>;
  installPath(path: string): Promise<PluginListEntry>;
  checkForUpdates(id?: string): Promise<PluginUpdateCheckEntry[]>;
  listUpdateResults(): PluginUpdateCheckEntry[];
  getSource(id: string): Promise<PluginSourceView | undefined>;
  applyUpdate(id: string): Promise<PluginApplyUpdateOutcome>;
  remove(id: string): Promise<boolean>;
  setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<PluginListEntry | undefined>;
  reload(id?: string): Promise<void>;
  /** Live API handle for a running plugin (used by later phases and tests). */
  getApi(id: string): BbPluginApi | undefined;
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
  /**
   * On-disk logo backing GET /plugins/:id/assets/logo (variant "logo") or
   * .../logo-dark (variant "logo-dark"). Same gating as getAppAsset:
   * undefined unless the plugin is currently loaded and ships that variant.
   */
  getLogoAsset(
    id: string,
    variant: PluginLogoVariant,
  ): { path: string; contentType: string; hash: string } | undefined;
  /**
   * Declared settings schema + current values for a loaded plugin
   * (secrets render as `{ set: boolean }`). Undefined when the plugin is not
   * running — the schema only exists after its factory ran.
   */
  getSettings(id: string): Promise<PluginSettingsView | undefined>;
  /**
   * Validate and persist a settings update (`null` unsets a key), firing the
   * plugin's onChange listeners when effective values changed. Throws
   * PluginSettingsValidationError on unknown keys or type mismatches.
   */
  updateSettings(
    id: string,
    values: Record<string, unknown>,
  ): Promise<PluginSettingsView | undefined>;
  /** Live http route lookup for the boot-time dispatcher (exact method+path). */
  getHttpRoute(
    id: string,
    method: string,
    path: string,
  ): PluginWireLookup<PluginHttpRouteRecord>;
  /** Live rpc handler lookup for the boot-time dispatcher. */
  getRpcHandler(id: string, method: string): PluginWireLookup<PluginRpcHandler>;
  /**
   * Run an http route handler wrapped in the plugin failure-isolation
   * discipline (caught, logged, timed into handlerStats). A throwing or
   * non-Response-returning handler maps to a 500 JSON error response.
   */
  invokeHttpRoute(
    id: string,
    route: PluginHttpRouteRecord,
    context: Context,
  ): Promise<Response>;
  /**
   * Run an rpc handler (same wrapping). The result is JSON round-tripped so
   * non-serializable outputs surface as a handler error, not a broken wire.
   */
  invokeRpcHandler(
    id: string,
    method: string,
    handler: PluginRpcHandler,
    input: unknown,
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  /**
   * Per-plugin secret for auth "token" routes, generated on first use and
   * stored under <dataDir>/plugins/<id>/secrets/. `rotate` replaces it.
   * Undefined when the plugin is not installed.
   */
  httpToken(
    id: string,
    options?: { rotate?: boolean },
  ): Promise<string | undefined>;
  /**
   * CLI command metadata for GET /plugins/contributions: fast, no plugin
   * code execution, empty when the experiment is off. Sorted by plugin id.
   */
  listCliContributions(): PluginCliContribution[];
  /**
   * Run a plugin's registered CLI command wrapped in the failure-isolation
   * discipline. Never throws for dispatch problems: an unknown / not-running
   * plugin, disabled experiment, missing registration, throwing handler, or
   * malformed handler result all map to exitCode 1 with a helpful stderr —
   * the bb CLI prints stderr and exits with exitCode.
   */
  runCliCommand(
    id: string,
    argv: string[],
    ctx: PluginCliContext,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /**
   * Skills roots of running plugins (manifest bb.skills or the skills/
   * convention dir), ordered by plugin id — the "plugin" precedence tier
   * passed to resolveInjectedSkillSources per turn. Missing directories are
   * tolerated downstream; empty when the experiment is off.
   */
  listSkillsRootPaths(): string[];
  /**
   * Native tools of running plugins (bb.agents.registerTool), ordered by
   * plugin id then registration order, deduped defensively (first wins —
   * registration already blocks collisions). Appended to a session's
   * dynamicTools at thread.start/turn.submit time; changes apply on the
   * NEXT session start. Empty when the experiment is off.
   */
  listAgentTools(): PluginAgentToolContribution[];
  /**
   * Dynamic instruction providers from bb.agents.contributeInstructions,
   * ordered by plugin id. Resolved live at thread.start/turn.submit;
   * empty when the experiment is off or no plugin registered a provider.
   * At most one provider per plugin (re-register replaces).
   */
  listInstructionContributions(): PluginInstructionContribution[];
  /** Resolve one registered native tool by name (same view as listAgentTools). */
  findAgentTool(
    name: string,
  ): { pluginId: string; record: PluginAgentToolRecord } | undefined;
  /**
   * Run a native tool call (design §4.4). Invalid arguments (zod-backed
   * registrations) return an isError tool result without touching the
   * plugin; execute runs through invokeWrapped, so a throwing or
   * malformed-result handler maps to an isError tool result too.
   */
  invokeAgentTool(args: {
    pluginId: string;
    record: PluginAgentToolRecord;
    input: unknown;
    ctx: PluginAgentToolContext;
  }): Promise<ToolCallResponse>;
  /**
   * Thread actions of running plugins (bb.ui.registerThreadAction), ordered
   * by plugin id then registration order, for GET /plugins/contributions.
   * No plugin code runs; empty when the experiment is off.
   */
  listThreadActionContributions(): PluginThreadActionContribution[];
  /** Live thread-action lookup for POST /plugins/:id/actions/:actionId. */
  getThreadAction(
    id: string,
    actionId: string,
  ): PluginWireLookup<PluginThreadActionRecord>;
  /**
   * Run a thread action (design §4.9): resolves the thread (its projectId
   * rides into the handler context), runs `run` through invokeWrapped, and
   * validates the returned toast. A throwing or malformed-result handler
   * maps to the "error" outcome — the app shows it as an error toast.
   */
  runThreadAction(
    id: string,
    record: PluginThreadActionRecord,
    threadId: string,
  ): Promise<PluginThreadActionRunResult>;
  /**
   * Mention providers of running plugins (bb.ui.registerMentionProvider),
   * ordered by plugin id then registration order, for
   * GET /plugins/contributions. No plugin code runs; empty when the
   * experiment is off.
   */
  listMentionProviderContributions(): PluginMentionProviderContribution[];
  /**
   * Run every loaded plugin's mention providers against one composer query
   * (design §4.9). Providers run concurrently, each wrapped in the
   * failure-isolation discipline (invokeWrapped) and time-boxed (2s); a
   * slow, throwing, or malformed provider contributes an empty group.
   * Groups are ordered by plugin id, then registration order; empty groups
   * are dropped. Item ids are namespaced "<providerId>:<item id>".
   */
  searchMentions(args: {
    trigger: PluginMentionTrigger;
    query: string;
    projectId: string | null;
    threadId: string | null;
  }): Promise<PluginMentionSearchGroup[]>;
  /**
   * Resolve one plugin mention at send time (design §4.9). `itemId` is the
   * wire-composed "<providerId>:<item id>" from searchMentions. Runs the
   * provider's resolve through invokeWrapped; any dispatch or handler
   * problem maps to `{ ok: false, error }` so the send path can block with
   * a clear error.
   */
  resolveMention(args: {
    pluginId: string;
    itemId: string;
  }): Promise<PluginMentionResolveResult>;
  /**
   * Last `tail` lines of the plugin's JSONL log file (bb.log output).
   * Undefined when the plugin is not installed.
   */
  readLogTail(id: string, tail: number): Promise<string[] | undefined>;
  /**
   * Run due plugin schedules (design §4.8), called from the periodic-sweeps
   * loop. Claims each due (plugin_id, name) row with a CAS on next_run_at —
   * at-most-once per tick even across overlapping sweeps — then runs the
   * plugin's fn wrapped (errors → last_status/last_error + plugin log).
   * Rows whose plugin is not loaded are left unclaimed. No host required.
   */
  sweepDueSchedules(now: number): Promise<void>;
}

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_SERVICE_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_SERVICE_RESTART_BASE_MS = 1_000;
const DEFAULT_MENTION_SEARCH_TIMEOUT_MS = 2_000;
// Resolve is looser than search: it blocks a send the user already committed
// to, so it may do one real fetch — but it must not hang POST /threads/:id/send
// forever when a provider never settles.
const DEFAULT_MENTION_RESOLVE_TIMEOUT_MS = 10_000;
const DEFAULT_STABILIZATION_WINDOW_MS = 30_000;
const DEFAULT_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const SERVICE_RESTART_MAX_MS = 60_000;
/** A crash after this much healthy runtime resets the backoff sequence. */
const SERVICE_HEALTHY_RESET_MS = 5 * 60_000;

class PluginActivationRolledBackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginActivationRolledBackError";
  }
}
const SCHEDULE_SWEEP_BATCH_SIZE = 100;
const CONNECT_BUILTIN_PLUGIN_NAME = "connect";

/** Next cron occurrence strictly after `now` (server-local time). */
function nextCronRunAt(cron: string, now: number): number {
  return CronExpressionParser.parse(cron, { currentDate: new Date(now) })
    .next()
    .getTime();
}

/** True when `promise` settles (either way) within `timeoutMs`. */
async function settledWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Map a tool's return value (string | { content, isError? }) onto the wire
 * ToolCallResponse the daemon round-trip expects. Malformed results throw —
 * the caller runs this inside invokeWrapped so they count as handler errors.
 */
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

const THREAD_ACTION_TOAST_KINDS = new Set(["success", "error", "info"]);

/**
 * Validate a thread action's return value (void | { toast? }). Malformed
 * results throw — the caller runs this inside invokeWrapped so they count
 * as handler errors, not broken wire responses.
 */
function normalizeThreadActionResult(
  actionId: string,
  result: unknown,
): PluginThreadActionToast | null {
  if (result === undefined || result === null) return null;
  if (typeof result !== "object") {
    throw new Error(
      `thread action "${actionId}" run() must return void or { toast? }`,
    );
  }
  const toast = (result as { toast?: unknown }).toast;
  if (toast === undefined || toast === null) return null;
  const { kind, message } = toast as { kind?: unknown; message?: unknown };
  if (
    typeof kind !== "string" ||
    !THREAD_ACTION_TOAST_KINDS.has(kind) ||
    typeof message !== "string" ||
    message.length === 0
  ) {
    throw new Error(
      `thread action "${actionId}" toast must be { kind: "success" | "error" | "info", message: string }`,
    );
  }
  return { kind: kind as PluginThreadActionToast["kind"], message };
}

/**
 * Validate a mention provider's search() result and namespace item ids for
 * the wire ("<providerId>:<item id>"). Malformed results throw — the caller
 * runs this inside invokeWrapped so they count as handler errors and the
 * provider contributes an empty group.
 */
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

export function createPluginService(deps: PluginServiceDeps): PluginService {
  const logger = deps.logger;
  const builtinPlugins =
    deps.builtinPlugins ?? listBuiltinPluginRegistrations();
  const loadTimeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const serviceStopTimeoutMs =
    deps.serviceStopTimeoutMs ?? DEFAULT_SERVICE_STOP_TIMEOUT_MS;
  const serviceRestartBaseMs =
    deps.serviceRestartBaseMs ?? DEFAULT_SERVICE_RESTART_BASE_MS;
  const mentionSearchTimeoutMs =
    deps.mentionSearchTimeoutMs ?? DEFAULT_MENTION_SEARCH_TIMEOUT_MS;
  const mentionResolveTimeoutMs =
    deps.mentionResolveTimeoutMs ?? DEFAULT_MENTION_RESOLVE_TIMEOUT_MS;
  const stabilizationWindowMs =
    deps.stabilizationWindowMs ?? DEFAULT_STABILIZATION_WINDOW_MS;
  const artifactRetentionMs =
    deps.artifactRetentionMs ?? DEFAULT_ARTIFACT_RETENTION_MS;
  const now = deps.now ?? Date.now;
  const scheduleStabilizationWindow =
    deps.scheduleStabilizationWindow ??
    ((durationMs: number, onElapsed: () => void) => {
      const timer = setTimeout(onElapsed, durationMs);
      return () => clearTimeout(timer);
    });

  const loaded = new Map<string, LoadedPlugin>();
  // Per-plugin lifecycle mutex: every load/dispose mutation for one plugin
  // runs strictly serialized. disposeOne removes the `loaded` entry before
  // stopServices finishes, so without this a concurrent reload/enable/
  // install could enter loadOne mid-dispose (no loaded entry, no hung
  // marker yet) and double-start the plugin's services.
  const lifecycleChains = new Map<string, Promise<void>>();
  const artifactChains = new Map<string, Promise<void>>();
  const pluginOperationChains = new Map<string, Promise<void>>();
  const REGISTRATION_MUTATION_KEY = "plugin-registration-mutations";
  const disposingPluginIds = new Set<string>();
  const builtinSourceWatchers: FSWatcher[] = [];

  function withLifecycleLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = lifecycleChains.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    lifecycleChains.set(id, tail);
    void tail.then(() => {
      if (lifecycleChains.get(id) === tail) lifecycleChains.delete(id);
    });
    return result;
  }

  function withArtifactLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = artifactChains.get(key) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    artifactChains.set(key, tail);
    void tail.then(() => {
      if (artifactChains.get(key) === tail) artifactChains.delete(key);
    });
    return result;
  }

  function withPluginOperationLock<T>(
    id: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = pluginOperationChains.get(id) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => {},
      () => {},
    );
    pluginOperationChains.set(id, tail);
    void tail.then(() => {
      if (pluginOperationChains.get(id) === tail) {
        pluginOperationChains.delete(id);
      }
    });
    return result;
  }
  const statuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
  >();
  const statusListeners = new Map<
    string,
    Set<(status: PluginRuntimeStatus, detail: string | null) => void>
  >();
  const stabilizingPluginIds = new Set<string>();
  // Frontend bundle snapshots (design §5.1), keyed by plugin id: the wire
  // state for list() plus the on-disk asset paths + content hash the asset
  // routes serve. Refreshed on every load (install/boot/reload).
  const appBundles = new Map<string, PluginAppBundleSnapshot>();
  // Logo snapshots (light + optional dark variant), refreshed alongside
  // appBundles on every load. Entries are only servable (and only advertised
  // via logoUrl/logoDarkUrl) while the plugin is in `loaded` — same honest
  // gate as getAppAsset.
  const logos = new Map<string, PluginLogoSet>();
  // Services that ignored their abort past the stop bound. While a plugin
  // has entries here it is not re-loaded (that would double-start the
  // service); the marker clears when the hung start() finally settles.
  const hungServices = new Map<string, Set<string>>();
  // needs-configuration messages reported during the current load; cleared
  // on the next load so a reconfigured plugin comes back as running.
  const needsConfiguration = new Map<string, string>();
  // Agent-tool registration problems (cross-plugin name collisions): the
  // plugin keeps running, but the dropped registration is surfaced as its
  // status detail. Cleared on the next load.
  const agentToolProblems = new Map<string, string>();
  // Cumulative per plugin for this server session (kept across reloads so a
  // reload cannot hide cost); removed with the plugin registration.
  const handlerStats = new Map<string, PluginHandlerStats>();
  // Bound once the HTTP listener is up; bb.sdk is gated on it (design §3
  // two-phase load/bind). One shared instance — plugin-api wraps it per
  // plugin for spawn attribution.
  let boundSdk: BbSdk | undefined;
  // The server's own loopback base URL, bound alongside the SDK; backs the
  // bind-gated bb.server.loopbackBaseUrl.
  let boundLoopbackBaseUrl: string | undefined;

  function setStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null = null,
  ): void {
    statuses.set(id, { status, detail });
    for (const listener of statusListeners.get(id) ?? []) {
      listener(status, detail);
    }
  }

  function statsFor(id: string): PluginHandlerStats {
    let stats = handlerStats.get(id);
    if (!stats) {
      stats = { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 };
      handlerStats.set(id, stats);
    }
    return stats;
  }

  function reportNeedsConfiguration(id: string, message: string): void {
    needsConfiguration.set(id, message);
    setStatus(id, "needs-configuration", message);
  }

  function reportAgentToolProblem(id: string, message: string): void {
    agentToolProblems.set(id, message);
    logger.warn(`[plugin:${id}] ${message}`);
    // Post-load registration (mid-session): surface the detail right away.
    // During load, loadOne applies it when it sets the final status.
    if (statuses.get(id)?.status === "running") {
      setStatus(id, "running", message);
    }
  }

  /** Another loaded plugin already owns this tool name? Returns its id. */
  function findAgentToolOwner(
    name: string,
    excludePluginId: string,
  ): string | undefined {
    for (const [otherId, plugin] of loaded) {
      if (otherId === excludePluginId) continue;
      if (plugin.handle.agentTools.some((tool) => tool.name === name)) {
        return otherId;
      }
    }
    return undefined;
  }

  /** Start (or restart) one background service instance. */
  function runService(id: string, service: ServiceRuntime): void {
    const controller = new AbortController();
    service.controller = controller;
    service.state = "running";
    service.startedAt = Date.now();
    // The async wrapper normalizes sync throws from start() into rejections.
    const current = (async () => {
      await service.record.start(controller.signal);
    })();
    service.current = current;
    current.then(
      () => onServiceSettled(id, service, { crashed: false }),
      (error: unknown) =>
        onServiceSettled(id, service, { crashed: true, error }),
    );
  }

  function onServiceSettled(
    id: string,
    service: ServiceRuntime,
    outcome: { crashed: false } | { crashed: true; error: unknown },
  ): void {
    service.current = null;
    service.controller = null;
    if (service.disposed) return; // the dispose path owns state + logging
    const name = service.record.name;
    if (!outcome.crashed) {
      // Resolved without being aborted: the service chose to stop.
      service.state = "stopped";
      logger.info(`[plugin:${id}] service ${name} stopped`);
      return;
    }
    if (isNeedsConfigurationError(outcome.error)) {
      service.state = "stopped";
      reportNeedsConfiguration(
        id,
        outcome.error.message || `service ${name} needs configuration`,
      );
      logger.info(
        `[plugin:${id}] service ${name} needs configuration; not restarting until reload`,
      );
      return;
    }
    // Crash → restart with capped exponential backoff; a crash after a
    // healthy stretch restarts the sequence from the base delay.
    const message =
      outcome.error instanceof Error
        ? outcome.error.message
        : String(outcome.error);
    if (stabilizingPluginIds.has(id)) {
      service.state = "stopped";
      setStatus(id, "error", `service ${name} crashed: ${message}`);
      logger.warn(
        `[plugin:${id}] service ${name} crashed during activation: ${message}`,
      );
      return;
    }
    if (Date.now() - service.startedAt >= SERVICE_HEALTHY_RESET_MS) {
      service.consecutiveCrashes = 0;
    }
    const delayMs = Math.min(
      serviceRestartBaseMs * 2 ** service.consecutiveCrashes,
      SERVICE_RESTART_MAX_MS,
    );
    service.consecutiveCrashes += 1;
    service.state = "backoff";
    logger.warn(
      `[plugin:${id}] service ${name} crashed: ${message} — restarting in ${delayMs}ms`,
    );
    const timer = setTimeout(() => {
      service.restartTimer = null;
      if (!service.disposed) runService(id, service);
    }, delayMs);
    timer.unref?.();
    service.restartTimer = timer;
  }

  /**
   * §3 reload sequence step 1: abort every service, then await each start()
   * promise with a bounded timeout. A service that does not stop marks the
   * plugin degraded and blocks re-load until its promise finally settles.
   */
  async function stopServices(id: string, plugin: LoadedPlugin): Promise<void> {
    for (const service of plugin.services) {
      service.disposed = true;
      if (service.restartTimer !== null) {
        clearTimeout(service.restartTimer);
        service.restartTimer = null;
      }
      service.controller?.abort();
    }
    for (const service of plugin.services) {
      const current = service.current;
      const name = service.record.name;
      if (current !== null) {
        const stopped = await settledWithin(current, serviceStopTimeoutMs);
        if (!stopped) {
          let hung = hungServices.get(id);
          if (!hung) {
            hung = new Set();
            hungServices.set(id, hung);
          }
          hung.add(name);
          setStatus(id, "degraded", `service ${name} did not stop`);
          logger.warn(
            `[plugin:${id}] service ${name} did not stop within ${serviceStopTimeoutMs}ms — plugin degraded until it does`,
          );
          void current.then(
            () => onHungServiceSettled(id, name),
            () => onHungServiceSettled(id, name),
          );
        }
      }
      service.state = "stopped";
    }
  }

  function onHungServiceSettled(id: string, name: string): void {
    const hung = hungServices.get(id);
    if (!hung) return;
    hung.delete(name);
    if (hung.size === 0) hungServices.delete(id);
    logger.info(
      `[plugin:${id}] service ${name} eventually stopped — reload to recover`,
    );
  }

  function hasThreadEventHandlers(event: PluginThreadEventName): boolean {
    if (loaded.size === 0) return false;
    for (const plugin of loaded.values()) {
      if (plugin.handle.threadEventHandlers[event].length > 0) return true;
    }
    return false;
  }

  /**
   * One wrapped plugin-handler invocation (design §3 failure isolation):
   * caught, logged, wall-time recorded into handlerStats. Shared by thread
   * events and the wire surfaces (http routes, rpc methods).
   */
  /** In-flight invokeWrapped markers per plugin, drained during dispose. */
  const pendingInvocations = new Map<string, Set<Promise<void>>>();

  async function invokeWrapped<T>(
    id: string,
    label: string,
    run: () => T | Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const stats = statsFor(id);
    const startedAt = performance.now();
    let settle!: () => void;
    const marker = new Promise<void>((resolveMarker) => {
      settle = resolveMarker;
    });
    let pending = pendingInvocations.get(id);
    if (!pending) {
      pending = new Set();
      pendingInvocations.set(id, pending);
    }
    pending.add(marker);
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.errorCount += 1;
      logger.warn(`[plugin:${id}] ${label} failed: ${message}`);
      if (statuses.get(id)?.status === "running") {
        setStatus(id, "running", `${label} failed: ${message}`);
      }
      return { ok: false, error: message };
    } finally {
      const elapsedMs = performance.now() - startedAt;
      stats.count += 1;
      stats.totalMs += elapsedMs;
      if (elapsedMs > stats.maxMs) stats.maxMs = elapsedMs;
      pending.delete(marker);
      settle();
    }
  }

  /**
   * Reload sequence step 3 (design §3): bounded wait for in-flight handler
   * invocations so dispose does not close sqlite handles or invalidate the
   * API under a still-running rpc/http/event handler.
   */
  async function drainInvocations(id: string): Promise<void> {
    const pending = pendingInvocations.get(id);
    if (!pending || pending.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.all([...pending]).then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), serviceStopTimeoutMs);
        timer.unref?.();
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!drained) {
      logger.warn(
        `plugin ${id}: ${pending.size} in-flight invocation(s) did not settle before dispose; proceeding`,
      );
    }
    if (pending.size === 0) pendingInvocations.delete(id);
  }

  async function invokeThreadEventHandler<E extends PluginThreadEventName>(
    id: string,
    event: E,
    handler: (payload: PluginThreadEventPayloads[E]) => void | Promise<void>,
    payload: PluginThreadEventPayloads[E],
  ): Promise<void> {
    await invokeWrapped(id, `${event} handler`, () => handler(payload));
  }

  /**
   * Fire-and-forget dispatch: the lifecycle seam returns immediately; the
   * payload is assembled and handlers run on the next macrotask, after the
   * transition (and any surrounding transaction) has settled. Handlers are
   * looked up live at dispatch time, so a plugin disposed in between
   * receives nothing.
   */
  function emitThreadEvent<E extends PluginThreadEventName>(
    event: E,
    buildPayload: () => PluginThreadEventPayloads[E],
  ): void {
    if (!hasThreadEventHandlers(event)) return;
    setImmediate(() => {
      let payload: PluginThreadEventPayloads[E];
      try {
        payload = buildPayload();
      } catch (error) {
        logger.warn(
          `failed to build ${event} plugin event payload: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      for (const [id, plugin] of loaded) {
        for (const handler of [...plugin.handle.threadEventHandlers[event]]) {
          void invokeThreadEventHandler(id, event, handler, payload);
        }
      }
    });
  }

  function buildThreadDto(thread: Thread) {
    return toThreadResponseFromThread(
      { db: deps.db, hub: deps.hub },
      { thread },
    );
  }

  function checkEngineRange(manifest: PluginManifest): string | undefined {
    if (!manifest.bbEngineRange) return undefined;
    const version = semver.coerce(deps.appVersion);
    if (!version) {
      // Dev builds may carry a non-semver version; do not block on it.
      logger.warn(
        `cannot parse app version "${deps.appVersion}" for engines check; skipping`,
      );
      return undefined;
    }
    if (version.major === 0 && version.minor === 0 && version.patch === 0) {
      // Dev servers report 0.0.0 (or 0.0.0-test); a real release never does.
      // Enforcing ranges against it would mark every version-gated plugin
      // incompatible in development.
      return undefined;
    }
    if (!semver.satisfies(version, manifest.bbEngineRange)) {
      return `requires bb ${manifest.bbEngineRange}, this is ${version.version}`;
    }
    return undefined;
  }

  function checkPluginSdkRange(manifest: PluginManifest): string | undefined {
    if (!manifest.bbPluginSdkRange) return undefined;
    if (!semver.satisfies(PLUGIN_SDK_VERSION, manifest.bbPluginSdkRange)) {
      return `requires bb plugin SDK ${manifest.bbPluginSdkRange}, running SDK is ${PLUGIN_SDK_VERSION}`;
    }
    return undefined;
  }

  async function runFactoryTimeBoxed(
    factory: (api: BbPluginApi) => unknown,
    api: BbPluginApi,
  ): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve(factory(api)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`load timed out after ${loadTimeoutMs}ms`)),
            loadTimeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Parse an incoming install display spec for validation/build policy. */
  function sourceKind(source: string): "path" | "git" | "npm" | "builtin" {
    try {
      return parsePluginSource(source).kind;
    } catch {
      return "path";
    }
  }

  function builtinName(row: InstalledPluginRow): string | null {
    return row.sourceKind === "builtin" ? row.sourceBuiltinName : null;
  }

  function isPackagedBuiltinAppEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
  }): boolean {
    return (
      args.kind === "builtin" &&
      args.manifest.appEntry === resolve(args.rootDir, "dist", "app.js")
    );
  }

  function isPackagedBuiltinServerEntry(args: {
    kind: ReturnType<typeof sourceKind>;
    manifest: PluginManifest;
    rootDir: string;
  }): boolean {
    return (
      args.kind === "builtin" &&
      args.manifest.serverEntry === resolve(args.rootDir, "dist", "server.js")
    );
  }

  async function packagedBuiltinArtifactProblem(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string | null> {
    const kind = sourceKind(row.source);
    if (
      !isPackagedBuiltinServerEntry({
        kind,
        manifest,
        rootDir: row.rootDir,
      })
    ) {
      return null;
    }
    async function validate(
      artifact: "server" | "app",
    ): Promise<string | null> {
      let raw: string;
      try {
        raw = await readFile(
          join(row.rootDir, "dist", `${artifact}.meta.json`),
          "utf8",
        );
      } catch {
        return `${artifact} artifact for plugin "${manifest.id}" is missing dist/${artifact}.meta.json`;
      }
      return validatePluginArtifactMeta({
        artifact,
        raw,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
      });
    }
    const serverProblem = await validate("server");
    if (serverProblem !== null) return serverProblem;
    if (isPackagedBuiltinAppEntry({ kind, manifest, rootDir: row.rootDir })) {
      return validate("app");
    }
    return null;
  }

  function isBuiltinPluginId(id: string): boolean {
    const row = getInstalledPlugin(deps.db, id);
    return row?.sourceKind === "builtin";
  }

  function isBuiltinPluginLoadEnabled(name: string): boolean {
    if (name === CONNECT_BUILTIN_PLUGIN_NAME) {
      return deps.isConnectEnabled();
    }
    return true;
  }

  function experimentGateDisabledDetail(
    row: InstalledPluginRow,
  ): string | null {
    const name = builtinName(row);
    if (name === CONNECT_BUILTIN_PLUGIN_NAME) {
      return 'disabled by the "bb connect" experiment';
    }
    if (name === null) {
      return 'disabled by the "Plugins" experiment';
    }
    return null;
  }

  function shouldLoadRow(row: InstalledPluginRow): boolean {
    const name = builtinName(row);
    if (name !== null) return isBuiltinPluginLoadEnabled(name);
    return deps.isEnabled();
  }

  function shouldExposeLoadedPlugin(plugin: LoadedPlugin): boolean {
    if (plugin.builtinName !== null) {
      return isBuiltinPluginLoadEnabled(plugin.builtinName);
    }
    return deps.isEnabled();
  }

  function shouldExposePluginId(id: string): boolean {
    const plugin = loaded.get(id);
    if (plugin !== undefined) return shouldExposeLoadedPlugin(plugin);
    const row = getInstalledPlugin(deps.db, id);
    if (row === undefined) return deps.isEnabled();
    return shouldLoadRow(row);
  }

  function exposedLoadedEntries(): Array<[string, LoadedPlugin]> {
    return [...loaded.entries()].filter(([, plugin]) =>
      shouldExposeLoadedPlugin(plugin),
    );
  }

  /**
   * The backend entry to import for this load. Managed (git:/npm:) installs
   * prefer a fresh, SDK-major-compatible prebuilt `dist/server.js` (design
   * §3 loader amendment, §6 prebuilt distribution) so consumers never need
   * npm or node_modules; path installs ALWAYS load from source, so author
   * iteration via `bb plugin reload` sees edited files. A present-but-stale
   * or meta-less dist falls back to source with one warning.
   */
  async function resolveServerEntry(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string> {
    if (row.sourceKind === "path") return manifest.serverEntry;
    const distJsPath = join(row.rootDir, "dist", "server.js");
    try {
      await stat(distJsPath);
    } catch {
      return manifest.serverEntry; // no prebuilt bundle shipped — normal
    }
    let meta: { sdkMajor: number; sdkVersion: string } | null = null;
    try {
      meta = parsePluginAppBundleMeta(
        await readFile(join(row.rootDir, "dist", "server.meta.json"), "utf8"),
      );
    } catch {
      // missing sidecar → meta stays null
    }
    if (meta?.sdkMajor !== PLUGIN_SDK_MAJOR) {
      logger.warn(
        `plugin ${row.id}: ignoring prebuilt dist/server.js (built for SDK ${meta ? `major ${meta.sdkMajor}` : "unknown"}, running SDK major is ${PLUGIN_SDK_MAJOR}) — loading from source`,
      );
      return manifest.serverEntry;
    }
    return distJsPath;
  }

  /**
   * Refresh a plugin's frontend-bundle snapshot for this load (design §5.1).
   * Mutable path: and source-builtin trees are rebuilt when the recorded SDK
   * version differs from the running one. Managed git/npm artifacts are
   * immutable after promotion and are served exactly as validated;
   * incompatible metadata is surfaced without rewriting cached bytes.
   */
  async function refreshAppBundle(
    row: InstalledPluginRow,
    manifest: PluginManifest,
  ): Promise<string | null> {
    if (manifest.appEntry === undefined) {
      appBundles.set(row.id, {
        state: { hasApp: false, bundle: null },
        assets: null,
      });
      return null;
    }
    const kind = row.sourceKind;
    if (
      (kind === "path" || kind === "builtin") &&
      !isPackagedBuiltinAppEntry({ kind, manifest, rootDir: row.rootDir })
    ) {
      const meta = await readPluginAppBundleMeta(row.rootDir);
      if (meta?.sdkVersion !== PLUGIN_SDK_VERSION) {
        logger.info(
          `plugin ${row.id}: rebuilding frontend bundle (built with SDK ${meta?.sdkVersion ?? "unknown"}, running SDK is ${PLUGIN_SDK_VERSION})`,
        );
        try {
          await buildPluginApp(row.rootDir, deps.appVersion);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(
            `plugin ${row.id}: frontend bundle rebuild failed: ${message}`,
          );
          appBundles.set(row.id, {
            state: { hasApp: true, bundle: null },
            assets: null,
          });
          return `frontend bundle rebuild failed: ${message}`;
        }
      }
    }
    appBundles.set(row.id, await loadPluginAppBundle(row.id, row.rootDir));
    return null;
  }

  async function loadOne(row: InstalledPluginRow): Promise<void> {
    if (!row.enabled) {
      setStatus(row.id, "disabled");
      return;
    }
    if (loaded.has(row.id)) {
      // Idempotent load: enabling an already-running plugin (or any future
      // caller) must not orphan the previous instance — its services would
      // keep running and its sqlite handles would leak.
      await disposeOne(row.id);
    }
    const hung = hungServices.get(row.id);
    if (hung !== undefined && hung.size > 0) {
      // A previous instance's service never stopped; loading now would
      // double-start it (design §3: degraded rather than double-starting).
      setStatus(
        row.id,
        "degraded",
        `service ${[...hung].join(", ")} did not stop`,
      );
      return;
    }
    try {
      await stat(row.rootDir);
    } catch {
      setStatus(
        row.id,
        "missing",
        `plugin directory not found: ${row.rootDir} (reinstall)`,
      );
      return;
    }
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(row.rootDir);
    } catch (error) {
      setStatus(
        row.id,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const engineProblem =
      checkEngineRange(manifest) ?? checkPluginSdkRange(manifest);
    if (engineProblem) {
      setStatus(row.id, "incompatible", engineProblem);
      return;
    }
    const artifactProblem = await packagedBuiltinArtifactProblem(row, manifest);
    if (artifactProblem !== null) {
      setStatus(row.id, "incompatible", artifactProblem);
      return;
    }
    // Before the factory runs, so a backend load failure still leaves
    // current bundle info in the inventory (the frontend only imports
    // bundles of running plugins anyway).
    const appBundleProblem = await refreshAppBundle(row, manifest);
    // Logo refresh rides every load too, so `bb plugin reload` picks up a
    // changed/added/removed logo file (either variant).
    logos.set(row.id, await loadPluginLogos(row.id, row.rootDir, manifest));
    const handle = createPluginApi({
      pluginId: row.id,
      logger: deps.logger,
      db: deps.db,
      dataDir: deps.dataDir,
      getSdk: () => boundSdk,
      getLoopbackBaseUrl: () => boundLoopbackBaseUrl,
      publishSignal: (channel, payload) => {
        deps.hub.notifyPluginSignal(row.id, channel, payload);
      },
      reportNeedsConfiguration: (message) => {
        reportNeedsConfiguration(row.id, message);
      },
      isAgentToolNameTaken: (name) => findAgentToolOwner(name, row.id),
      reportAgentToolProblem: (message) => {
        reportAgentToolProblem(row.id, message);
      },
      requestInteraction: (args) => {
        if (!deps.pendingInteractions) {
          throw new Error("Plugin interactions are unavailable in this host");
        }
        if (disposingPluginIds.has(row.id)) {
          throw new Error(`plugin "${row.id}" is disposing`);
        }
        return deps.pendingInteractions.requestPluginInteraction({
          ...args,
          pluginId: row.id,
        });
      },
    });
    // Fresh load: a plugin that was waiting on configuration gets to prove
    // itself again (its factory/services re-report if still unconfigured).
    needsConfiguration.delete(row.id);
    agentToolProblems.delete(row.id);
    try {
      // Fresh instance per load: guarantees re-imports see current sources.
      const jiti = createJiti(import.meta.url, { moduleCache: false });
      // Same jiti instance for source and prebuilt dist/server.js, so the
      // @bb/plugin-sdk resolution applies identically to both.
      const mod = (await jiti.import(
        await resolveServerEntry(row, manifest),
      )) as {
        default?: unknown;
      };
      const factory = mod.default;
      if (typeof factory !== "function") {
        throw new Error(
          `server entry must default-export a factory (bb) => void, got ${typeof factory}`,
        );
      }
      await runFactoryTimeBoxed(
        factory as (api: BbPluginApi) => unknown,
        handle.api,
      );
    } catch (error) {
      for (const database of handle.sqliteHandles.splice(0)) {
        try {
          database.close();
        } catch {
          // The load error below remains the actionable failure. Rollback
          // replaces the database only after all candidate handles close.
        }
      }
      handle.invalidate();
      let message = error instanceof Error ? error.message : String(error);
      // --ignore-scripts already prevents gyp builds at install; a .node
      // addon that slipped through dies here under Electron's ABI.
      if (/ERR_DLOPEN_FAILED|\.node/.test(message)) {
        message += " (native dependencies are not supported in BB plugins)";
      }
      setStatus(row.id, "error", message);
      logger.warn(
        `plugin ${row.id} failed to load: ${statuses.get(row.id)?.detail}`,
      );
      return;
    }
    const loadedBuiltinName = builtinName(row);
    const plugin: LoadedPlugin = {
      manifest,
      handle,
      services: handle.backgroundServices.map((record) => ({
        record,
        state: "stopped" as const,
        controller: null,
        current: null,
        restartTimer: null,
        consecutiveCrashes: 0,
        startedAt: 0,
        disposed: false,
      })),
      isBuiltin: loadedBuiltinName !== null,
      builtinName: loadedBuiltinName,
    };
    loaded.set(row.id, plugin);
    // Sync durable schedule rows to this load's registrations: upsert each
    // (computing next_run_at from its cron) and drop rows for names the
    // plugin no longer registers. Run history on kept rows survives.
    const now = Date.now();
    prunePluginSchedules(
      deps.db,
      row.id,
      handle.schedules.map((schedule) => schedule.name),
    );
    for (const schedule of handle.schedules) {
      upsertPluginSchedule(deps.db, {
        pluginId: row.id,
        name: schedule.name,
        cron: schedule.cron,
        nextRunAt: nextCronRunAt(schedule.cron, now),
      });
    }
    // Services start after the factory completes (design §4.8 bind phase).
    for (const service of plugin.services) {
      runService(row.id, service);
    }
    // A factory (or an immediately-crashing service) may have already
    // reported needs-configuration; do not paper over it with "running".
    // A dropped tool registration or a failed frontend rebuild keeps the
    // plugin running but rides along as the status detail.
    if (!needsConfiguration.has(row.id)) {
      const details = [agentToolProblems.get(row.id), appBundleProblem].filter(
        (detail): detail is string => typeof detail === "string",
      );
      setStatus(
        row.id,
        "running",
        details.length > 0 ? details.join("; ") : null,
      );
    }
    logger.info(`plugin ${row.id}@${manifest.version} loaded`);
  }

  async function disposeOne(id: string): Promise<void> {
    const plugin = loaded.get(id);
    if (!plugin) return;
    loaded.delete(id);
    disposingPluginIds.add(id);
    try {
      try {
        deps.pendingInteractions?.interruptPluginInteractions(id);
      } catch (error) {
        logger.warn(
          `plugin ${id} interaction cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // §3 order: services first (abort + bounded await), then dispose hooks,
      // then vended resources, then handle invalidation.
      await stopServices(id, plugin);
      // LIFO, each hook isolated: one bad hook must not skip the rest.
      for (const hook of [...plugin.handle.disposeHooks].reverse()) {
        try {
          await hook();
        } catch (error) {
          logger.warn(
            `plugin ${id} dispose hook failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      // §3 step 3: let in-flight rpc/http/event handlers settle (bounded)
      // before their sqlite handles close and their API handle goes stale.
      await drainInvocations(id);
      // Close host-vended sqlite handles before invalidating: a stale handle
      // throws on use instead of writing to a database mid-reload.
      for (const database of plugin.handle.sqliteHandles.splice(0)) {
        try {
          database.close();
        } catch (error) {
          logger.warn(
            `plugin ${id} sqlite close failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      plugin.handle.invalidate();
      disposingPluginIds.delete(id);
    }
  }

  async function disposeAll(): Promise<void> {
    for (const id of [...loaded.keys()]) {
      await withLifecycleLock(id, () => disposeOne(id));
    }
  }

  function clearRuntimeState(id: string): void {
    statuses.delete(id);
    appBundles.delete(id);
    logos.delete(id);
    needsConfiguration.delete(id);
    agentToolProblems.delete(id);
  }

  async function unloadOneForExperimentGate(
    row: InstalledPluginRow,
  ): Promise<void> {
    await disposeOne(row.id);
    clearRuntimeState(row.id);
    if (row.enabled) {
      setStatus(row.id, "disabled", experimentGateDisabledDetail(row));
    } else {
      setStatus(row.id, "disabled");
    }
  }

  async function loadAll(): Promise<void> {
    const rows = listInstalledPlugins(deps.db).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      if (shouldLoadRow(row)) {
        if (loaded.has(row.id)) continue;
        await withLifecycleLock(row.id, () => loadOne(row));
      } else {
        await withLifecycleLock(row.id, () => unloadOneForExperimentGate(row));
      }
    }
  }

  /**
   * Resolve a wire request against the live tables. Handles the shared
   * unknown-plugin / not-running outcomes; `find` picks the record from a
   * running plugin's handle.
   */
  function wireLookup<T>(
    id: string,
    find: (plugin: LoadedPlugin) => T | undefined,
  ): PluginWireLookup<T> {
    if (!shouldExposePluginId(id)) {
      const row = getInstalledPlugin(deps.db, id);
      if (!row) return { outcome: "unknown-plugin" };
      const runtime = statuses.get(id);
      return {
        outcome: "not-running",
        status: runtime?.status ?? "disabled",
        detail: runtime?.detail ?? experimentGateDisabledDetail(row),
      };
    }
    const plugin = loaded.get(id);
    if (!plugin) {
      const row = getInstalledPlugin(deps.db, id);
      if (!row) return { outcome: "unknown-plugin" };
      const runtime = statuses.get(id);
      return {
        outcome: "not-running",
        status: runtime?.status ?? (row.enabled ? "error" : "disabled"),
        detail: runtime?.detail ?? (row.enabled ? "not loaded" : null),
      };
    }
    const value = find(plugin);
    if (value === undefined) return { outcome: "not-found" };
    return { outcome: "found", value };
  }

  // The token file sits in the settings-secrets dir so `remove` cleans it
  // up; the dot prefix cannot collide with setting keys (they must match
  // /^[a-zA-Z0-9_-]+$/).
  const HTTP_TOKEN_FILE = ".http-token";

  /**
   * Validation half of an install: read the manifest, refuse engine
   * mismatches for managed sources (design §6 — install refuses, unlike
   * load which marks `incompatible`), and materialize/verify the frontend
   * bundle. Managed (git:/npm:) installs run this against a staging dir so
   * a failure never touches the currently-installed files.
   */
  async function validateInstallDir(args: {
    rootDir: string;
    source: string;
    refuseEngineMismatch: boolean;
  }): Promise<PluginManifest> {
    const manifest = await readPluginManifest(args.rootDir);
    const kind = sourceKind(args.source);
    const managed = kind === "git" || kind === "npm";
    if (args.refuseEngineMismatch) {
      const engineProblem =
        checkEngineRange(manifest) ?? checkPluginSdkRange(manifest);
      if (engineProblem) {
        throw new Error(
          `install refused: plugin "${manifest.id}" ${engineProblem}`,
        );
      }
    }
    // Frontend policy (design §5.1): path:/git: sources build dist/ at
    // install time — a build failure fails the install, like a manifest
    // error would. npm packages are never built here; they must ship a
    // prebuilt dist whose metadata is compatible with this SDK.
    if (manifest.appEntry !== undefined) {
      if (kind === "npm") {
        const jsPresent = await stat(join(args.rootDir, "dist", "app.js"))
          .then(() => true)
          .catch(() => false);
        if (!jsPresent) {
          throw new Error(
            `install refused: npm plugins with a frontend (bb.app) must publish a prebuilt bundle — "${manifest.id}" is missing dist/app.js + dist/app.meta.json`,
          );
        }
      } else if (
        !isPackagedBuiltinAppEntry({ kind, manifest, rootDir: args.rootDir })
      ) {
        try {
          await buildPluginApp(args.rootDir, deps.appVersion);
        } catch (error) {
          throw new Error(
            `install failed: frontend bundle build for "${manifest.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    async function validateArtifact(
      artifact: "server" | "app",
      required: boolean,
    ): Promise<void> {
      const metaPath = join(args.rootDir, "dist", `${artifact}.meta.json`);
      let raw: string;
      try {
        raw = await readFile(metaPath, "utf8");
      } catch {
        if (required) {
          throw new Error(
            `install refused: ${artifact} artifact for plugin "${manifest.id}" is missing dist/${artifact}.meta.json`,
          );
        }
        return;
      }
      const problem = validatePluginArtifactMeta({
        artifact,
        raw,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
      });
      if (problem !== null) {
        throw new Error(`install refused: ${problem}`);
      }
    }

    if (managed) {
      await validateArtifact("server", false);
      if (manifest.appEntry !== undefined) {
        await validateArtifact("app", kind === "npm");
      }
    }
    return manifest;
  }

  /**
   * Shared install tail: validate the materialized files (unless the caller
   * already validated them in a staging dir), upsert the row, and (re)load.
   */
  const builtinPluginIds = new Set<string>(BUILTIN_PLUGIN_NAMES);

  function refuseBuiltinShadow(pluginId: string): void {
    if (!builtinPluginIds.has(pluginId)) return;
    throw new Error(
      `install refused: plugin id "${pluginId}" is reserved by the builtin plugin of the same name; install "builtin:${pluginId}" instead`,
    );
  }

  function emptyPluginUpdateState() {
    return {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    } as const;
  }

  function rowMatchesInstallSource(
    row: InstalledPluginRow,
    provenance: PluginProvenance,
    intent: PluginSourceIntent,
  ): boolean {
    if (row.provenance !== provenance.kind || row.sourceKind !== intent.kind) {
      return false;
    }
    if (
      provenance.kind === "marketplace" &&
      (row.marketplaceId !== provenance.marketplaceId ||
        row.marketplaceEntryId !== provenance.entryId)
    ) {
      return false;
    }
    if (intent.kind === "path") return row.sourcePath === intent.canonicalPath;
    if (intent.kind === "builtin") {
      return row.sourceBuiltinName === intent.name;
    }
    if (intent.kind === "npm") {
      return (
        row.sourceNpmPackage === intent.packageName &&
        row.sourceNpmRegistry === intent.registry &&
        row.sourceNpmRequestedSpec === intent.requestedSpec &&
        row.sourceNpmSpecKind === intent.specKind
      );
    }
    return (
      row.sourceGitUrl === intent.url &&
      row.sourceGitSubdirectory === intent.subdirectory &&
      row.sourceGitRequestedRef === intent.requestedRef &&
      row.sourceGitRefKind === intent.refKind
    );
  }

  function registrationMatchesForActivation(
    current: InstalledPluginRow,
    expected: InstalledPluginRow,
  ): boolean {
    return (
      current.source === expected.source &&
      current.provenance === expected.provenance &&
      current.marketplaceId === expected.marketplaceId &&
      current.marketplaceEntryId === expected.marketplaceEntryId &&
      current.sourceKind === expected.sourceKind &&
      current.sourcePath === expected.sourcePath &&
      current.sourceBuiltinName === expected.sourceBuiltinName &&
      current.sourceNpmPackage === expected.sourceNpmPackage &&
      current.sourceNpmRegistry === expected.sourceNpmRegistry &&
      current.sourceNpmRequestedSpec === expected.sourceNpmRequestedSpec &&
      current.sourceNpmSpecKind === expected.sourceNpmSpecKind &&
      current.sourceGitUrl === expected.sourceGitUrl &&
      current.sourceGitSubdirectory === expected.sourceGitSubdirectory &&
      current.sourceGitRequestedRef === expected.sourceGitRequestedRef &&
      current.sourceGitRefKind === expected.sourceGitRefKind &&
      current.npmResolvedVersion === expected.npmResolvedVersion &&
      current.npmIntegrity === expected.npmIntegrity &&
      current.gitResolvedCommit === expected.gitResolvedCommit &&
      current.activeArtifactId === expected.activeArtifactId &&
      current.rootDir === expected.rootDir &&
      current.version === expected.version &&
      current.enabled === expected.enabled
    );
  }

  function sourceFingerprint(row: InstalledPluginRow): string {
    return JSON.stringify({
      source: row.source,
      provenance: row.provenance,
      marketplaceId: row.marketplaceId,
      marketplaceEntryId: row.marketplaceEntryId,
      sourceKind: row.sourceKind,
      sourcePath: row.sourcePath,
      sourceBuiltinName: row.sourceBuiltinName,
      sourceNpmPackage: row.sourceNpmPackage,
      sourceNpmRegistry: row.sourceNpmRegistry,
      sourceNpmRequestedSpec: row.sourceNpmRequestedSpec,
      sourceNpmSpecKind: row.sourceNpmSpecKind,
      sourceGitUrl: row.sourceGitUrl,
      sourceGitSubdirectory: row.sourceGitSubdirectory,
      sourceGitRequestedRef: row.sourceGitRequestedRef,
      sourceGitRefKind: row.sourceGitRefKind,
    });
  }

  async function readNpmIntegrity(
    prefix: string,
    packageName: string,
  ): Promise<string | null> {
    let value: unknown;
    try {
      value = JSON.parse(
        await readFile(join(prefix, "package-lock.json"), "utf8"),
      );
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const lock = value as Record<string, unknown>;
    const packages = lock.packages;
    if (typeof packages === "object" && packages !== null) {
      const entry = (packages as Record<string, unknown>)[
        `node_modules/${packageName}`
      ];
      if (typeof entry === "object" && entry !== null && "integrity" in entry) {
        if (typeof entry.integrity === "string") return entry.integrity;
      }
    }
    const dependencies = lock.dependencies;
    if (typeof dependencies !== "object" || dependencies === null) return null;
    const dependency = (dependencies as Record<string, unknown>)[packageName];
    if (
      typeof dependency !== "object" ||
      dependency === null ||
      !("integrity" in dependency)
    ) {
      return null;
    }
    return typeof dependency.integrity === "string"
      ? dependency.integrity
      : null;
  }

  async function resolveNpmRegistry(
    prefix: string,
    packageName: string,
  ): Promise<string> {
    const scope = packageName.startsWith("@")
      ? packageName.slice(0, packageName.indexOf("/"))
      : null;
    const keys =
      scope === null ? ["registry"] : [`${scope}:registry`, "registry"];
    for (const key of keys) {
      const value = await runInstallCommand("npm", [
        "config",
        "get",
        key,
        "--prefix",
        prefix,
      ]);
      if (value.length > 0 && value !== "undefined" && value !== "null") {
        return value;
      }
    }
    throw new Error(`npm did not resolve a registry for ${packageName}`);
  }

  interface InstallRegistrationIdentity {
    provenance: PluginProvenance;
    sourceIntent: PluginSourceIntent;
  }

  interface RegisterInstalledArgs extends InstallRegistrationIdentity {
    rootDir: string;
    source: string;
    exactResolution: PluginExactResolution;
    installation?: { engines: { bb?: string; bbPluginSdk?: string } };
    refuseEngineMismatch: boolean;
    /** True when validateInstallDir already ran against a staging copy of
     * these exact files (managed installs validate before the swap). */
    validated: boolean;
    activeArtifactId?: string;
    preparedManifest?: PluginManifest;
    beforePersist?: () => Promise<void>;
  }

  function assertInstallRegistrationAvailable(
    existing: InstalledPluginRow | undefined,
    identity: InstallRegistrationIdentity,
    pluginId: string,
  ): void {
    if (existing === undefined) return;
    if (
      !rowMatchesInstallSource(
        existing,
        identity.provenance,
        identity.sourceIntent,
      )
    ) {
      throw new Error(
        `plugin id "${pluginId}" is already installed from ${existing.source}; remove it first`,
      );
    }
    if (
      identity.provenance.kind === "marketplace" ||
      identity.sourceIntent.kind === "npm" ||
      identity.sourceIntent.kind === "git"
    ) {
      throw new Error(
        `plugin "${pluginId}" is already installed; use \`bb plugin update ${pluginId}\` or remove it before reinstalling`,
      );
    }
  }

  async function registerInstalled(
    args: RegisterInstalledArgs,
  ): Promise<PluginListEntry> {
    const initialManifest =
      args.preparedManifest ?? (await readPluginManifest(args.rootDir));
    assertInstallRegistrationAvailable(
      getInstalledPlugin(deps.db, initialManifest.id),
      args,
      initialManifest.id,
    );
    const catalogEngines = args.installation?.engines;
    const wideningProblem = marketplacePolicyWideningProblem(
      args.installation,
      initialManifest,
    );
    if (wideningProblem !== null) {
      throw new Error(`install refused: ${wideningProblem}`);
    }
    if (catalogEngines !== undefined) {
      const catalogCompatibility = evaluateCompatibility({
        bbRange: catalogEngines.bb,
        sdkRange: catalogEngines.bbPluginSdk,
        appVersion: deps.appVersion,
      });
      if (catalogCompatibility.effective.length > 0) {
        throw new Error(
          `install refused by marketplace compatibility policy: ${catalogCompatibility.effective.map((problem) => problem.message).join("; ")}`,
        );
      }
    }
    if (args.provenance.kind !== "builtin") {
      refuseBuiltinShadow(initialManifest.id);
    }
    const manifest = args.validated
      ? initialManifest
      : await validateInstallDir(args);
    await withLifecycleLock(manifest.id, async () => {
      const existing = getInstalledPlugin(deps.db, manifest.id);
      assertInstallRegistrationAvailable(existing, args, manifest.id);
      await disposeOne(manifest.id);
      try {
        await args.beforePersist?.();
        upsertInstalledPlugin(deps.db, {
          id: manifest.id,
          source: args.source,
          provenance: args.provenance,
          sourceIntent: args.sourceIntent,
          exactResolution: args.exactResolution,
          updateState: emptyPluginUpdateState(),
          activeArtifactId: args.activeArtifactId ?? null,
          rootDir: args.rootDir,
          version: manifest.version,
          enabled: existing?.enabled ?? true,
        });
        const row = getInstalledPlugin(deps.db, manifest.id);
        if (row && shouldLoadRow(row)) {
          await loadOne(row);
        } else if (row) {
          await unloadOneForExperimentGate(row);
        }
      } catch (error) {
        const previous = getInstalledPlugin(deps.db, manifest.id);
        if (previous && shouldLoadRow(previous)) {
          await loadOne(previous);
        } else if (previous) {
          await unloadOneForExperimentGate(previous);
        }
        throw error;
      }
    });
    await syncCliSkill();
    notifyPluginsChanged();
    const entry = list().find((p) => p.id === manifest.id);
    if (!entry) throw new Error(`plugin ${manifest.id} missing after install`);
    return entry;
  }

  interface InstallContext {
    provenance: PluginProvenance;
    installation?: { engines: { bb?: string; bbPluginSdk?: string } };
    gitSubdirectory?: string;
    npmRegistry?: string;
  }

  const directInstallContext: InstallContext = {
    provenance: { kind: "direct" },
  };

  async function installPathSource(
    path: string,
    context: InstallContext = directInstallContext,
  ): Promise<PluginListEntry> {
    const rootDir = resolve(path);
    return registerInstalled({
      rootDir,
      source: `path:${rootDir}`,
      provenance: context.provenance,
      sourceIntent: { kind: "path", canonicalPath: rootDir },
      exactResolution: { kind: "path" },
      refuseEngineMismatch: false,
      validated: false,
      ...(context.installation === undefined
        ? {}
        : { installation: context.installation }),
    });
  }

  async function installGitSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "git" }>,
    source: string,
    context: InstallContext = directInstallContext,
  ): Promise<PluginListEntry> {
    const resolution = await resolveGitRef({
      url: parsed.url,
      ref: parsed.ref,
    });
    if (resolution.outcome === "unavailable") {
      throw new Error(`install failed: ${resolution.detail}`);
    }
    const resolvedCommit = resolution.commit;
    const registrationIdentity: InstallRegistrationIdentity = {
      provenance: context.provenance,
      sourceIntent: {
        kind: "git",
        url: parsed.url,
        subdirectory: context.gitSubdirectory ?? null,
        requestedRef: parsed.ref,
        refKind: resolution.refKind,
      },
    };
    const targetDir = gitArtifactCacheDir(
      deps.dataDir,
      parsed.cachePath,
      resolvedCommit,
    );
    return withArtifactLock(targetDir, async () => {
      const stagingDir = `${targetDir}.staging`;
      await rm(stagingDir, { recursive: true, force: true });
      const targetRoot = resolve(targetDir, context.gitSubdirectory ?? ".");
      if (targetRoot !== targetDir && !targetRoot.startsWith(`${targetDir}/`)) {
        throw new Error(
          `invalid git plugin subdirectory ${JSON.stringify(context.gitSubdirectory)}`,
        );
      }
      const cachedRealRoot = await realPathInside(
        targetDir,
        targetRoot,
        "git plugin subdirectory",
      ).catch(() => null);
      const cachedManifest =
        cachedRealRoot === null
          ? null
          : await readPluginManifest(cachedRealRoot).catch(() => null);
      if (cachedManifest !== null) {
        assertInstallRegistrationAvailable(
          getInstalledPlugin(deps.db, cachedManifest.id),
          registrationIdentity,
          cachedManifest.id,
        );
      }
      const existingArtifact =
        cachedManifest === null
          ? undefined
          : getPluginArtifactByResolution(deps.db, {
              sourceKind: "git",
              pluginId: cachedManifest.id,
              path: targetRoot,
              commit: resolvedCommit,
            });
      if (
        (existingArtifact?.validationResult === "valid" ||
          existingArtifact?.validationResult === "pending") &&
        existingArtifact.contentHash !== null
      ) {
        const currentHash = await hashInstallDir(targetDir).catch(() => null);
        if (currentHash === existingArtifact.contentHash) {
          if (existingArtifact.validationResult === "pending") {
            setPluginArtifactValidation(deps.db, existingArtifact.id, {
              contentHash: existingArtifact.contentHash,
              validationResult: "valid",
              validatedAt: Date.now(),
            });
          }
          return registerInstalled({
            rootDir: targetRoot,
            source,
            ...registrationIdentity,
            exactResolution: { kind: "git", commit: resolvedCommit },
            ...(context.installation === undefined
              ? {}
              : { installation: context.installation }),
            refuseEngineMismatch: true,
            validated: true,
            activeArtifactId: existingArtifact.id,
          });
        }
      }
      await mkdir(dirname(targetDir), { recursive: true });
      const notFoundHint =
        '"git" was not found on PATH — git: plugin installs require git';
      try {
        deps.onArtifactMaterialize?.({ path: targetDir });
        await runInstallCommand(
          "git",
          ["clone", "--quiet", parsed.url, stagingDir],
          { notFoundHint },
        );
        await runInstallCommand("git", [
          "-C",
          stagingDir,
          "checkout",
          "--quiet",
          "--detach",
          resolvedCommit,
        ]);
        const stagedRoot = resolve(stagingDir, context.gitSubdirectory ?? ".");
        if (
          stagedRoot !== stagingDir &&
          !stagedRoot.startsWith(`${stagingDir}/`)
        ) {
          throw new Error(
            `invalid git plugin subdirectory ${JSON.stringify(context.gitSubdirectory)}`,
          );
        }
        const stagedRealRoot = await realPathInside(
          stagingDir,
          stagedRoot,
          "git plugin subdirectory",
        );
        const stagedManifest = await readPluginManifest(stagedRealRoot);
        assertInstallRegistrationAvailable(
          getInstalledPlugin(deps.db, stagedManifest.id),
          registrationIdentity,
          stagedManifest.id,
        );
        refuseBuiltinShadow(stagedManifest.id);
        const checkedOutCommit = await runInstallCommand("git", [
          "-C",
          stagingDir,
          "rev-parse",
          "HEAD",
        ]);
        if (!checkedOutCommit.startsWith(resolvedCommit)) {
          throw new Error(
            `git resolved ${parsed.ref} to ${resolvedCommit}, but checked out ${checkedOutCommit}`,
          );
        }
        await validateInstallDir({
          rootDir: stagedRealRoot,
          source,
          refuseEngineMismatch: true,
        });
        const contentHash = await hashInstallDir(stagingDir);
        const ownedArtifact =
          existingArtifact ??
          getPluginArtifactByResolution(deps.db, {
            sourceKind: "git",
            pluginId: stagedManifest.id,
            path: targetRoot,
            commit: resolvedCommit,
          });
        const artifact =
          ownedArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: stagedManifest.id,
            sourceKind: "git",
            npmResolvedVersion: null,
            gitResolvedCommit: resolvedCommit,
            path: targetRoot,
            integrity: null,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        if (ownedArtifact !== undefined) {
          setPluginArtifactValidation(deps.db, artifact.id, {
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        }
        return registerInstalled({
          rootDir: targetRoot,
          source,
          ...registrationIdentity,
          exactResolution: { kind: "git", commit: resolvedCommit },
          ...(context.installation === undefined
            ? {}
            : { installation: context.installation }),
          refuseEngineMismatch: true,
          validated: true,
          activeArtifactId: artifact.id,
          preparedManifest: stagedManifest,
          beforePersist: async () => {
            await promoteImmutableDir({ stagingDir, targetDir, contentHash });
            await deps.afterArtifactPromoted?.({
              pluginId: stagedManifest.id,
              artifactId: artifact.id,
              path: targetRoot,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true });
        throw error;
      }
      throw new Error("unreachable git install state");
    });
  }

  async function installNpmSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "npm" }>,
    source: string,
    context: InstallContext = directInstallContext,
  ): Promise<PluginListEntry> {
    const registryProbe = join(deps.dataDir, "plugins", "npm", ".registry");
    await mkdir(registryProbe, { recursive: true });
    const registry =
      context.npmRegistry ??
      (await resolveNpmRegistry(registryProbe, parsed.name));
    const intent: NpmSourceIntentForResolution = {
      packageName: parsed.name,
      registry,
      requestedSpec: parsed.spec,
      specKind: parsed.specKind,
    };
    const registrationIdentity: InstallRegistrationIdentity = {
      provenance: context.provenance,
      sourceIntent: { kind: "npm", ...intent },
    };
    const pluginId = derivePluginId(parsed.name);
    assertInstallRegistrationAvailable(
      getInstalledPlugin(deps.db, pluginId),
      registrationIdentity,
      pluginId,
    );
    const selected = await selectNpmCandidate({
      intent,
      appVersion: deps.appVersion,
      run: createNpmResolverRun(),
    });
    if (selected.outcome === "unavailable") {
      throw new Error(`install failed: ${selected.detail}`);
    }
    if (selected.outcome === "incompatible") {
      throw new Error(
        `install refused: ${selected.newest.display} ${selected.reasons.map((problem) => problem.message).join("; ")}`,
      );
    }
    const candidate = selected.candidate;
    const prefix = npmArtifactCacheDir(
      deps.dataDir,
      parsed.name,
      candidate.version,
    );
    const rootDir = join(prefix, "node_modules", ...parsed.name.split("/"));
    return withArtifactLock(prefix, async () => {
      // Materialize + validate in a staging sibling; swap only once good, so
      // a failed refresh keeps the previous (still-loadable) install intact.
      const stagingPrefix = `${prefix}.staging`;
      await rm(stagingPrefix, { recursive: true, force: true });
      const cachedManifest = await readPluginManifest(rootDir).catch(
        () => null,
      );
      const existingArtifact =
        cachedManifest === null
          ? undefined
          : getPluginArtifactByResolution(deps.db, {
              sourceKind: "npm",
              pluginId: cachedManifest.id,
              path: rootDir,
              version: candidate.version,
              integrity: candidate.integrity,
            });
      if (
        (existingArtifact?.validationResult === "valid" ||
          existingArtifact?.validationResult === "pending") &&
        existingArtifact.contentHash !== null
      ) {
        const currentHash = await hashInstallDir(prefix).catch(() => null);
        if (currentHash === existingArtifact.contentHash) {
          if (existingArtifact.validationResult === "pending") {
            setPluginArtifactValidation(deps.db, existingArtifact.id, {
              contentHash: existingArtifact.contentHash,
              validationResult: "valid",
              validatedAt: Date.now(),
            });
          }
          return registerInstalled({
            rootDir,
            source,
            ...registrationIdentity,
            exactResolution: {
              kind: "npm",
              version: candidate.version,
              integrity: candidate.integrity,
            },
            ...(context.installation === undefined
              ? {}
              : { installation: context.installation }),
            refuseEngineMismatch: true,
            validated: true,
            activeArtifactId: existingArtifact.id,
          });
        }
      }
      await mkdir(stagingPrefix, { recursive: true });
      try {
        deps.onArtifactMaterialize?.({ path: rootDir });
        await runInstallCommand(
          "npm",
          [
            "install",
            "--prefix",
            stagingPrefix,
            "--ignore-scripts",
            "--omit=optional",
            "--no-audit",
            "--no-fund",
            "--registry",
            registry,
            `${parsed.name}@${candidate.version}`,
          ],
          {
            notFoundHint:
              '"npm" was not found on PATH — npm: plugin installs require npm',
          },
        );
        await validateInstallDir({
          rootDir: join(
            stagingPrefix,
            "node_modules",
            ...parsed.name.split("/"),
          ),
          source,
          refuseEngineMismatch: true,
        });
        const installedIntegrity = await readNpmIntegrity(
          stagingPrefix,
          parsed.name,
        );
        if (
          installedIntegrity !== null &&
          installedIntegrity !== candidate.integrity
        ) {
          throw new Error(
            `install failed: integrity for ${candidate.display} did not match registry metadata`,
          );
        }
        const stagedRoot = join(
          stagingPrefix,
          "node_modules",
          ...parsed.name.split("/"),
        );
        const manifest = await readPluginManifest(stagedRoot);
        const contentHash = await hashInstallDir(stagingPrefix);
        const ownedArtifact =
          existingArtifact ??
          getPluginArtifactByResolution(deps.db, {
            sourceKind: "npm",
            pluginId: manifest.id,
            path: rootDir,
            version: candidate.version,
            integrity: candidate.integrity,
          });
        const artifact =
          ownedArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: manifest.id,
            sourceKind: "npm",
            npmResolvedVersion: candidate.version,
            gitResolvedCommit: null,
            path: rootDir,
            integrity: candidate.integrity,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        if (ownedArtifact !== undefined) {
          setPluginArtifactValidation(deps.db, artifact.id, {
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        }
        return registerInstalled({
          rootDir,
          source,
          ...registrationIdentity,
          exactResolution: {
            kind: "npm",
            version: candidate.version,
            integrity: candidate.integrity,
          },
          ...(context.installation === undefined
            ? {}
            : { installation: context.installation }),
          refuseEngineMismatch: true,
          validated: true,
          activeArtifactId: artifact.id,
          preparedManifest: manifest,
          beforePersist: async () => {
            await promoteImmutableDir({
              stagingDir: stagingPrefix,
              targetDir: prefix,
              contentHash,
            });
            await deps.afterArtifactPromoted?.({
              pluginId: manifest.id,
              artifactId: artifact.id,
              path: rootDir,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
      } catch (error) {
        await rm(stagingPrefix, { recursive: true, force: true });
        throw error;
      }
      throw new Error("unreachable npm install state");
    });
  }

  function npmIntentForRow(
    row: InstalledPluginRow,
  ): NpmSourceIntentForResolution {
    if (
      row.sourceKind !== "npm" ||
      row.sourceNpmPackage === null ||
      row.sourceNpmRegistry === null ||
      row.sourceNpmRequestedSpec === null
    ) {
      throw new Error(`plugin "${row.id}" has corrupt normalized npm state`);
    }
    let specKind = row.sourceNpmSpecKind;
    if (specKind === null) {
      const parsed = parsePluginSource(
        row.sourceNpmRequestedSpec.length === 0
          ? `npm:${row.sourceNpmPackage}`
          : `npm:${row.sourceNpmPackage}@${row.sourceNpmRequestedSpec}`,
      );
      if (parsed.kind !== "npm") {
        throw new Error(`plugin "${row.id}" has corrupt normalized npm state`);
      }
      specKind = parsed.specKind;
      if (
        !setInstalledPluginSourceClassification(deps.db, row.id, {
          kind: "npm",
          specKind,
        })
      ) {
        throw new Error(`plugin "${row.id}" disappeared during normalization`);
      }
    }
    return {
      packageName: row.sourceNpmPackage,
      registry: row.sourceNpmRegistry,
      requestedSpec: row.sourceNpmRequestedSpec,
      specKind,
    };
  }

  function installedUpdateVersion(
    row: InstalledPluginRow,
  ): PluginResolvedUpdateVersion {
    if (row.sourceKind === "npm") {
      if (row.sourceNpmPackage === null || row.npmResolvedVersion === null) {
        throw new Error(`plugin "${row.id}" has corrupt normalized npm state`);
      }
      return {
        version: row.npmResolvedVersion,
        display: `${row.sourceNpmPackage}@${row.npmResolvedVersion}`,
      };
    }
    if (row.sourceKind === "git") {
      if (
        row.sourceGitUrl === null ||
        row.sourceGitRequestedRef === null ||
        row.gitResolvedCommit === null
      ) {
        throw new Error(`plugin "${row.id}" has corrupt normalized git state`);
      }
      return gitResolvedVersion({
        url: row.sourceGitUrl,
        ref: row.sourceGitRequestedRef,
        commit: row.gitResolvedCommit,
      });
    }
    return { version: row.version, display: row.source };
  }

  function provenanceForRow(row: InstalledPluginRow): PluginProvenance {
    if (row.provenance !== "marketplace") return { kind: row.provenance };
    if (row.marketplaceId === null || row.marketplaceEntryId === null) {
      throw new Error(`plugin "${row.id}" has corrupt marketplace provenance`);
    }
    return {
      kind: "marketplace",
      marketplaceId: row.marketplaceId,
      entryId: row.marketplaceEntryId,
    };
  }

  function sourceIntentForRow(row: InstalledPluginRow): PluginSourceIntent {
    if (row.sourceKind === "path" && row.sourcePath !== null) {
      return { kind: "path", canonicalPath: row.sourcePath };
    }
    if (row.sourceKind === "builtin" && row.sourceBuiltinName !== null) {
      return { kind: "builtin", name: row.sourceBuiltinName };
    }
    if (row.sourceKind === "npm")
      return { kind: "npm", ...npmIntentForRow(row) };
    if (
      row.sourceKind === "git" &&
      row.sourceGitUrl !== null &&
      row.sourceGitRequestedRef !== null &&
      row.sourceGitRefKind !== null
    ) {
      return {
        kind: "git",
        url: row.sourceGitUrl,
        subdirectory: row.sourceGitSubdirectory,
        requestedRef: row.sourceGitRequestedRef,
        refKind: row.sourceGitRefKind,
      };
    }
    throw new Error(`plugin "${row.id}" has corrupt normalized source intent`);
  }

  function exactResolutionForRow(
    row: InstalledPluginRow,
  ): PluginExactResolution {
    if (row.sourceKind === "path" || row.sourceKind === "builtin") {
      return { kind: row.sourceKind };
    }
    if (
      row.sourceKind === "npm" &&
      row.npmResolvedVersion !== null &&
      row.npmIntegrity !== null
    ) {
      return {
        kind: "npm",
        version: row.npmResolvedVersion,
        integrity: row.npmIntegrity,
      };
    }
    if (row.sourceKind === "git" && row.gitResolvedCommit !== null) {
      return { kind: "git", commit: row.gitResolvedCommit };
    }
    throw new Error(`plugin "${row.id}" has corrupt exact resolution`);
  }

  function restoreRegistration(row: InstalledPluginRow): void {
    upsertInstalledPlugin(deps.db, {
      id: row.id,
      source: row.source,
      provenance: provenanceForRow(row),
      sourceIntent: sourceIntentForRow(row),
      exactResolution: exactResolutionForRow(row),
      updateState: {
        lastCheckAt: row.lastUpdateCheckAt,
        availableCompatibleVersion: row.availableCompatibleVersion,
        newestIncompatibleVersion: row.newestIncompatibleVersion,
        statusDetail: row.updateStatusDetail,
      },
      activeArtifactId: row.activeArtifactId,
      rootDir: row.rootDir,
      version: row.version,
      enabled: row.enabled,
    });
  }

  function problemMessages(problems: CompatibilityProblem[]): string[] {
    return problems.map((problem) => problem.message);
  }

  function checkEntryFromResolution(
    id: string,
    installed: PluginResolvedUpdateVersion,
    resolution: PluginUpdateResolution,
  ): PluginUpdateCheckEntry {
    const dev = resolution.devMode ? { devMode: true as const } : {};
    const packagedDetail =
      resolution.packagedBuildProblems !== undefined &&
      resolution.packagedBuildProblems.length > 0
        ? `dev mode selected this candidate; a packaged build would reject it: ${problemMessages(resolution.packagedBuildProblems).join("; ")}`
        : undefined;
    const blocked =
      resolution.outcome === "incompatible"
        ? {
            version: resolution.newest.version,
            reasons: problemMessages(resolution.reasons),
          }
        : resolution.blocked !== undefined
          ? {
              version: resolution.blocked.version.version,
              reasons: problemMessages(resolution.blocked.reasons),
            }
          : undefined;
    const common = {
      id,
      outcome: resolution.outcome,
      installed,
      ...dev,
      ...(blocked ? { blocked } : {}),
      ...(packagedDetail ? { detail: packagedDetail } : {}),
    };
    if (resolution.outcome === "update-available") {
      return { ...common, candidate: resolution.candidate };
    }
    if (resolution.outcome === "unavailable") {
      return { ...common, detail: resolution.detail };
    }
    return common;
  }

  function persistUpdateEntry(entry: PluginUpdateCheckEntry): void {
    const changed = setInstalledPluginUpdateState(deps.db, entry.id, {
      lastCheckAt: Date.now(),
      availableCompatibleVersion: entry.candidate?.version ?? null,
      newestIncompatibleVersion: entry.blocked?.version ?? null,
      statusDetail: JSON.stringify(entry),
    });
    if (!changed) {
      throw new Error(`plugin "${entry.id}" disappeared during update check`);
    }
  }

  async function stageGitCandidate(args: {
    row: InstalledPluginRow;
    commit: string;
    promote: boolean;
    activationRefKind?: GitRefKind;
    artifactLocked?: boolean;
  }): Promise<
    | {
        outcome: "valid";
        manifest: PluginManifest;
        devMode: boolean;
        packagedBuildProblems: CompatibilityProblem[];
        rootDir: string | null;
        artifactId: string | null;
      }
    | {
        outcome: "incompatible";
        manifest: PluginManifest;
        devMode: boolean;
        reasons: CompatibilityProblem[];
      }
    | { outcome: "invalid"; detail: string }
  > {
    if (args.row.sourceGitUrl === null) {
      throw new Error(
        `plugin "${args.row.id}" has corrupt normalized git state`,
      );
    }
    const cacheSource = parsePluginSource(
      `git:${args.row.sourceGitUrl}@${args.commit}`,
    );
    if (cacheSource.kind !== "git") {
      throw new Error(`plugin "${args.row.id}" has corrupt git source`);
    }
    const targetDir = gitArtifactCacheDir(
      deps.dataDir,
      cacheSource.cachePath,
      args.commit,
    );
    const targetRoot =
      args.row.sourceGitSubdirectory === null
        ? targetDir
        : join(targetDir, args.row.sourceGitSubdirectory);
    if (args.promote && !args.artifactLocked) {
      return withArtifactLock(targetDir, () =>
        stageGitCandidate({ ...args, artifactLocked: true }),
      );
    }
    const existingArtifact = getPluginArtifactByResolution(deps.db, {
      sourceKind: "git",
      pluginId: args.row.id,
      path: targetRoot,
      commit: args.commit,
    });
    if (
      args.promote &&
      (existingArtifact?.validationResult === "valid" ||
        existingArtifact?.validationResult === "pending") &&
      existingArtifact.contentHash !== null &&
      (await hashInstallDir(targetDir).catch(() => null)) ===
        existingArtifact.contentHash
    ) {
      const targetRealRoot = await realPathInside(
        targetDir,
        targetRoot,
        "git plugin subdirectory",
      );
      const manifest = await readPluginManifest(targetRealRoot);
      const compatibility = evaluateCompatibility({
        bbRange: manifest.bbEngineRange,
        sdkRange: manifest.bbPluginSdkRange,
        appVersion: deps.appVersion,
      });
      if (args.activationRefKind === undefined) {
        throw new Error(`plugin "${args.row.id}" update lacks git ref kind`);
      }
      if (args.row.sourceGitRequestedRef === null) {
        throw new Error(`plugin "${args.row.id}" update lacks git intent`);
      }
      if (existingArtifact.validationResult === "pending") {
        setPluginArtifactValidation(deps.db, existingArtifact.id, {
          contentHash: existingArtifact.contentHash,
          validationResult: "valid",
          validatedAt: Date.now(),
        });
      }
      await activateManagedUpdate({
        row: args.row,
        rootDir: targetRoot,
        manifest,
        source: args.row.source,
        sourceIntent: {
          kind: "git",
          url: args.row.sourceGitUrl,
          subdirectory: args.row.sourceGitSubdirectory,
          requestedRef: args.row.sourceGitRequestedRef,
          refKind: args.activationRefKind,
        },
        exactResolution: { kind: "git", commit: args.commit },
        artifactId: existingArtifact.id,
      });
      return {
        outcome: "valid",
        manifest,
        devMode: compatibility.devMode,
        packagedBuildProblems: compatibility.packaged,
        rootDir: targetRoot,
        artifactId: existingArtifact.id,
      };
    }
    const stagingDir = args.promote
      ? `${targetDir}.staging`
      : `${args.row.rootDir}.update-staging-${randomUUID()}`;
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(dirname(stagingDir), { recursive: true });
    try {
      deps.onArtifactMaterialize?.({ path: targetRoot });
      await runInstallCommand(
        "git",
        ["clone", "--quiet", args.row.sourceGitUrl, stagingDir],
        {
          notFoundHint:
            '"git" was not found on PATH — git plugin updates require git',
        },
      );
      await runInstallCommand("git", [
        "-C",
        stagingDir,
        "checkout",
        "--quiet",
        "--detach",
        args.commit,
      ]);
      const pluginRoot =
        args.row.sourceGitSubdirectory === null
          ? stagingDir
          : join(stagingDir, args.row.sourceGitSubdirectory);
      let realPluginRoot: string;
      try {
        realPluginRoot = await realPathInside(
          stagingDir,
          pluginRoot,
          "git plugin subdirectory",
        );
      } catch (error) {
        return {
          outcome: "invalid",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      let manifest: PluginManifest;
      try {
        manifest = await readPluginManifest(realPluginRoot);
      } catch (error) {
        return {
          outcome: "invalid",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      if (manifest.id !== args.row.id) {
        return {
          outcome: "invalid",
          detail: `candidate manifest id changed from "${args.row.id}" to "${manifest.id}"`,
        };
      }
      const compatibility = evaluateCompatibility({
        bbRange: manifest.bbEngineRange,
        sdkRange: manifest.bbPluginSdkRange,
        appVersion: deps.appVersion,
      });
      if (compatibility.effective.length > 0) {
        return {
          outcome: "incompatible",
          manifest,
          devMode: compatibility.devMode,
          reasons: compatibility.effective,
        };
      }
      try {
        await validateInstallDir({
          rootDir: realPluginRoot,
          source: args.row.source,
          refuseEngineMismatch: true,
        });
      } catch (error) {
        return {
          outcome: "invalid",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      let artifactId: string | null = null;
      if (args.promote) {
        if (
          args.activationRefKind === undefined ||
          args.row.sourceGitRequestedRef === null
        ) {
          throw new Error(`plugin "${args.row.id}" update lacks git intent`);
        }
        const contentHash = await hashInstallDir(stagingDir);
        const artifact =
          existingArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: args.row.id,
            sourceKind: "git",
            npmResolvedVersion: null,
            gitResolvedCommit: args.commit,
            path: targetRoot,
            integrity: null,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        if (existingArtifact !== undefined) {
          setPluginArtifactValidation(deps.db, existingArtifact.id, {
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        }
        await activateManagedUpdate({
          row: args.row,
          rootDir: targetRoot,
          manifest,
          source: args.row.source,
          sourceIntent: {
            kind: "git",
            url: args.row.sourceGitUrl,
            subdirectory: args.row.sourceGitSubdirectory,
            requestedRef: args.row.sourceGitRequestedRef,
            refKind: args.activationRefKind,
          },
          exactResolution: { kind: "git", commit: args.commit },
          artifactId: artifact.id,
          beforePersist: async () => {
            await promoteImmutableDir({ stagingDir, targetDir, contentHash });
            await deps.afterArtifactPromoted?.({
              pluginId: args.row.id,
              artifactId: artifact.id,
              path: targetRoot,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
        artifactId = artifact.id;
      }
      return {
        outcome: "valid",
        manifest,
        devMode: compatibility.devMode,
        packagedBuildProblems: compatibility.packaged,
        rootDir: args.promote ? targetRoot : null,
        artifactId,
      };
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async function resolveUpdateForRow(args: {
    row: InstalledPluginRow;
    npmRun: ReturnType<typeof createNpmResolverRun>;
    npmIntentOverride?: NpmSourceIntentForResolution;
  }): Promise<PluginUpdateResolution> {
    const installed = installedUpdateVersion(args.row);
    if (args.row.sourceKind === "path" || args.row.sourceKind === "builtin") {
      return { outcome: "pinned", current: installed };
    }
    if (args.row.sourceKind === "npm") {
      return resolveNpmUpdate({
        intent: args.npmIntentOverride ?? npmIntentForRow(args.row),
        current: installed,
        appVersion: deps.appVersion,
        run: args.npmRun,
        includePinned: args.npmIntentOverride !== undefined,
      });
    }
    if (
      args.row.sourceGitUrl === null ||
      args.row.sourceGitRequestedRef === null ||
      args.row.gitResolvedCommit === null
    ) {
      throw new Error(
        `plugin "${args.row.id}" has corrupt normalized git state`,
      );
    }
    let refKind = args.row.sourceGitRefKind;
    if (refKind === null) {
      const classified = await resolveGitRef({
        url: args.row.sourceGitUrl,
        ref: args.row.sourceGitRequestedRef,
      });
      if (classified.outcome === "unavailable") return classified;
      refKind = classified.refKind;
      if (
        !setInstalledPluginSourceClassification(deps.db, args.row.id, {
          kind: "git",
          refKind,
        })
      ) {
        throw new Error(
          `plugin "${args.row.id}" disappeared during normalization`,
        );
      }
    }
    const remote = await resolveGitUpdate({
      url: args.row.sourceGitUrl,
      ref: args.row.sourceGitRequestedRef,
      refKind,
      currentCommit: args.row.gitResolvedCommit,
    });
    if (remote.outcome !== "update-available") return remote;
    const staged = await stageGitCandidate({
      row: args.row,
      commit: remote.candidate.version,
      promote: false,
    });
    if (staged.outcome === "invalid") {
      return { outcome: "unavailable", detail: staged.detail };
    }
    if (staged.outcome === "incompatible") {
      return {
        outcome: "incompatible",
        current: remote.current,
        newest: remote.candidate,
        reasons: staged.reasons,
        ...(staged.devMode ? { devMode: true } : {}),
      };
    }
    return {
      ...remote,
      ...(staged.devMode ? { devMode: true } : {}),
      ...(staged.packagedBuildProblems.length > 0
        ? { packagedBuildProblems: staged.packagedBuildProblems }
        : {}),
    };
  }

  function requireRollbackMetadata(snapshot: PluginStateSnapshotRow) {
    if (
      snapshot.rollbackCandidateVersion === null ||
      snapshot.rollbackSourceFingerprint === null ||
      snapshot.rollbackBbVersion === null ||
      snapshot.rollbackSdkVersion === null ||
      snapshot.rollbackDetail === null
    ) {
      throw new Error(
        `plugin rollback snapshot ${snapshot.id} is missing rollback metadata`,
      );
    }
    return {
      candidateVersion: snapshot.rollbackCandidateVersion,
      sourceFingerprint: snapshot.rollbackSourceFingerprint,
      bbVersion: snapshot.rollbackBbVersion,
      sdkVersion: snapshot.rollbackSdkVersion,
      detail: snapshot.rollbackDetail,
    };
  }

  async function recoverRollbackWithinLifecycle(
    snapshotId: string,
  ): Promise<void> {
    const snapshot = getPluginStateSnapshot(deps.db, snapshotId);
    if (snapshot === undefined) {
      throw new Error(`plugin rollback snapshot disappeared: ${snapshotId}`);
    }
    const rollback = requireRollbackMetadata(snapshot);
    const previousRegistration = await readPluginSnapshotRegistration({
      db: deps.db,
      snapshotId,
    });
    if (previousRegistration.id !== snapshot.pluginId) {
      throw new Error(
        `plugin rollback snapshot ${snapshot.id} registration id does not match`,
      );
    }
    await disposeOne(snapshot.pluginId);
    // Rollback is intentionally limited to bb-owned state. Effects the
    // candidate already caused in external systems cannot be reversed.
    await restorePluginStateSnapshot({
      db: deps.db,
      dataDir: deps.dataDir,
      snapshotId,
      now: now(),
    });
    await deps.afterPluginRollbackStateRestored?.({
      pluginId: snapshot.pluginId,
      snapshotId,
    });
    restoreRegistration(previousRegistration);
    if (
      !setInstalledPluginLastFailure(deps.db, snapshot.pluginId, {
        version: rollback.candidateVersion,
        detail: rollback.detail,
        at: now(),
      })
    ) {
      throw new Error(
        `plugin "${snapshot.pluginId}" disappeared during rollback`,
      );
    }
    const previous = getInstalledPlugin(deps.db, snapshot.pluginId);
    if (previous && shouldLoadRow(previous)) await loadOne(previous);
    else if (previous) await unloadOneForExperimentGate(previous);
    const runtime = statuses.get(snapshot.pluginId);
    if (runtime?.status === "error") {
      throw new Error(
        `plugin "${snapshot.pluginId}" failed to reload during rollback: ${runtime.detail ?? "unknown error"}`,
      );
    }
    // Loading synchronizes schedule registrations; replay the captured host
    // rows once more so rollback restores their exact run state.
    await restorePluginHostStateSnapshot({ db: deps.db, snapshotId });
    if (!setPluginStateSnapshotStatus(deps.db, snapshotId, "restored", now())) {
      throw new Error(`plugin rollback snapshot disappeared: ${snapshotId}`);
    }
  }

  async function recoverIncompletePluginRollbacks(): Promise<void> {
    for (const snapshot of listIncompletePluginRollbackSnapshots(deps.db)) {
      const artifact = getPluginArtifact(deps.db, snapshot.toArtifactId);
      const artifactLockKey =
        (artifact === undefined ? null : pluginArtifactStorageRoot(artifact)) ??
        snapshot.snapshotPath;
      await withArtifactLock(artifactLockKey, () =>
        withLifecycleLock(snapshot.pluginId, () =>
          recoverRollbackWithinLifecycle(snapshot.id),
        ),
      );
    }
  }

  async function activateManagedUpdate(args: {
    row: InstalledPluginRow;
    rootDir: string;
    manifest: PluginManifest;
    source: string;
    sourceIntent: PluginSourceIntent;
    exactResolution: PluginExactResolution;
    artifactId: string;
    beforePersist?: () => Promise<void>;
  }): Promise<void> {
    const provenance = provenanceForRow(args.row);
    const candidateVersion =
      args.exactResolution.kind === "npm"
        ? args.exactResolution.version
        : args.exactResolution.kind === "git"
          ? args.exactResolution.commit
          : args.manifest.version;
    await withLifecycleLock(args.row.id, async () => {
      const beforeDispose = getInstalledPlugin(deps.db, args.row.id);
      if (
        beforeDispose === undefined ||
        !registrationMatchesForActivation(beforeDispose, args.row)
      ) {
        throw new Error(
          `plugin "${args.row.id}" registration changed during update`,
        );
      }
      await disposeOne(args.row.id);
      const snapshotNow = now();
      let snapshot: Awaited<ReturnType<typeof createPluginStateSnapshotOnDisk>>;
      try {
        snapshot = await createPluginStateSnapshotOnDisk({
          db: deps.db,
          dataDir: deps.dataDir,
          pluginId: args.row.id,
          fromArtifactId: args.row.activeArtifactId,
          toArtifactId: args.artifactId,
          now: snapshotNow,
          retainedUntil: snapshotNow + artifactRetentionMs,
          previousRegistration: args.row,
        });
      } catch (error) {
        const previous = getInstalledPlugin(deps.db, args.row.id);
        if (previous && shouldLoadRow(previous)) await loadOne(previous);
        else if (previous) await unloadOneForExperimentGate(previous);
        throw error;
      }
      let pointerWritten = false;
      try {
        await args.beforePersist?.();
        const beforeWrite = getInstalledPlugin(deps.db, args.row.id);
        if (
          beforeWrite === undefined ||
          !registrationMatchesForActivation(beforeWrite, args.row)
        ) {
          throw new Error(
            `plugin "${args.row.id}" registration changed during activation`,
          );
        }
        upsertInstalledPlugin(deps.db, {
          id: args.row.id,
          source: args.source,
          provenance,
          sourceIntent: args.sourceIntent,
          exactResolution: args.exactResolution,
          updateState: emptyPluginUpdateState(),
          activeArtifactId: args.artifactId,
          rootDir: args.rootDir,
          version: args.manifest.version,
          enabled: args.row.enabled,
        });
        pointerWritten = true;
        const current = getInstalledPlugin(deps.db, args.row.id);
        stabilizingPluginIds.add(args.row.id);
        if (current && shouldLoadRow(current)) await loadOne(current);
        else if (current) await unloadOneForExperimentGate(current);
        const immediate = statuses.get(args.row.id);
        if (immediate?.status === "error") {
          throw new Error(immediate.detail ?? "plugin failed to load");
        }
        if (stabilizationWindowMs > 0) {
          const failure = await new Promise<string | null>((resolveFailure) => {
            let cancelWindow = () => {};
            const listener = (
              status: PluginRuntimeStatus,
              detail: string | null,
            ) => {
              if (status !== "error") return;
              cancelWindow();
              const currentListeners = statusListeners.get(args.row.id);
              currentListeners?.delete(listener);
              if (currentListeners?.size === 0) {
                statusListeners.delete(args.row.id);
              }
              resolveFailure(detail ?? "plugin entered error status");
            };
            let listeners = statusListeners.get(args.row.id);
            if (listeners === undefined) {
              listeners = new Set();
              statusListeners.set(args.row.id, listeners);
            }
            listeners.add(listener);
            cancelWindow = scheduleStabilizationWindow(
              stabilizationWindowMs,
              () => {
                listeners.delete(listener);
                if (listeners.size === 0) statusListeners.delete(args.row.id);
                resolveFailure(null);
              },
            );
            const currentStatus = statuses.get(args.row.id);
            if (currentStatus?.status === "error") {
              listener(currentStatus.status, currentStatus.detail);
            }
          });
          if (failure !== null) throw new Error(failure);
        }
      } catch (error) {
        if (!pointerWritten) {
          const previous = getInstalledPlugin(deps.db, args.row.id);
          if (previous && shouldLoadRow(previous)) await loadOne(previous);
          else if (previous) await unloadOneForExperimentGate(previous);
          throw error;
        }
        const detail = error instanceof Error ? error.message : String(error);
        if (
          !setPluginStateSnapshotRollbackPending(deps.db, snapshot.id, {
            candidateVersion,
            sourceFingerprint: sourceFingerprint(args.row),
            bbVersion: deps.appVersion,
            sdkVersion: PLUGIN_SDK_VERSION,
            detail,
            updatedAt: now(),
          })
        ) {
          throw new Error(
            `plugin rollback snapshot ${snapshot.id} could not be marked pending`,
          );
        }
        await recoverRollbackWithinLifecycle(snapshot.id);
        throw new PluginActivationRolledBackError(
          `activation of ${args.manifest.version} failed and was rolled back: ${detail}; run apply update again to retry explicitly`,
        );
      } finally {
        stabilizingPluginIds.delete(args.row.id);
      }
    });
    await syncCliSkill();
    notifyPluginsChanged();
  }

  async function runArtifactGc(): Promise<void> {
    await garbageCollectPluginArtifacts({
      db: deps.db,
      dataDir: deps.dataDir,
      now: now(),
      retentionMs: artifactRetentionMs,
      warn: (message) => logger.warn(message),
    });
  }

  async function applyNpmCandidate(args: {
    row: InstalledPluginRow;
    selectionIntent: NpmSourceIntentForResolution;
    sourceIntent: NpmSourceIntentForResolution;
    candidate: NpmResolvedCandidate;
  }): Promise<void> {
    const targetPrefix = npmArtifactCacheDir(
      deps.dataDir,
      args.selectionIntent.packageName,
      args.candidate.version,
    );
    const targetRoot = join(
      targetPrefix,
      "node_modules",
      ...args.selectionIntent.packageName.split("/"),
    );
    return withArtifactLock(targetPrefix, async () => {
      const existingArtifact = getPluginArtifactByResolution(deps.db, {
        sourceKind: "npm",
        pluginId: args.row.id,
        path: targetRoot,
        version: args.candidate.version,
        integrity: args.candidate.integrity,
      });
      if (
        (existingArtifact?.validationResult === "valid" ||
          existingArtifact?.validationResult === "pending") &&
        existingArtifact.contentHash !== null &&
        (await hashInstallDir(targetPrefix).catch(() => null)) ===
          existingArtifact.contentHash
      ) {
        if (existingArtifact.validationResult === "pending") {
          setPluginArtifactValidation(deps.db, existingArtifact.id, {
            contentHash: existingArtifact.contentHash,
            validationResult: "valid",
            validatedAt: Date.now(),
          });
        }
        const manifest = await readPluginManifest(targetRoot);
        await activateManagedUpdate({
          row: args.row,
          rootDir: targetRoot,
          manifest,
          source:
            args.sourceIntent.specKind === "default"
              ? `npm:${args.sourceIntent.packageName}`
              : `npm:${args.sourceIntent.packageName}@${args.sourceIntent.requestedSpec}`,
          sourceIntent: { kind: "npm", ...args.sourceIntent },
          exactResolution: {
            kind: "npm",
            version: args.candidate.version,
            integrity: args.candidate.integrity,
          },
          artifactId: existingArtifact.id,
        });
        return;
      }
      const stagingPrefix = `${targetPrefix}.staging`;
      await rm(stagingPrefix, { recursive: true, force: true });
      await mkdir(stagingPrefix, { recursive: true });
      try {
        deps.onArtifactMaterialize?.({ path: targetRoot });
        await runInstallCommand(
          "npm",
          [
            "install",
            "--prefix",
            stagingPrefix,
            "--ignore-scripts",
            "--omit=optional",
            "--no-audit",
            "--no-fund",
            "--registry",
            args.selectionIntent.registry,
            `${args.selectionIntent.packageName}@${args.candidate.version}`,
          ],
          {
            notFoundHint:
              '"npm" was not found on PATH — npm plugin updates require npm',
          },
        );
        const stagedRoot = join(
          stagingPrefix,
          "node_modules",
          ...args.selectionIntent.packageName.split("/"),
        );
        const manifest = await validateInstallDir({
          rootDir: stagedRoot,
          source: args.row.source,
          refuseEngineMismatch: true,
        });
        if (manifest.id !== args.row.id) {
          throw new Error(
            `update refused: candidate manifest id changed from "${args.row.id}" to "${manifest.id}"`,
          );
        }
        const installedIntegrity = await readNpmIntegrity(
          stagingPrefix,
          args.selectionIntent.packageName,
        );
        if (
          installedIntegrity !== null &&
          installedIntegrity !== args.candidate.integrity
        ) {
          throw new Error(
            `update refused: integrity for ${args.candidate.display} did not match registry metadata`,
          );
        }
        const contentHash = await hashInstallDir(stagingPrefix);
        const artifact =
          existingArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: args.row.id,
            sourceKind: "npm",
            npmResolvedVersion: args.candidate.version,
            gitResolvedCommit: null,
            path: targetRoot,
            integrity: args.candidate.integrity,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        await activateManagedUpdate({
          row: args.row,
          rootDir: targetRoot,
          manifest,
          source:
            args.sourceIntent.specKind === "default"
              ? `npm:${args.sourceIntent.packageName}`
              : `npm:${args.sourceIntent.packageName}@${args.sourceIntent.requestedSpec}`,
          sourceIntent: { kind: "npm", ...args.sourceIntent },
          exactResolution: {
            kind: "npm",
            version: args.candidate.version,
            integrity: args.candidate.integrity,
          },
          artifactId: artifact.id,
          beforePersist: async () => {
            await promoteImmutableDir({
              stagingDir: stagingPrefix,
              targetDir: targetPrefix,
              contentHash,
            });
            await deps.afterArtifactPromoted?.({
              pluginId: args.row.id,
              artifactId: artifact.id,
              path: targetRoot,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
      } catch (error) {
        await rm(stagingPrefix, { recursive: true, force: true });
        throw error;
      }
    });
  }

  function findBuiltinPlugin(
    name: string,
  ): BuiltinPluginRegistration | undefined {
    return builtinPlugins.find((plugin) => plugin.name === name);
  }

  async function installBuiltinSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "builtin" }>,
  ): Promise<PluginListEntry> {
    const builtin = findBuiltinPlugin(parsed.name);
    if (!builtin) {
      throw new Error(`unknown builtin plugin "${parsed.name}"`);
    }
    return registerInstalled({
      rootDir: builtin.rootDir,
      source: builtinPluginSource(parsed.name),
      provenance: { kind: "builtin" },
      sourceIntent: { kind: "builtin", name: parsed.name },
      exactResolution: { kind: "builtin" },
      refuseEngineMismatch: false,
      validated: false,
    });
  }

  async function reconcileBuiltins(): Promise<void> {
    for (const builtin of builtinPlugins) {
      const source = builtinPluginSource(builtin.name);
      let manifest: PluginManifest;
      try {
        manifest = await readPluginManifest(builtin.rootDir);
      } catch (error) {
        logger.warn(
          `builtin plugin ${builtin.name} is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      const existing = getInstalledPluginRegistration(deps.db, manifest.id);
      if (existing?.removedAt !== null && existing?.removedAt !== undefined) {
        continue;
      }
      if (
        existing !== undefined &&
        !rowMatchesInstallSource(
          existing,
          { kind: "builtin" },
          { kind: "builtin", name: builtin.name },
        )
      ) {
        logger.warn(
          `builtin plugin ${builtin.name} resolved to id "${manifest.id}", but that id is already installed from ${existing.source}; skipping builtin reconciliation`,
        );
        continue;
      }
      if (
        existing === undefined ||
        existing.version !== manifest.version ||
        existing.rootDir !== builtin.rootDir
      ) {
        upsertInstalledPlugin(deps.db, {
          id: manifest.id,
          source,
          provenance: { kind: "builtin" },
          sourceIntent: { kind: "builtin", name: builtin.name },
          exactResolution: { kind: "builtin" },
          updateState: emptyPluginUpdateState(),
          activeArtifactId: null,
          rootDir: builtin.rootDir,
          version: manifest.version,
          enabled: existing?.enabled ?? builtin.defaultEnabled,
        });
      }
    }
  }

  async function backfillNormalizedPluginRegistrations(): Promise<void> {
    for (const row of listUnnormalizedPluginRegistrations(deps.db)) {
      const parsed = parsePluginSource(row.source);
      let sourceIntent: PluginSourceIntent;
      let exactResolution: LegacyPluginExactResolution;
      let provenance: PluginProvenance = { kind: "direct" };
      if (parsed.kind === "path") {
        sourceIntent = { kind: "path", canonicalPath: resolve(parsed.path) };
        exactResolution = { kind: "path" };
      } else if (parsed.kind === "builtin") {
        provenance = { kind: "builtin" };
        sourceIntent = { kind: "builtin", name: parsed.name };
        exactResolution = { kind: "builtin" };
      } else if (parsed.kind === "npm") {
        sourceIntent = {
          kind: "npm",
          packageName: parsed.name,
          registry:
            process.env.npm_config_registry ?? "https://registry.npmjs.org",
          requestedSpec: parsed.spec,
          specKind: parsed.specKind,
        };
        exactResolution = {
          kind: "npm",
          version: parsed.specKind === "exact" ? parsed.spec : row.version,
          integrity: null,
        };
      } else {
        let refKind: GitRefKind = isCommitSha(parsed.ref) ? "commit" : "branch";
        try {
          const remote = await resolveGitRef({
            url: parsed.url,
            ref: parsed.ref,
          });
          if (remote.outcome === "resolved") refKind = remote.refKind;
        } catch {
          // Preserve startup for an offline legacy install. Non-SHA legacy
          // refs historically refreshed, so branch is the safe fallback.
        }
        sourceIntent = {
          kind: "git",
          url: parsed.url,
          subdirectory: null,
          requestedRef: parsed.ref,
          refKind,
        };
        let commit: string | null = isCommitSha(parsed.ref) ? parsed.ref : null;
        try {
          commit = await runInstallCommand("git", [
            "-C",
            row.rootDir,
            "rev-parse",
            "HEAD",
          ]);
        } catch {
          // A legacy registration may point at missing files. Preserve its
          // load behavior and retain the requested pin when it is a SHA.
        }
        exactResolution = { kind: "git", commit };
      }
      normalizeInstalledPluginRegistration(deps.db, {
        ...row,
        provenance,
        sourceIntent,
        exactResolution,
        updateState: emptyPluginUpdateState(),
        activeArtifactId: null,
      });
    }
  }

  /**
   * The live native-tool view: loaded plugins in id order, registration
   * order within a plugin, deduped first-wins (defensive — registration
   * already blocks cross-plugin collisions and reserved names).
   */
  function collectAgentTools(): Array<{
    pluginId: string;
    record: PluginAgentToolRecord;
  }> {
    const seen = new Set<string>(RESERVED_AGENT_TOOL_NAMES);
    const out: Array<{ pluginId: string; record: PluginAgentToolRecord }> = [];
    for (const [id, plugin] of exposedLoadedEntries().sort(([a], [b]) =>
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
    for (const [id, plugin] of exposedLoadedEntries()) {
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

  /**
   * Rewrite (or remove) the generated plugin-commands skill after any
   * load/dispose transition, so agent threads always see current commands.
   * Best effort — a filesystem problem must not fail the transition.
   */
  async function syncCliSkill(): Promise<void> {
    try {
      await syncPluginCommandsSkill(deps.dataDir, cliContributions());
    } catch (error) {
      logger.warn(
        `failed to sync the plugin-commands skill: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Broadcast that the set of running plugins (and therefore host-rendered
   * contributions) changed, so open app pages re-fetch instead of waiting
   * out their query stale time. Fired on install/remove/enable/disable/
   * reload/experiment-toggle completion.
   */
  function notifyPluginsChanged(): void {
    deps.hub.notifySystem(["plugins-changed"]);
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
      (row.sourceKind === "git" && row.sourceGitRefKind === "branch")
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
    return `git · ${row.sourceGitUrl ?? row.source} · ${updateTrackingForRow(row)}`;
  }

  function updateStateForRow(
    row: InstalledPluginRow,
  ): PluginListEntry["updateState"] {
    let persisted: PluginUpdateCheckEntry | undefined;
    if (row.updateStatusDetail !== null) {
      try {
        const parsed = pluginUpdateCheckEntrySchema.safeParse(
          JSON.parse(row.updateStatusDetail),
        );
        if (parsed.success && parsed.data.id === row.id)
          persisted = parsed.data;
      } catch {
        // The list remains usable if one persisted status is corrupt; the
        // dedicated updates route retains its strict corruption diagnostic.
      }
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

  function list(): PluginListEntry[] {
    const scheduleRows = listPluginSchedules(deps.db);
    return listInstalledPlugins(deps.db)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const runtime = statuses.get(row.id);
        const stats = handlerStats.get(row.id);
        const loadedPlugin = loaded.get(row.id);
        const exposedPlugin =
          loadedPlugin !== undefined && shouldExposeLoadedPlugin(loadedPlugin)
            ? loadedPlugin
            : undefined;
        const cliRegistration = exposedPlugin?.handle.cli.registration;
        return {
          id: row.id,
          source: row.source,
          rootDir: row.rootDir,
          version: row.version,
          provenance: row.provenance,
          ...(row.marketplaceId === null
            ? {}
            : {
                marketplaceName:
                  getMarketplace(deps.db, row.marketplaceId)?.displayName ??
                  row.marketplaceId,
              }),
          sourceDisplay: sourceDisplayForRow(row),
          updateState: updateStateForRow(row),
          enabled: row.enabled,
          description: exposedPlugin?.manifest.description ?? null,
          displayName: exposedPlugin?.manifest.displayName ?? null,
          icon: exposedPlugin?.manifest.icon ?? null,
          status: runtime?.status ?? (row.enabled ? "error" : "disabled"),
          // A running plugin's detail is legitimately null — only fall back
          // to "not loaded" when there is no runtime status at all.
          statusDetail: runtime
            ? runtime.detail
            : row.enabled
              ? "not loaded"
              : null,
          handlerStats: stats
            ? { ...stats }
            : { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
          services: (exposedPlugin?.services ?? []).map((service) => ({
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
          hasSettings:
            exposedPlugin !== undefined &&
            Object.keys(exposedPlugin.handle.settings.descriptors).length > 0,
          app: appBundles.get(row.id)?.state ?? { hasApp: false, bundle: null },
          // Only advertise URLs the asset route will actually serve (it
          // gates on the live runtime, like the bundle assets).
          logoUrl:
            exposedPlugin !== undefined
              ? (logos.get(row.id)?.logo?.url ?? null)
              : null,
          logoDarkUrl:
            exposedPlugin !== undefined
              ? (logos.get(row.id)?.logoDark?.url ?? null)
              : null,
        };
      });
  }

  return {
    isEnabled: () => deps.isEnabled(),
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
      for (const [pluginId, plugin] of loaded) {
        const theme = plugin.manifest.themes.find(
          (entry) => formatPluginThemeId(pluginId, entry.id) === themeId,
        );
        if (!theme) continue;
        try {
          const css = await readFile(theme.cssPath, "utf8");
          return css.length <= CUSTOM_THEME_CSS_MAX_LENGTH ? css : null;
        } catch {
          return null;
        }
      }
      return null;
    },

    events: {
      emitThreadCreated(thread) {
        emitThreadEvent("thread.created", () => ({
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
      emitThreadDeleted(thread) {
        emitThreadEvent("thread.deleted", () => ({
          thread: buildThreadDto(thread),
        }));
      },
    },

    bindSdk({ baseUrl }) {
      boundSdk = createNodeBbSdk({ baseUrl });
      boundLoopbackBaseUrl = baseUrl;
    },

    async start() {
      await backfillNormalizedPluginRegistrations();
      await withPluginOperationLock(
        REGISTRATION_MUTATION_KEY,
        recoverIncompletePluginRollbacks,
      );
      await reconcileBuiltins();
      await loadAll();
      await withPluginOperationLock(REGISTRATION_MUTATION_KEY, runArtifactGc);
      if (deps.watchBuiltinPluginSources) {
        for (const builtin of builtinPlugins) {
          const row = listInstalledPlugins(deps.db).find(
            (candidate) =>
              candidate.sourceKind === "builtin" &&
              candidate.sourceBuiltinName === builtin.name,
          );
          if (row === undefined) continue;
          const manifest = await readPluginManifest(builtin.rootDir);
          const loop = createPluginDevLoop({
            pluginId: row.id,
            hasApp: manifest.appEntry !== undefined,
            buildApp: async () => {
              await buildPluginApp(builtin.rootDir, deps.appVersion);
            },
            reloadPlugin: async () => {
              await withLifecycleLock(row.id, async () => {
                const current = getInstalledPlugin(deps.db, row.id);
                if (current === undefined || !shouldLoadRow(current)) return;
                await disposeOne(row.id);
                await loadOne(current);
              });
              await syncCliSkill();
              notifyPluginsChanged();
            },
            log: (message) => logger.info(`plugin ${row.id}: ${message}`),
          });
          const watcher = watch(
            builtin.rootDir,
            { recursive: true },
            (_event, filename) => {
              if (typeof filename === "string" && filename.length > 0) {
                loop.handleChange(filename);
              }
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

    async onExperimentsChanged() {
      await loadAll();
      await syncCliSkill();
      notifyPluginsChanged();
    },

    list,

    async install(source) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const parsed = parsePluginSource(source);
        if (parsed.kind === "builtin") return installBuiltinSource(parsed);
        if (parsed.kind === "git") return installGitSource(parsed, source);
        if (parsed.kind === "npm") {
          refuseBuiltinShadow(derivePluginId(parsed.name));
          return installNpmSource(parsed, source);
        }
        return installPathSource(parsed.path);
      });
    },

    async installFromMarketplace(args) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const parsed = parsePluginSource(args.source);
        const context: InstallContext = {
          provenance: {
            kind: "marketplace",
            marketplaceId: args.marketplaceId,
            entryId: args.entryId,
          },
          ...(args.installation === undefined
            ? {}
            : { installation: args.installation }),
          ...(args.gitSubdirectory === undefined
            ? {}
            : { gitSubdirectory: args.gitSubdirectory }),
          ...(args.npmRegistry === undefined
            ? {}
            : { npmRegistry: args.npmRegistry }),
        };
        if (parsed.kind === "builtin") {
          throw new Error(
            "marketplace entries may not install builtin sources",
          );
        }
        if (parsed.kind === "git")
          return installGitSource(parsed, args.source, context);
        if (parsed.kind === "npm") {
          refuseBuiltinShadow(derivePluginId(parsed.name));
          return installNpmSource(parsed, args.source, context);
        }
        return installPathSource(parsed.path, context);
      });
    },

    installPath: (path) =>
      withPluginOperationLock(REGISTRATION_MUTATION_KEY, () =>
        installPathSource(path),
      ),

    async checkForUpdates(id) {
      const rows =
        id === undefined
          ? listInstalledPlugins(deps.db)
          : (() => {
              const row = getInstalledPlugin(deps.db, id);
              if (!row) throw new Error(`unknown plugin "${id}"`);
              return [row];
            })();
      const npmRun = createNpmResolverRun();
      const results = await Promise.all(
        rows
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((row) =>
            withLifecycleLock(row.id, async () => {
              const current = getInstalledPlugin(deps.db, row.id);
              if (!current) {
                throw new Error(
                  `plugin "${row.id}" disappeared during update check`,
                );
              }
              const installed = installedUpdateVersion(current);
              const resolution = await resolveUpdateForRow({
                row: current,
                npmRun,
              });
              const checked = checkEntryFromResolution(
                current.id,
                installed,
                resolution,
              );
              persistUpdateEntry(checked);
              return checked;
            }),
          ),
      );
      notifyPluginsChanged();
      return results;
    },

    listUpdateResults() {
      return listInstalledPlugins(deps.db)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((row) => {
          if (
            row.lastUpdateCheckAt === null ||
            row.updateStatusDetail === null
          ) {
            return {
              id: row.id,
              outcome: "unavailable" as const,
              installed: installedUpdateVersion(row),
              detail: "updates have not been checked yet",
            };
          }
          let json: unknown;
          try {
            json = JSON.parse(row.updateStatusDetail);
          } catch {
            throw new Error(
              `plugin "${row.id}" has corrupt persisted update state`,
            );
          }
          const parsed = pluginUpdateCheckEntrySchema.safeParse(json);
          if (!parsed.success || parsed.data.id !== row.id) {
            throw new Error(
              `plugin "${row.id}" has corrupt persisted update state`,
            );
          }
          return parsed.data;
        });
    },

    async getSource(id) {
      const row = getInstalledPlugin(deps.db, id);
      if (row === undefined) return undefined;
      const manifest = await readPluginManifest(row.rootDir).catch(() => null);
      const artifacts = listRecentPluginArtifacts(deps.db, id, 10);
      return {
        requested: row.source,
        resolved: installedUpdateVersion(row).display,
        ...(row.npmIntegrity === null ? {} : { integrity: row.npmIntegrity }),
        ...(row.sourceNpmRegistry === null
          ? {}
          : { registry: row.sourceNpmRegistry }),
        engines: {
          ...(manifest?.bbEngineRange === undefined
            ? {}
            : { bb: manifest.bbEngineRange }),
          ...(manifest?.bbPluginSdkRange === undefined
            ? {}
            : { bbPluginSdk: manifest.bbPluginSdkRange }),
        },
        installedAt: row.installedAt,
        history: artifacts.map((artifact) => ({
          version:
            artifact.sourceKind === "npm"
              ? (artifact.npmResolvedVersion ?? "unknown")
              : (artifact.gitResolvedCommit ?? "unknown"),
          activatedAt: artifact.validatedAt ?? artifact.updatedAt,
        })),
      };
    },

    async applyUpdate(id) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) return { ok: false, error: `unknown plugin "${id}"` };
        const from = installedUpdateVersion(row);
        const npmRun = createNpmResolverRun();
        const selectionNpmIntent =
          row.sourceKind === "npm" ? npmIntentForRow(row) : undefined;
        const resolution = await resolveUpdateForRow({
          row,
          npmRun,
        });
        const checked = checkEntryFromResolution(id, from, resolution);
        persistUpdateEntry(checked);

        if (resolution.outcome === "pinned") {
          return {
            ok: false,
            error: `plugin "${id}" is pinned by its source intent; remove and reinstall it with an npm range or git branch to track updates`,
          };
        }
        if (resolution.outcome === "incompatible") {
          return {
            ok: false,
            error: `${resolution.newest.display} is incompatible: ${problemMessages(resolution.reasons).join("; ")}`,
          };
        }
        if (resolution.outcome === "unavailable") {
          return { ok: false, error: resolution.detail };
        }
        const to =
          resolution.outcome === "update-available"
            ? resolution.candidate
            : from;
        if (resolution.outcome === "current") {
          return {
            ok: true,
            result: {
              applied: false,
              from,
              outcome: "current",
            },
          };
        }

        try {
          if (row.sourceKind === "npm" && selectionNpmIntent !== undefined) {
            const selected = await selectNpmCandidate({
              intent: selectionNpmIntent,
              appVersion: deps.appVersion,
              run: npmRun,
            });
            if (selected.outcome !== "selected") {
              throw new Error(
                `npm candidate changed during update: ${selected.outcome}`,
              );
            }
            if (selected.candidate.version !== to.version) {
              throw new Error(
                `npm candidate changed during update: resolved ${to.version}, selected ${selected.candidate.version}`,
              );
            }
            const activationRow = getInstalledPlugin(deps.db, id);
            if (activationRow === undefined) {
              throw new Error(`plugin "${id}" disappeared before activation`);
            }
            await applyNpmCandidate({
              row: activationRow,
              selectionIntent: selectionNpmIntent,
              sourceIntent: selectionNpmIntent,
              candidate: selected.candidate,
            });
          } else if (
            row.sourceKind === "git" &&
            resolution.outcome === "update-available"
          ) {
            const persistedRefKind =
              row.sourceGitRefKind ??
              getInstalledPlugin(deps.db, id)?.sourceGitRefKind ??
              null;
            if (
              row.sourceGitUrl === null ||
              row.sourceGitRequestedRef === null ||
              persistedRefKind === null
            ) {
              throw new Error(
                `plugin "${id}" has corrupt normalized git state`,
              );
            }
            const activationRow = getInstalledPlugin(deps.db, id);
            if (activationRow === undefined) {
              throw new Error(`plugin "${id}" disappeared before activation`);
            }
            const staged = await stageGitCandidate({
              row: activationRow,
              commit: resolution.candidate.version,
              promote: true,
              activationRefKind: persistedRefKind,
            });
            if (staged.outcome !== "valid") {
              const detail =
                staged.outcome === "invalid"
                  ? staged.detail
                  : problemMessages(staged.reasons).join("; ");
              return { ok: false, error: `update refused: ${detail}` };
            }
          }
        } catch (error) {
          if (error instanceof PluginActivationRolledBackError) {
            return {
              ok: true,
              result: {
                applied: false,
                from,
                to,
                outcome: "rolled-back",
                detail: error.message,
              },
            };
          }
          throw error;
        }
        await runArtifactGc();
        const updatedRow = getInstalledPlugin(deps.db, id);
        if (!updatedRow) {
          throw new Error(`plugin "${id}" disappeared after update`);
        }
        const updatedVersion = installedUpdateVersion(updatedRow);
        persistUpdateEntry(
          checkEntryFromResolution(id, updatedVersion, {
            outcome: "current",
            current: updatedVersion,
            ...(semver.coerce(deps.appVersion)?.version === "0.0.0"
              ? { devMode: true }
              : {}),
          }),
        );
        return {
          ok: true,
          result: {
            applied: true,
            from,
            to,
            outcome: "updated",
          },
        };
      });
    },

    async remove(id) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const row = getInstalledPlugin(deps.db, id);
        await withLifecycleLock(id, () => disposeOne(id));
        statuses.delete(id);
        handlerStats.delete(id);
        agentToolProblems.delete(id);
        appBundles.delete(id);
        logos.delete(id);
        const removed = row
          ? row.sourceKind === "builtin"
            ? markInstalledPluginRemoved(deps.db, id)
            : deleteInstalledPlugin(deps.db, id)
          : false;
        if (removed && row) {
          // Configuration goes with the registration (a future same-id plugin
          // must not inherit secrets); kv rows and data.db are plugin data and
          // survive a remove/reinstall cycle. Schedule rows belong to the
          // registration too.
          deletePluginSchedules(deps.db, id);
          deleteAllPluginSettings(deps.db, id);
          await rm(pluginSecretsDir(deps.dataDir, id), {
            recursive: true,
            force: true,
          });
          // Legacy managed installs still own their mutable pre-cache layout.
          // Immutable artifact directories are retained for future GC policy;
          // path: sources are the user's directory and are never deleted.
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
          if (row && shouldLoadRow(row)) {
            await withLifecycleLock(id, () => loadOne(row));
          } else if (row) {
            await withLifecycleLock(id, () => unloadOneForExperimentGate(row));
          }
        } else {
          await withLifecycleLock(id, async () => {
            await disposeOne(id);
            // A hung service outranks "disabled": the degraded status (set by
            // stopServices) is the only trace of the still-running start().
            if ((hungServices.get(id)?.size ?? 0) === 0) {
              setStatus(id, "disabled");
            }
          });
        }
        await syncCliSkill();
        notifyPluginsChanged();
        return list().find((p) => p.id === id);
      });
    },

    async reload(id) {
      const rows = listInstalledPlugins(deps.db).filter(
        (row) => (id === undefined || row.id === id) && shouldLoadRow(row),
      );
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        await withLifecycleLock(row.id, async () => {
          await disposeOne(row.id);
          await loadOne(row);
        });
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    getApi(id) {
      if (!shouldExposePluginId(id)) return undefined;
      return loaded.get(id)?.handle.api;
    },

    getAppAsset(id, kind) {
      // Honest gate: assets are only downloadable while the plugin runtime
      // is live. A disabled/errored/removed plugin's recorded snapshot may
      // still ride the inventory for display, but its bytes are not served.
      if (!shouldExposePluginId(id)) return undefined;
      if (!loaded.has(id)) return undefined;
      const assets = appBundles.get(id)?.assets;
      if (!assets) return undefined;
      const path = kind === "js" ? assets.jsPath : assets.cssPath;
      if (path === null) return undefined;
      return { path, hash: assets.hash };
    },

    getLogoAsset(id, variant) {
      // Same honest gate as getAppAsset: bytes only while the runtime is
      // live (matches the inventory's logoUrl/logoDarkUrl gating).
      if (!shouldExposePluginId(id)) return undefined;
      if (!loaded.has(id)) return undefined;
      const set = logos.get(id);
      const logo = variant === "logo-dark" ? set?.logoDark : set?.logo;
      if (!logo) return undefined;
      return {
        path: logo.path,
        contentType: logo.contentType,
        hash: logo.hash,
      };
    },

    async getSettings(id) {
      if (!shouldExposePluginId(id)) return undefined;
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
      if (!shouldExposePluginId(id)) return undefined;
      const plugin = loaded.get(id);
      if (!plugin) return undefined;
      const storeArgs = {
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        descriptors: plugin.handle.settings.descriptors,
      };
      const errors = validatePluginSettingsUpdate(
        storeArgs.descriptors,
        values,
      );
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
        // Effective values changed: broadcast so every open page's settings
        // queries (plugin-sdk useSettings included) refetch instead of
        // serving the pre-save snapshot until stale time.
        notifyPluginsChanged();
        // A plugin stuck on needs-configuration is waiting for exactly this
        // save — reload it so the new values take effect without a manual
        // `bb plugin reload` (the NeedsConfigurationError contract documents
        // this). Healthy plugins are NOT reloaded: they read settings lazily
        // via settings.get(), and restarting live services on every toggle
        // would be disruptive.
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

    getRpcHandler(id, method) {
      return wireLookup(id, (plugin) => plugin.handle.rpcHandlers.get(method));
    },

    async invokeHttpRoute(id, route, context) {
      const outcome = await invokeWrapped(
        id,
        `http ${route.method} ${route.path}`,
        async () => {
          const response = await route.handler(context);
          if (!(response instanceof Response)) {
            throw new Error("http route handler must return a Response");
          }
          return response;
        },
      );
      if (outcome.ok) return outcome.value;
      return context.json(
        { ok: false, error: `plugin route failed: ${outcome.error}` },
        500,
      );
    },

    async invokeRpcHandler(id, method, handler, input) {
      const outcome = await invokeWrapped(id, `rpc ${method}`, async () => {
        const result = await handler(input);
        // JSON round-trip: the rpc contract is JSON-serializable outputs
        // only, and a bigint/circular result should be this handler's clear
        // 500, not a serializer crash in the response path.
        const json = JSON.stringify(result);
        return json === undefined ? undefined : (JSON.parse(json) as unknown);
      });
      if (outcome.ok) return { ok: true, result: outcome.value };
      return { ok: false, error: outcome.error };
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
      const fail = (stderr: string) => ({ exitCode: 1, stdout: "", stderr });
      const plugin = loaded.get(id);
      if (!shouldExposePluginId(id)) {
        return fail(
          'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
        );
      }
      if (!plugin) {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) return fail(`unknown plugin "${id}"`);
        const runtime = statuses.get(id);
        const status = runtime?.status ?? (row.enabled ? "error" : "disabled");
        const detail = runtime?.detail ?? (row.enabled ? "not loaded" : null);
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
          return {
            exitCode: result.exitCode,
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
          };
        },
      );
      if (outcome.ok) return outcome.value;
      return fail(`bb ${registration.name} failed: ${outcome.error}`);
    },

    listSkillsRootPaths() {
      return exposedLoadedEntries()
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, plugin]) => plugin.manifest.skillsRootPaths);
    },

    listAgentTools() {
      return collectAgentTools().map(({ pluginId, record }) => ({
        pluginId,
        tool: {
          name: record.name,
          description: record.description,
          inputSchema: record.inputSchema,
        },
        instructions: record.instructions,
      }));
    },

    listInstructionContributions() {
      const out: PluginInstructionContribution[] = [];
      for (const [id, plugin] of exposedLoadedEntries().sort(([a], [b]) =>
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
      // Bad arguments are the model's problem, not the plugin's: respond
      // with an isError result without running (or blaming) plugin code.
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

    listThreadActionContributions() {
      const contributions: PluginThreadActionContribution[] = [];
      for (const [id, plugin] of exposedLoadedEntries().sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.threadActions) {
          contributions.push({
            pluginId: id,
            id: record.id,
            title: record.title,
            icon: record.icon,
            confirm: record.confirm,
          });
        }
      }
      return contributions;
    },

    getThreadAction(id, actionId) {
      if (!shouldExposePluginId(id)) return { outcome: "unknown-plugin" };
      return wireLookup(id, (plugin) =>
        plugin.handle.threadActions.find((record) => record.id === actionId),
      );
    },

    async runThreadAction(id, record, threadId) {
      const thread = getThread(deps.db, threadId);
      if (!thread) return { outcome: "unknown-thread" };
      const outcome = await invokeWrapped(
        id,
        `thread action ${record.id}`,
        async () => {
          const result = await record.run({
            threadId: thread.id,
            projectId: thread.projectId,
          });
          return normalizeThreadActionResult(record.id, result);
        },
      );
      if (outcome.ok) return { outcome: "ok", toast: outcome.value };
      return { outcome: "error", error: outcome.error };
    },

    listMentionProviderContributions() {
      const contributions: PluginMentionProviderContribution[] = [];
      for (const [id, plugin] of exposedLoadedEntries().sort(([a], [b]) =>
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
      const entries = exposedLoadedEntries().sort(([a], [b]) =>
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
                  // The race abandons a timed-out search; keep its eventual
                  // rejection observed so it cannot surface as an unhandled
                  // rejection later.
                  searchPromise.catch(() => {});
                  let timer: NodeJS.Timeout | undefined;
                  try {
                    const result = await Promise.race([
                      searchPromise,
                      new Promise<never>((_, reject) => {
                        timer = setTimeout(
                          () =>
                            reject(
                              new Error(
                                `timed out after ${mentionSearchTimeoutMs}ms`,
                              ),
                            ),
                          mentionSearchTimeoutMs,
                        );
                        timer.unref?.();
                      }),
                    ]);
                    return normalizeMentionSearchItems(record.id, result);
                  } finally {
                    if (timer !== undefined) clearTimeout(timer);
                  }
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
      if (!shouldExposePluginId(pluginId)) {
        return {
          ok: false,
          error:
            'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
        };
      }
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
          // The race abandons a timed-out resolve; keep its eventual
          // rejection observed so it cannot surface as an unhandled
          // rejection later.
          resolvePromise.catch(() => {});
          let timer: NodeJS.Timeout | undefined;
          let result: unknown;
          try {
            result = await Promise.race([
              resolvePromise,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(`timed out after ${mentionResolveTimeoutMs}ms`),
                    ),
                  mentionResolveTimeoutMs,
                );
                timer.unref?.();
              }),
            ]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
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
        // Rows are claimed only while their plugin is running; an unloaded
        // plugin's row waits untouched for the next load.
        const schedule = loaded
          .get(row.pluginId)
          ?.handle.schedules.find((record) => record.name === row.name);
        if (!schedule) continue;
        let newNextRunAt: number;
        try {
          // The live registration's cron, not the row's — the row may lag a
          // just-reloaded plugin by one sweep.
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
