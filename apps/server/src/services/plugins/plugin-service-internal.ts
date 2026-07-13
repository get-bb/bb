import type { DbConnection } from "@bb/db";
import type { DynamicTool, Thread } from "@bb/domain";
import { z } from "zod";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import type { BuiltinPluginRegistration } from "./builtin-registry.js";
import type { PluginManifest } from "./manifest.js";
import type {
  PluginApiHandle,
  PluginBackgroundServiceRecord,
  PluginMentionTrigger,
  PluginThreadActionToast,
} from "./plugin-api.js";
import type { PluginAppState } from "./app-bundle.js";
import type { PluginResolvedUpdateVersion } from "./update-resolver.js";

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
export interface ServiceRuntime {
  record: PluginBackgroundServiceRecord;
  state: PluginServiceState;
  controller: AbortController | null;
  current: Promise<void> | null;
  restartTimer: NodeJS.Timeout | null;
  consecutiveCrashes: number;
  startedAt: number;
  disposed: boolean;
}

export interface LoadedPlugin {
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

export const pluginUpdateCheckEntrySchema = z.object({
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
