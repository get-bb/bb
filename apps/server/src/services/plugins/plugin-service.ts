import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { CronExpressionParser } from "cron-parser";
import type { Context } from "hono";
import { createJiti } from "jiti";
import semver from "semver";
import type { DbConnection } from "@bb/db";
import {
  promptInputSchema,
  type DynamicTool,
  type PromptInput,
  type Thread,
  type ToolCallResponse,
} from "@bb/domain";
import { z } from "zod";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk";
import { deleteSecretFile, readOrCreateSecretFile } from "@bb/secret-storage";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import {
  claimPluginScheduledRun,
  deleteAllPluginSettings,
  deleteInstalledPlugin,
  deletePluginSchedules,
  getInstalledPlugin,
  getThread,
  listDuePluginSchedules,
  listInstalledPlugins,
  listPluginSchedules,
  prunePluginSchedules,
  recordPluginScheduleResult,
  setInstalledPluginEnabled,
  upsertInstalledPlugin,
  upsertPluginSchedule,
  type InstalledPluginRow,
} from "@bb/db";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";
import { toThreadResponseFromThread } from "../threads/thread-runtime-display.js";
import {
  isCommitSha,
  managedInstallDir,
  npmInstallPrefix,
  parsePluginSource,
  runInstallCommand,
} from "./install-sources.js";
import { readPluginManifest, type PluginManifest } from "./manifest.js";
import {
  createPluginApi,
  isNeedsConfigurationError,
  RESERVED_AGENT_TOOL_NAMES,
  type BbPluginApi,
  type PluginAgentToolContext,
  type PluginAgentToolRecord,
  type PluginAgentTurnContext,
  type PluginApiHandle,
  type PluginBackgroundServiceRecord,
  type PluginCliContext,
  type PluginHttpRouteRecord,
  type PluginRpcHandler,
  type PluginSlashCommandContext,
  type PluginSlashCommandRecord,
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
  enabled: boolean;
  status: PluginRuntimeStatus;
  statusDetail: string | null;
  handlerStats: PluginHandlerStats;
  /** Background services of the loaded plugin; empty when not loaded. */
  services: PluginServiceEntry[];
  /** Durable schedule rows (survive dispose; deleted with the plugin). */
  schedules: PluginScheduleEntry[];
  /** The plugin's registered `bb` subcommand; null when none or not loaded. */
  cliCommand: { name: string; summary: string } | null;
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
  /** BB data dir: plugin sqlite files and secrets live under <dataDir>/plugins/<id>/. */
  dataDir: string;
  /** BB app version, checked against manifests' engines.bb range. */
  appVersion: string;
  /** The `plugins` experiment gate, read live. */
  isEnabled: () => boolean;
  /** Factory-execution time box; overridable in tests. */
  loadTimeoutMs?: number;
  /** Bound on awaiting a service's start() promise at dispose; tests shrink it. */
  serviceStopTimeoutMs?: number;
  /** First restart delay after a service crash (doubles, capped at 60s). */
  serviceRestartBaseMs?: number;
  /** Time box per bb.agents.addContext provider call; tests shrink it. */
  contextProviderTimeoutMs?: number;
  /** Time box per mention provider search call; tests shrink it. */
  mentionSearchTimeoutMs?: number;
  /** Time box per mention provider resolve call at send; tests shrink it. */
  mentionResolveTimeoutMs?: number;
}

/** One labeled instruction section produced by a bb.agents context provider. */
export interface PluginAgentContextSection {
  pluginId: string;
  text: string;
}

/** One native tool contributed by a running plugin (design §4.4). */
export interface PluginAgentToolContribution {
  pluginId: string;
  tool: DynamicTool;
  /** Optional usage snippet for the thread-instructions assembly. */
  instructions: string | null;
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

/** One slash command contributed by a running plugin (design §4.9). */
export interface PluginSlashCommandContribution {
  pluginId: string;
  name: string;
  description: string;
}

/**
 * Normalized action envelope for a slash command's return value, returned by
 * POST /plugins/:id/slash/:name so the app can branch on `action`.
 */
export type PluginSlashCommandAction =
  | { action: "none" }
  | { action: "insertText"; insertText: string }
  | { action: "send"; send: PromptInput[] };

/** One mention provider contributed by a running plugin (design §4.9). */
export interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
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

/** Result of running a slash command (POST /plugins/:id/slash/:name). */
export type PluginSlashCommandRunResult =
  | { outcome: "ok"; value: PluginSlashCommandAction }
  | { outcome: "error"; error: string };

/**
 * Narrow emitter the thread lifecycle seams call (design §4.5). Emission is
 * a no-op unless a loaded plugin registered a handler for the event; payload
 * assembly and handler dispatch happen async off the lifecycle path.
 */
export interface PluginThreadEventEmitter {
  emitThreadCreated(thread: Thread): void;
  emitThreadIdle(thread: Thread): void;
  emitThreadFailed(thread: Thread): void;
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

export interface PluginService {
  /** Whether the `plugins` experiment is currently on. */
  isEnabled(): boolean;
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
  /** React to the `plugins` experiment being toggled at runtime. */
  onExperimentChanged(enabled: boolean): Promise<void>;
  list(): PluginListEntry[];
  /**
   * Install from a source spec: `path:<dir>` (bare paths accepted),
   * `git:<url-ish>@<ref>` (ref required; cloned into the managed dir under
   * <dataDir>/plugins/git), or `npm:<name>@<exact-version>` (installed with
   * npm --ignore-scripts under <dataDir>/plugins/npm). git/npm installs
   * hard-fail on an engines.bb mismatch (design §6); re-installing the same
   * spec refreshes the managed files.
   */
  install(source: string): Promise<PluginListEntry>;
  installPath(path: string): Promise<PluginListEntry>;
  remove(id: string): Promise<boolean>;
  setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<PluginListEntry | undefined>;
  reload(id?: string): Promise<void>;
  /** Live API handle for a running plugin (used by later phases and tests). */
  getApi(id: string): BbPluginApi | undefined;
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
   * Run every loaded plugin's bb.agents.addContext providers for one turn
   * (design §4.4). Providers run concurrently, each wrapped in the
   * failure-isolation discipline (invokeWrapped) and time-boxed; a slow,
   * throwing, or non-string-returning provider is skipped and logged so a
   * plugin can never stall turn submission. Null/empty results are
   * dropped. Sections are ordered by plugin id, then registration order.
   */
  collectAgentContextSections(
    ctx: PluginAgentTurnContext,
  ): Promise<PluginAgentContextSection[]>;
  /**
   * Native tools of running plugins (bb.agents.registerTool), ordered by
   * plugin id then registration order, deduped defensively (first wins —
   * registration already blocks collisions). Appended to a session's
   * dynamicTools at thread.start/turn.submit time; changes apply on the
   * NEXT session start. Empty when the experiment is off.
   */
  listAgentTools(): PluginAgentToolContribution[];
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
   * Slash commands of running plugins (bb.ui.registerSlashCommand), ordered
   * by plugin id then registration order, for GET /plugins/contributions.
   * No plugin code runs; empty when the experiment is off.
   */
  listSlashCommandContributions(): PluginSlashCommandContribution[];
  /** Live slash-command lookup for POST /plugins/:id/slash/:name. */
  getSlashCommand(
    id: string,
    name: string,
  ): PluginWireLookup<PluginSlashCommandRecord>;
  /**
   * Run a slash command (design §4.9) through invokeWrapped and normalize
   * the returned action (void | { insertText } | { send }). A throwing or
   * malformed-result handler maps to the "error" outcome — the app shows it
   * as an error toast on the composer.
   */
  runSlashCommand(
    id: string,
    record: PluginSlashCommandRecord,
    ctx: PluginSlashCommandContext,
  ): Promise<PluginSlashCommandRunResult>;
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
const DEFAULT_CONTEXT_PROVIDER_TIMEOUT_MS = 2_000;
const DEFAULT_MENTION_SEARCH_TIMEOUT_MS = 2_000;
// Resolve is looser than search: it blocks a send the user already committed
// to, so it may do one real fetch — but it must not hang POST /threads/:id/send
// forever when a provider never settles.
const DEFAULT_MENTION_RESOLVE_TIMEOUT_MS = 10_000;
const SERVICE_RESTART_MAX_MS = 60_000;
/** A crash after this much healthy runtime resets the backoff sequence. */
const SERVICE_HEALTHY_RESET_MS = 5 * 60_000;
const SCHEDULE_SWEEP_BATCH_SIZE = 100;

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

const slashCommandSendSchema = z.array(promptInputSchema).min(1);

/**
 * Normalize a slash command's return value (void | { insertText } |
 * { send }) into the wire action envelope. Malformed results throw — the
 * caller runs this inside invokeWrapped so they count as handler errors,
 * not broken wire responses.
 */
function normalizeSlashCommandResult(
  name: string,
  result: unknown,
): PluginSlashCommandAction {
  if (result === undefined || result === null) return { action: "none" };
  if (typeof result !== "object") {
    throw new Error(
      `slash command "${name}" run() must return void, { insertText }, or { send }`,
    );
  }
  const { insertText, send } = result as {
    insertText?: unknown;
    send?: unknown;
  };
  if (insertText !== undefined && send !== undefined) {
    throw new Error(
      `slash command "${name}" run() returned both insertText and send — return one`,
    );
  }
  if (insertText !== undefined) {
    if (typeof insertText !== "string" || insertText.length === 0) {
      throw new Error(
        `slash command "${name}" insertText must be a non-empty string`,
      );
    }
    return { action: "insertText", insertText };
  }
  if (send !== undefined) {
    const parsed = slashCommandSendSchema.safeParse(send);
    if (!parsed.success) {
      throw new Error(
        `slash command "${name}" send must be a non-empty PromptInput array: ${z.prettifyError(parsed.error)}`,
      );
    }
    return { action: "send", send: parsed.data };
  }
  throw new Error(
    `slash command "${name}" run() must return void, { insertText }, or { send }`,
  );
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
  const loadTimeoutMs = deps.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const serviceStopTimeoutMs =
    deps.serviceStopTimeoutMs ?? DEFAULT_SERVICE_STOP_TIMEOUT_MS;
  const serviceRestartBaseMs =
    deps.serviceRestartBaseMs ?? DEFAULT_SERVICE_RESTART_BASE_MS;
  const contextProviderTimeoutMs =
    deps.contextProviderTimeoutMs ?? DEFAULT_CONTEXT_PROVIDER_TIMEOUT_MS;
  const mentionSearchTimeoutMs =
    deps.mentionSearchTimeoutMs ?? DEFAULT_MENTION_SEARCH_TIMEOUT_MS;
  const mentionResolveTimeoutMs =
    deps.mentionResolveTimeoutMs ?? DEFAULT_MENTION_RESOLVE_TIMEOUT_MS;

  const loaded = new Map<string, LoadedPlugin>();
  const statuses = new Map<
    string,
    { status: PluginRuntimeStatus; detail: string | null }
  >();
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

  function setStatus(
    id: string,
    status: PluginRuntimeStatus,
    detail: string | null = null,
  ): void {
    statuses.set(id, { status, detail });
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

  async function runFactoryTimeBoxed(
    factory: (api: BbPluginApi) => unknown,
    api: BbPluginApi,
    id: string,
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
    void id;
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
    const engineProblem = checkEngineRange(manifest);
    if (engineProblem) {
      setStatus(row.id, "incompatible", engineProblem);
      return;
    }
    const handle = createPluginApi({
      pluginId: row.id,
      logger: deps.logger,
      db: deps.db,
      dataDir: deps.dataDir,
      getSdk: () => boundSdk,
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
    });
    // Fresh load: a plugin that was waiting on configuration gets to prove
    // itself again (its factory/services re-report if still unconfigured).
    needsConfiguration.delete(row.id);
    agentToolProblems.delete(row.id);
    try {
      // Fresh instance per load: guarantees re-imports see current sources.
      const jiti = createJiti(import.meta.url, { moduleCache: false });
      const mod = (await jiti.import(manifest.serverEntry)) as {
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
        row.id,
      );
    } catch (error) {
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
    // A dropped tool registration keeps the plugin running but rides along
    // as the status detail.
    if (!needsConfiguration.has(row.id)) {
      setStatus(row.id, "running", agentToolProblems.get(row.id) ?? null);
    }
    logger.info(`plugin ${row.id}@${manifest.version} loaded`);
  }

  async function disposeOne(id: string): Promise<void> {
    const plugin = loaded.get(id);
    if (!plugin) return;
    loaded.delete(id);
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
    plugin.handle.invalidate();
  }

  async function disposeAll(): Promise<void> {
    for (const id of [...loaded.keys()]) {
      await disposeOne(id);
    }
  }

  async function loadAll(): Promise<void> {
    const rows = listInstalledPlugins(deps.db).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      await loadOne(row);
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
   * Shared install tail: validate the materialized files, refuse engine
   * mismatches for managed sources (design §6 — install refuses, unlike
   * load which marks `incompatible`), upsert the row, and (re)load.
   */
  async function registerInstalled(args: {
    rootDir: string;
    source: string;
    refuseEngineMismatch: boolean;
  }): Promise<PluginListEntry> {
    const manifest = await readPluginManifest(args.rootDir);
    if (args.refuseEngineMismatch) {
      const engineProblem = checkEngineRange(manifest);
      if (engineProblem) {
        throw new Error(
          `install refused: plugin "${manifest.id}" ${engineProblem}`,
        );
      }
    }
    const existing = getInstalledPlugin(deps.db, manifest.id);
    if (existing && existing.source !== args.source) {
      throw new Error(
        `plugin id "${manifest.id}" is already installed from ${existing.source}; remove it first`,
      );
    }
    upsertInstalledPlugin(deps.db, {
      id: manifest.id,
      source: args.source,
      rootDir: args.rootDir,
      version: manifest.version,
      enabled: existing?.enabled ?? true,
    });
    if (deps.isEnabled()) {
      await disposeOne(manifest.id);
      const row = getInstalledPlugin(deps.db, manifest.id);
      if (row) await loadOne(row);
      await syncCliSkill();
      notifyPluginsChanged();
    }
    const entry = list().find((p) => p.id === manifest.id);
    if (!entry) throw new Error(`plugin ${manifest.id} missing after install`);
    return entry;
  }

  async function installPathSource(path: string): Promise<PluginListEntry> {
    const rootDir = resolve(path);
    return registerInstalled({
      rootDir,
      source: `path:${rootDir}`,
      refuseEngineMismatch: false,
    });
  }

  async function installGitSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "git" }>,
    source: string,
  ): Promise<PluginListEntry> {
    const targetDir = join(
      deps.dataDir,
      "plugins",
      "git",
      ...parsed.installDir.split("/"),
    );
    // Re-install of the same spec is a refresh: drop the old clone.
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(dirname(targetDir), { recursive: true });
    const notFoundHint =
      '"git" was not found on PATH — git: plugin installs require git';
    try {
      if (isCommitSha(parsed.ref)) {
        // A sha cannot be cloned with --branch; clone, then pin by checkout.
        await runInstallCommand(
          "git",
          ["clone", "--quiet", parsed.url, targetDir],
          { notFoundHint },
        );
        await runInstallCommand("git", [
          "-C",
          targetDir,
          "checkout",
          "--quiet",
          "--detach",
          parsed.ref,
        ]);
      } else {
        await runInstallCommand(
          "git",
          [
            "clone",
            "--quiet",
            "--depth",
            "1",
            "--branch",
            parsed.ref,
            parsed.url,
            targetDir,
          ],
          { notFoundHint },
        );
      }
      return await registerInstalled({
        rootDir: targetDir,
        source,
        refuseEngineMismatch: true,
      });
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true });
      throw error;
    }
  }

  async function installNpmSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "npm" }>,
    source: string,
  ): Promise<PluginListEntry> {
    const prefix = npmInstallPrefix(deps.dataDir, parsed.name, parsed.version);
    await rm(prefix, { recursive: true, force: true });
    await mkdir(prefix, { recursive: true });
    try {
      await runInstallCommand(
        "npm",
        [
          "install",
          "--prefix",
          prefix,
          "--ignore-scripts",
          "--omit=optional",
          "--no-audit",
          "--no-fund",
          `${parsed.name}@${parsed.version}`,
        ],
        {
          notFoundHint:
            '"npm" was not found on PATH — npm: plugin installs require npm',
        },
      );
      const rootDir = join(prefix, "node_modules", ...parsed.name.split("/"));
      return await registerInstalled({
        rootDir,
        source,
        refuseEngineMismatch: true,
      });
    } catch (error) {
      await rm(prefix, { recursive: true, force: true });
      throw error;
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
    if (!deps.isEnabled()) return [];
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
    if (!deps.isEnabled()) return [];
    const contributions: PluginCliContribution[] = [];
    for (const [id, plugin] of loaded) {
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

  function list(): PluginListEntry[] {
    const scheduleRows = listPluginSchedules(deps.db);
    return listInstalledPlugins(deps.db)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const runtime = statuses.get(row.id);
        const stats = handlerStats.get(row.id);
        const cliRegistration = loaded.get(row.id)?.handle.cli.registration;
        return {
          id: row.id,
          source: row.source,
          rootDir: row.rootDir,
          version: row.version,
          enabled: row.enabled,
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
          services: (loaded.get(row.id)?.services ?? []).map((service) => ({
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
        };
      });
  }

  return {
    isEnabled: () => deps.isEnabled(),

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
    },

    bindSdk({ baseUrl }) {
      boundSdk = createNodeBbSdk({ baseUrl });
    },

    async start() {
      if (!deps.isEnabled()) {
        await syncCliSkill();
        return;
      }
      await loadAll();
      await syncCliSkill();
      notifyPluginsChanged();
    },

    async stop() {
      await disposeAll();
      await syncCliSkill();
      notifyPluginsChanged();
    },

    async onExperimentChanged(enabled) {
      if (enabled) {
        await loadAll();
      } else {
        await disposeAll();
        statuses.clear();
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    list,

    async install(source) {
      const parsed = parsePluginSource(source);
      if (parsed.kind === "git") return installGitSource(parsed, source);
      if (parsed.kind === "npm") return installNpmSource(parsed, source);
      return installPathSource(parsed.path);
    },

    installPath: installPathSource,

    async remove(id) {
      const row = getInstalledPlugin(deps.db, id);
      await disposeOne(id);
      statuses.delete(id);
      handlerStats.delete(id);
      agentToolProblems.delete(id);
      const removed = deleteInstalledPlugin(deps.db, id);
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
        // Managed installs (git:/npm:) own their files under
        // <dataDir>/plugins; path: sources are the user's directory and are
        // never deleted.
        const managedDir = managedInstallDir(deps.dataDir, row.source);
        if (managedDir !== undefined) {
          await rm(managedDir, { recursive: true, force: true });
        }
      }
      await syncCliSkill();
      notifyPluginsChanged();
      return removed;
    },

    async setEnabled(id, enabled) {
      if (!setInstalledPluginEnabled(deps.db, id, enabled)) return undefined;
      if (enabled) {
        const row = getInstalledPlugin(deps.db, id);
        if (row && deps.isEnabled()) await loadOne(row);
      } else {
        await disposeOne(id);
        // A hung service outranks "disabled": the degraded status (set by
        // stopServices) is the only trace of the still-running start().
        if ((hungServices.get(id)?.size ?? 0) === 0) {
          setStatus(id, "disabled");
        }
      }
      await syncCliSkill();
      notifyPluginsChanged();
      return list().find((p) => p.id === id);
    },

    async reload(id) {
      const rows = listInstalledPlugins(deps.db).filter(
        (row) => id === undefined || row.id === id,
      );
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        await disposeOne(row.id);
        await loadOne(row);
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    getApi(id) {
      return loaded.get(id)?.handle.api;
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
      if (!deps.isEnabled()) {
        return fail(
          'Plugins are disabled — enable the "Plugins" experiment in Settings → Experiments.',
        );
      }
      const plugin = loaded.get(id);
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
      if (!deps.isEnabled()) return [];
      return [...loaded.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, plugin]) => plugin.manifest.skillsRootPaths);
    },

    async collectAgentContextSections(ctx) {
      if (!deps.isEnabled() || loaded.size === 0) return [];
      const tasks: Array<Promise<PluginAgentContextSection | null>> = [];
      const entries = [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [id, plugin] of entries) {
        for (const provider of [...plugin.handle.contextProviders]) {
          tasks.push(
            (async () => {
              const outcome = await invokeWrapped(
                id,
                "agent context provider",
                async () => {
                  const providerPromise = (async () => provider(ctx))();
                  // The race abandons a timed-out provider; keep its eventual
                  // rejection observed so it cannot surface as an unhandled
                  // rejection later.
                  providerPromise.catch(() => {});
                  let timer: NodeJS.Timeout | undefined;
                  try {
                    const result = await Promise.race([
                      providerPromise,
                      new Promise<never>((_, reject) => {
                        timer = setTimeout(
                          () =>
                            reject(
                              new Error(
                                `timed out after ${contextProviderTimeoutMs}ms`,
                              ),
                            ),
                          contextProviderTimeoutMs,
                        );
                        timer.unref?.();
                      }),
                    ]);
                    if (result === null || result === undefined) return null;
                    if (typeof result !== "string") {
                      throw new Error(
                        "context provider must return a string or null",
                      );
                    }
                    return result;
                  } finally {
                    if (timer !== undefined) clearTimeout(timer);
                  }
                },
              );
              if (!outcome.ok) return null;
              const text = outcome.value?.trim() ?? "";
              return text.length > 0 ? { pluginId: id, text } : null;
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (section): section is PluginAgentContextSection => section !== null,
      );
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
      if (!deps.isEnabled()) return [];
      const contributions: PluginThreadActionContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
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

    listSlashCommandContributions() {
      if (!deps.isEnabled()) return [];
      const contributions: PluginSlashCommandContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.slashCommands) {
          contributions.push({
            pluginId: id,
            name: record.name,
            description: record.description,
          });
        }
      }
      return contributions;
    },

    getSlashCommand(id, name) {
      return wireLookup(id, (plugin) =>
        plugin.handle.slashCommands.find((record) => record.name === name),
      );
    },

    async runSlashCommand(id, record, ctx) {
      const outcome = await invokeWrapped(
        id,
        `slash command ${record.name}`,
        async () => {
          const result = await record.run(ctx);
          return normalizeSlashCommandResult(record.name, result);
        },
      );
      if (outcome.ok) return { outcome: "ok", value: outcome.value };
      return { outcome: "error", error: outcome.error };
    },

    listMentionProviderContributions() {
      if (!deps.isEnabled()) return [];
      const contributions: PluginMentionProviderContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.mentionProviders) {
          contributions.push({
            pluginId: id,
            id: record.id,
            label: record.label,
          });
        }
      }
      return contributions;
    },

    async searchMentions(args) {
      if (!deps.isEnabled() || loaded.size === 0) return [];
      const tasks: Array<Promise<PluginMentionSearchGroup | null>> = [];
      const entries = [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [id, plugin] of entries) {
        for (const record of [...plugin.handle.mentionProviders]) {
          tasks.push(
            (async () => {
              const outcome = await invokeWrapped(
                id,
                `mention search ${record.id}`,
                async () => {
                  const searchPromise = (async () =>
                    record.search({
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
      if (!deps.isEnabled()) {
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
      if (!deps.isEnabled() || loaded.size === 0) return;
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
