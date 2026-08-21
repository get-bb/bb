import { watch } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CronExpressionParser } from "cron-parser";
import type { Context } from "hono";
import {
  CUSTOM_THEME_CSS_MAX_LENGTH,
  derivePluginId,
  formatPluginThemeId,
  isPluginOwnedIconPath,
  type DeclaredCodeTheme,
  type DynamicTool,
  type JsonValue,
  type PluginThemeMeta,
  type SystemChangeKind,
  type ThreadEventItemPresentation,
  type ToolCallResponse,
} from "@bb/domain";
import {
  type PluginCliExecutionResult,
  type PluginRpcError,
  type PluginRpcValidationIssue,
  type StandardSchemaV1,
  type StandardSchemaV1Issue,
  type StandardSchemaV1Result,
} from "@get-bb/plugin-sdk";
import {
  assertNoRecursiveJsonSchemaReferences,
  enforcePluginCliOutputLimit,
  PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS,
  PLUGIN_AGENT_SELECTION_MAX_IDS,
  PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES,
  RESERVED_AGENT_TOOL_NAMES,
  adoptHttpRouteResponse,
} from "@get-bb/plugin-sdk/internal/host-policy";
// The build engine's natives (esbuild, Tailwind oxide) are dynamically
// imported inside buildPluginApp — importing this loads nothing heavy.
import {
  buildPluginApp,
  buildPluginHost,
  createPluginDevLoop,
} from "@bb/plugin-build";
import { getPluginBuildToolchain } from "./build-toolchain.js";
import {
  marketplacePublisherLabels,
  pluginPublisherLabel,
} from "../plugin-catalog/marketplace-publishers.js";
import { deleteSecretFile, readOrCreateSecretFile } from "@bb/secret-storage";
import {
  ROOT_PLUGIN_SOURCE_SELECTION,
  type PluginCapabilitySummary,
  type PluginSourceSelection,
} from "@bb/server-contract";
import {
  claimPluginScheduledRun,
  deleteAllPluginSettings,
  deleteInstalledPlugin,
  deletePluginSchedules,
  getInstalledPlugin,
  listDuePluginSchedules,
  listInstalledPlugins,
  listPendingGitPluginArtifacts,
  listPluginSchedules,
  markInstalledPluginRemoved,
  recordPluginScheduleResult,
  setInstalledPluginEnabled,
  type InstalledPluginRow,
} from "@bb/db";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";
import type { PluginBrandingAssetVariant } from "./app-bundle.js";
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
import { createPluginActivation } from "./plugin-activation.js";
import {
  createManagedPluginArtifacts,
  type InstallContext,
  type RegisterInstalledArgs,
} from "./managed-plugin-artifacts.js";
import { createPluginRegistration } from "./plugin-registration.js";
import { createPluginRuntime, forgetMutableRoot } from "./plugin-runtime.js";
import { createPluginUpdates } from "./plugin-updates.js";

import { pluginUpdateCheckEntrySchema } from "./plugin-service-internal.js";
import type {
  LoadedPlugin,
  PluginAgentToolContribution,
  PluginApplyUpdateOutcome,
  PluginInstructionContribution,
  PluginListEntry,
  PluginMentionProviderContribution,
  PluginMentionResolveResult,
  PluginMentionSearchGroup,
  PluginMentionSearchItem,
  PluginServiceDeps,
  PluginSourceView,
  PluginThreadEventEmitter,
  PluginUpdateCheckEntry,
  PluginWireLookup,
  PluginResolvedAgentConfiguration,
} from "./plugin-service-internal.js";
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

/**
 * `fs.watch` is allowed to omit the changed filename. The dev loop still has
 * to reload in that case; `.` is a non-ignored synthetic path representing an
 * unknown change somewhere below the watched plugin root.
 */
export function dispatchPluginSourceWatchChange(
  handleChange: (relativePath: string) => void,
  filename: string | null,
): void {
  handleChange(filename === null || filename.length === 0 ? "." : filename);
}

export interface PluginService {
  /** Whether this installed plugin has builtin provenance. */
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
  /** Dispose all loaded plugins (server shutdown). */
  stop(): Promise<void>;
  /**
   * Route a process-level uncaught exception raised from a background
   * service's async context (an unlistened EventEmitter 'error', a timer
   * throw, a detached rejection) back to that service's supervisor, which
   * aborts and restarts it with backoff. Returns false when no service owns
   * the error; the caller then keeps Node's default and exits.
   */
  handleUncaughtException(error: unknown): boolean;
  list(): PluginListEntry[];
  /** Palettes declared by currently loaded plugins, ordered by plugin id. */
  listThemes(): PluginThemeMeta[];
  /** Read a loaded plugin palette by its globally namespaced id. */
  readThemeCss(themeId: string): Promise<string | null>;
  /** Load a plugin theme's declared Pierre / VS Code code theme, if any. */
  readThemeCodeTheme(themeId: string): DeclaredCodeTheme | null;
  /**
   * Install from a source spec: `path:<dir>` (bare paths accepted),
   * `git:<url-ish>@<ref>` (ref required; cloned into the managed dir under
   * <dataDir>/plugins/git), or `npm:<name>[@<version|tag|range>]` (installed
   * with npm --ignore-scripts under <dataDir>/plugins/npm). git/npm installs
   * hard-fail on an engines.bb mismatch and refuse already-registered ids;
   * use update for an existing managed plugin.
   *
   * `selection` picks one plugin out of a multi-plugin `git:`/`path:`
   * repository, either by directory or by `.bb/plugins.json` entry name.
   */
  install(
    source: string,
    selection: PluginSourceSelection,
  ): Promise<PluginListEntry>;
  /**
   * Install a bundled official plugin by its registry name (store install).
   * Registers with catalog provenance so the opt-in survives reconciliation.
   */
  installOfficialPlugin(name: string): Promise<PluginListEntry>;
  /**
   * Install a marketplace catalog entry (store install). Installs from the
   * entry's listed source through the normal pipeline and stamps catalog
   * provenance, so the plugin traces back to the marketplace that listed it.
   */
  installCatalogPlugin(args: {
    /** Marketplace that listed the entry, e.g. `bb-community`. */
    marketplace: string;
    entryId: string;
    /** Manifest id the catalog entry promises; the install aborts on mismatch. */
    pluginId: string;
    source: string;
    /** Which plugin of a multi-plugin repository the entry lists. */
    selection: PluginSourceSelection;
    /** npm registry the listing pins. */
    npmRegistry?: string;
    /** Git commit the user confirmed before a third-party install. */
    expectedGitCommit?: string;
    /** npm version the user confirmed before a third-party install. */
    expectedNpmVersion?: string;
    /** Integrity confirmed with that version, when the registry published one. */
    expectedNpmIntegrity?: string;
  }): Promise<PluginListEntry>;
  /**
   * The exact npm version and integrity a listing's spec resolves to now.
   * The catalog shows this in the install confirmation, and the install then
   * refuses anything else.
   */
  resolveCatalogNpmSource(args: {
    packageName: string;
    registry?: string;
    requestedSpec: string;
    specKind: "default" | "exact" | "tag" | "range";
  }): Promise<
    | { outcome: "resolved"; version: string; integrity: string }
    | { outcome: "unavailable"; detail: string }
  >;
  installPath(path: string): Promise<PluginListEntry>;
  checkForUpdates(id?: string): Promise<PluginUpdateCheckEntry[]>;
  /** Check every plugin for updates every 6 hours; see PluginUpdates. */
  startPeriodicUpdateChecks(): void;
  stopPeriodicUpdateChecks(): Promise<void>;
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
  /** Immutable byte snapshot backing one plugin branding asset route. */
  getBrandingAsset(
    id: string,
    variant: PluginBrandingAssetVariant,
  ): { bytes: Uint8Array; contentType: string; hash: string } | undefined;
  /** Active generations a reconnecting daemon uses to retire stale workers. */
  listHostArtifactGenerations(): Array<{
    pluginId: string;
    generation: string;
  }>;
  /** Dispatch an unexpected worker exit from an active host generation. */
  handleHostWorkerExit(args: {
    authenticatedHostId: string;
    pluginId: string;
    generation: string;
  }): void;
  /** Dispatch one validated ephemeral signal from an active host generation. */
  handleHostSignal(args: {
    authenticatedHostId: string;
    pluginId: string;
    generation: string;
    signal: string;
    payload: JsonValue;
  }): void;
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
   * Validate RPC input, run the handler with failure isolation, validate its
   * output, then normalize it as strict JSON for the response envelope.
   */
  invokeRpcHandler(
    id: string,
    method: string,
    handler: PluginRpcHandler,
    input: unknown,
  ): Promise<
    { ok: true; result: JsonValue } | { ok: false; error: PluginRpcError }
  >;
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
   * code execution. Sorted by plugin id.
   */
  listCliContributions(): PluginCliContribution[];
  /**
   * Run a plugin's registered CLI command wrapped in the failure-isolation
   * discipline. Never throws for dispatch problems: an unknown / not-running
   * plugin, closed experiment gate, missing registration, throwing handler, or
   * malformed handler result all map to exitCode 1 with a helpful stderr —
   * the bb CLI prints stderr and exits with exitCode.
   */
  runCliCommand(
    id: string,
    argv: string[],
    ctx: PluginCliContext,
  ): Promise<PluginCliExecutionResult>;
  /**
   * Skills roots of running plugins (manifest bb.skills or the skills/
   * convention dir), ordered by plugin id — the "plugin" precedence tier
   * passed to resolveInjectedSkillSources per turn. Missing directories are
   * tolerated downstream.
   */
  listSkillRootContributions(): PluginSkillRootContribution[];
  /**
   * Native tools of running plugins (bb.agents.registerTool), ordered by
   * plugin id then registration order, deduped defensively (first wins —
   * registration already blocks collisions). Appended to a session's
   * dynamicTools at thread.start/turn.submit time; changes apply on the
   * NEXT session start.
   */
  listAgentTools(): PluginAgentToolContribution[];
  /**
   * Evaluate each plugin's optional `bb.agents.configure` callback for one
   * server-owned thread/session boundary. Registrations stay static; invalid
   * or throwing callbacks fail closed for that plugin and cannot affect peers.
   */
  resolveAgentConfiguration(args: {
    context: PluginAgentConfigurationContext;
    skillIdsByPlugin: ReadonlyMap<string, readonly string[]>;
  }): Promise<PluginResolvedAgentConfiguration>;
  /**
   * Dynamic instruction providers from bb.agents.contributeInstructions,
   * ordered by plugin id. Resolved live at thread.start/turn.submit;
   * empty when no plugin registered a provider.
   * At most one provider per plugin (duplicate registration is rejected).
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
   * Mention providers of running plugins (bb.ui.registerMentionProvider),
   * ordered by plugin id then registration order, for
   * GET /plugins/contributions. No plugin code runs.
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

const DEFAULT_MENTION_SEARCH_TIMEOUT_MS = 2_000;
// Resolve is looser than search: it blocks a send the user already committed
// to, so it may do one real fetch — but it must not hang POST /threads/:id/send
// forever when a provider never settles.
const DEFAULT_MENTION_RESOLVE_TIMEOUT_MS = 10_000;
const DEFAULT_STABILIZATION_WINDOW_MS = 30_000;
const DEFAULT_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60_000;
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

class PluginRpcBoundaryError extends Error {
  constructor(readonly rpcError: PluginRpcError) {
    super(rpcError.message);
    this.name = "PluginRpcBoundaryError";
  }
}

function normalizeRpcIssuePath(
  path: StandardSchemaV1Issue["path"],
): Array<string | number> | undefined {
  if (path === undefined) return undefined;
  const segments = Array.isArray(path) ? path : [path];
  const normalized = segments.map((segment) => {
    const key =
      typeof segment === "object" && segment !== null
        ? Reflect.get(segment, "key")
        : segment;
    return typeof key === "number" ? key : String(key);
  });
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRpcIssues(
  issues: readonly StandardSchemaV1Issue[],
): PluginRpcValidationIssue[] {
  return issues.map((issue) => {
    const path = normalizeRpcIssuePath(issue.path);
    return {
      message: issue.message,
      ...(path !== undefined ? { path } : {}),
    };
  });
}

function rpcBoundaryFailure(
  code: PluginRpcError["code"],
  message: string,
  issues?: PluginRpcValidationIssue[],
): PluginRpcBoundaryError {
  return new PluginRpcBoundaryError({
    code,
    message,
    ...(issues !== undefined ? { issues } : {}),
  });
}

async function validateRpcValue(
  schema: StandardSchemaV1,
  value: unknown,
  phase: "input" | "output",
): Promise<unknown> {
  let result: StandardSchemaV1Result<unknown>;
  try {
    result = await schema["~standard"].validate(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw rpcBoundaryFailure(
      phase === "input" ? "invalid_input" : "invalid_output",
      `rpc ${phase} validator failed: ${detail}`,
      [{ message: detail }],
    );
  }
  if (result.issues !== undefined) {
    const issues = normalizeRpcIssues(result.issues);
    throw rpcBoundaryFailure(
      phase === "input" ? "invalid_input" : "invalid_output",
      `rpc ${phase} validation failed`,
      issues,
    );
  }
  return result.value;
}

/** Strict JsonValue normalization: no coercion, elision, or toJSON hooks. */
function normalizeRpcJsonResult(value: unknown): JsonValue {
  const ancestors = new Set<object>();

  function visit(current: unknown, path: string): JsonValue {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw rpcBoundaryFailure(
          "non_json_result",
          `rpc result at ${path} contains a non-finite number`,
        );
      }
      return current;
    }
    if (typeof current !== "object") {
      throw rpcBoundaryFailure(
        "non_json_result",
        `rpc result at ${path} is not a JSON value (${typeof current})`,
      );
    }
    if (ancestors.has(current)) {
      throw rpcBoundaryFailure(
        "non_json_result",
        `rpc result at ${path} is cyclic`,
      );
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return current.map((item, index) => visit(item, `${path}[${index}]`));
      }
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw rpcBoundaryFailure(
          "non_json_result",
          `rpc result at ${path} must be a plain JSON object`,
        );
      }
      const symbolKey = Reflect.ownKeys(current).find(
        (key) => typeof key === "symbol",
      );
      if (symbolKey !== undefined) {
        throw rpcBoundaryFailure(
          "non_json_result",
          `rpc result at ${path} contains a symbol key`,
        );
      }
      const normalized: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(current)) {
        normalized[key] = visit(child, `${path}.${key}`);
      }
      return normalized;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, "$result");
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

interface NormalizedPluginAgentConfiguration {
  toolIds: string[];
  toolParameterOverrides: Map<string, Record<string, unknown>>;
  skillIds: string[];
  instructions: string | null;
}

function normalizePluginAgentToolParameters(args: {
  index: number;
  value: unknown;
}): Record<string, unknown> {
  const { index, value } = args;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `configure() output.tools[${index}].parameters must be a JSON-schema object`,
    );
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(
      `configure() output.tools[${index}].parameters is not JSON-serializable`,
    );
  }
  if (serialized === undefined) {
    throw new Error(
      `configure() output.tools[${index}].parameters is not JSON-serializable`,
    );
  }
  if (
    Buffer.byteLength(serialized, "utf8") >
    PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES
  ) {
    throw new Error(
      `configure() output.tools[${index}].parameters exceeds the ${PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES}-byte limit`,
    );
  }
  const parameters = JSON.parse(serialized) as Record<string, unknown>;
  if (parameters.type !== "object") {
    throw new Error(
      `configure() output.tools[${index}].parameters must have root type "object"`,
    );
  }
  assertNoRecursiveJsonSchemaReferences(
    parameters,
    `configure() output.tools[${index}].parameters`,
  );
  return parameters;
}

function normalizePluginAgentToolSelections(args: {
  knownIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): {
  toolIds: string[];
  parameterOverrides: Map<string, Record<string, unknown>>;
} {
  if (!Array.isArray(args.value)) {
    throw new Error("configure() output.tools must be an array");
  }
  if (args.value.length > PLUGIN_AGENT_SELECTION_MAX_IDS) {
    throw new Error(
      `configure() output.tools exceeds the ${PLUGIN_AGENT_SELECTION_MAX_IDS}-id limit`,
    );
  }
  const toolIds: string[] = [];
  const parameterOverrides = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (let index = 0; index < args.value.length; index += 1) {
    const entry = args.value[index];
    let name: unknown;
    let parameters: Record<string, unknown> | null = null;
    if (typeof entry === "string") {
      name = entry;
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry)
    ) {
      const typed = entry as Record<string, unknown>;
      const unknownKeys = Object.keys(typed)
        .filter((key) => !["name", "parameters"].includes(key))
        .sort();
      if (unknownKeys.length > 0) {
        throw new Error(
          `configure() output.tools[${index}] contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`,
        );
      }
      name = typed.name;
      parameters = normalizePluginAgentToolParameters({
        index,
        value: typed.parameters,
      });
    } else {
      throw new Error(
        `configure() output.tools[${index}] must be a tool name or { name, parameters }`,
      );
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `configure() output.tools[${index}] must ${typeof entry === "string" ? "be" : "name"} a non-empty string`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `configure() output.tools contains duplicate id ${JSON.stringify(name)}`,
      );
    }
    if (!args.knownIds.has(name)) {
      throw new Error(
        `configure() selected unknown tool id ${JSON.stringify(name)} owned by plugin ${JSON.stringify(args.pluginId)}`,
      );
    }
    seen.add(name);
    toolIds.push(name);
    if (parameters !== null) parameterOverrides.set(name, parameters);
  }
  return { toolIds, parameterOverrides };
}

function normalizePluginAgentSelectionIds(args: {
  knownIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): string[] {
  if (!Array.isArray(args.value)) {
    throw new Error("configure() output.skills must be an array");
  }
  if (args.value.length > PLUGIN_AGENT_SELECTION_MAX_IDS) {
    throw new Error(
      `configure() output.skills exceeds the ${PLUGIN_AGENT_SELECTION_MAX_IDS}-id limit`,
    );
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < args.value.length; index += 1) {
    const id = args.value[index];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `configure() output.skills[${index}] must be a non-empty string`,
      );
    }
    if (seen.has(id)) {
      throw new Error(
        `configure() output.skills contains duplicate id ${JSON.stringify(id)}`,
      );
    }
    if (!args.knownIds.has(id)) {
      throw new Error(
        `configure() selected unknown skill id ${JSON.stringify(id)} owned by plugin ${JSON.stringify(args.pluginId)}`,
      );
    }
    seen.add(id);
    selected.push(id);
  }
  return selected;
}

function normalizePluginAgentConfiguration(args: {
  knownSkillIds: ReadonlySet<string>;
  knownToolIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): NormalizedPluginAgentConfiguration {
  if (
    typeof args.value !== "object" ||
    args.value === null ||
    Array.isArray(args.value)
  ) {
    throw new Error(
      "configure() must return { tools: string[], skills: string[], instructions?: string }",
    );
  }
  const output = args.value as Record<string, unknown>;
  const unknownKeys = Object.keys(output)
    .filter((key) => !["tools", "skills", "instructions"].includes(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `configure() output contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`,
    );
  }
  if (
    output.instructions !== undefined &&
    typeof output.instructions !== "string"
  ) {
    throw new Error("configure() output.instructions must be a string");
  }
  const instructions =
    typeof output.instructions === "string" &&
    output.instructions.trim().length > 0
      ? output.instructions.slice(
          0,
          PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS,
        )
      : null;
  const toolSelections = normalizePluginAgentToolSelections({
    knownIds: args.knownToolIds,
    pluginId: args.pluginId,
    value: output.tools,
  });
  return {
    toolIds: toolSelections.toolIds,
    toolParameterOverrides: toolSelections.parameterOverrides,
    skillIds: normalizePluginAgentSelectionIds({
      knownIds: args.knownSkillIds,
      pluginId: args.pluginId,
      value: output.skills,
    }),
    instructions,
  };
}

/** The glyph a bb-injected tool wears when neither it nor its plugin names one. */
const GENERIC_AGENT_TOOL_GLYPH = "Toolbox";

export function createPluginService(deps: PluginServiceDeps): PluginService {
  const logger = deps.logger;
  const bundledPlugins =
    deps.bundledPlugins ?? listBundledPluginRegistrations();
  const mentionSearchTimeoutMs =
    deps.mentionSearchTimeoutMs ?? DEFAULT_MENTION_SEARCH_TIMEOUT_MS;
  const mentionResolveTimeoutMs =
    deps.mentionResolveTimeoutMs ?? DEFAULT_MENTION_RESOLVE_TIMEOUT_MS;
  const stabilizationWindowMs =
    deps.stabilizationWindowMs ?? DEFAULT_STABILIZATION_WINDOW_MS;
  const artifactRetentionMs =
    deps.artifactRetentionMs ?? DEFAULT_ARTIFACT_RETENTION_MS;
  const now = deps.now ?? Date.now;
  let lastNotifiedProviderRegistrationRevision =
    deps.providerRegistry?.getRegistrationRevision() ?? 0;
  const scheduleStabilizationWindow =
    deps.scheduleStabilizationWindow ??
    ((durationMs: number, onElapsed: () => void) => {
      const timer = setTimeout(onElapsed, durationMs);
      return () => clearTimeout(timer);
    });

  // The token file sits in the settings-secrets dir so `remove` cleans it
  // up; the dot prefix cannot collide with setting keys (they must match
  // /^[a-zA-Z0-9_-]+$/).
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
    emitThreadEvent,
    handlerStats,
    handleUncaughtException,
    hungServices,
    hostArtifacts,
    identities,
    invokeWrapped,
    isBuiltinPluginId,
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
  } = createPluginRuntime({ deps, nextCronRunAt, settledWithin });

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

  /**
   * The live native-tool view: loaded plugins in id order, registration
   * order within a plugin, deduped first-wins (defensive — registration
   * already blocks cross-plugin collisions and reserved names).
   */
  /**
   * The one full presentation a bb-injected tool carries to the bridge
   * (grammar v3): the plugin's declaration first, then its status labels for
   * the label, then a generic label; the plugin's branding glyph, then
   * `Toolbox`. Resolved here, once, so the wire never carries a hole a
   * bridge would have to fill with a tool-name table of its own.
   */
  function resolveAgentToolPresentation(
    pluginId: string,
    record: PluginAgentToolRecord,
  ): ThreadEventItemPresentation {
    const declared = record.experimentalPresentation;
    const brandingIcon = loaded.get(pluginId)?.manifest.branding.icon;
    const glyph =
      declared?.icon?.glyph ??
      (brandingIcon !== undefined && !isPluginOwnedIconPath(brandingIcon)
        ? brandingIcon
        : GENERIC_AGENT_TOOL_GLYPH);
    return {
      label: declared?.label ??
        record.experimentalStatusLabels ?? {
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

  function toAgentDynamicTool(
    pluginId: string,
    record: PluginAgentToolRecord,
    inputSchema: unknown = record.inputSchema,
  ): DynamicTool {
    return {
      name: record.name,
      description: record.description,
      inputSchema,
      presentation: resolveAgentToolPresentation(pluginId, record),
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
   * out their query stale time. Provider cache invalidation gets its own
   * change kind and only rides the broadcast when the registry changed since
   * the previous lifecycle boundary. Fired on install/remove/enable/disable/
   * reload completion.
   */
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

  /**
   * The user-recognizable capabilities a plugin contributes, for the plugin
   * detail "Includes" section. Manifest-declared skills and themes stay
   * accurate while a plugin is disabled; agent tools and thread integrations
   * only exist on a loaded plugin, so a disabled plugin reports none and the
   * UI explains that they become visible once it is enabled.
   */
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

  function list(): PluginListEntry[] {
    const scheduleRows = listPluginSchedules(deps.db);
    const rows = listInstalledPlugins(deps.db);
    // Resolving labels parses every marketplace's stored manifest, so it only
    // runs when a plugin actually traces back to one. The common case — every
    // plugin bundled or added from a source — reads no manifest at all.
    const publisherLabels = rows.some((row) => row.provenance === "catalog")
      ? marketplacePublisherLabels(deps.db)
      : new Map<string, string>();
    return rows
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const runtime = statuses.get(row.id);
        const stats = handlerStats.get(row.id);
        const loadedPlugin = loaded.get(row.id);
        const cliRegistration = loadedPlugin?.handle.cli.registration;
        // An unloaded (disabled/incompatible/errored) plugin keeps its
        // identity via the static-manifest cache, so it still shows its real
        // name, icon, and logo instead of falling back to the raw id + glyph.
        const identity =
          loadedPlugin === undefined ? identities.get(row.id) : undefined;
        return {
          id: row.id,
          source: row.source,
          rootDir: row.rootDir,
          version: row.version,
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
            labels: publisherLabels,
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
          icon:
            loadedPlugin?.manifest.branding.icon ??
            identity?.manifest.branding.icon ??
            null,
          iconUrl:
            (loadedPlugin !== undefined
              ? brandingAssets.get(row.id)?.compactIcon?.url
              : identity?.brandingAssets.compactIcon?.url) ?? null,
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
          // Rich logos come from the live runtime for an exposed plugin, else
          // from the static-identity cache.
          logoUrl:
            (loadedPlugin !== undefined
              ? brandingAssets.get(row.id)?.logo?.url
              : identity?.brandingAssets.logo?.url) ?? null,
          logoDarkUrl:
            (loadedPlugin !== undefined
              ? brandingAssets.get(row.id)?.logoDark?.url
              : identity?.brandingAssets.logoDark?.url) ?? null,
        };
      });
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

    readThemeCodeTheme(themeId) {
      for (const [pluginId, plugin] of loaded) {
        const theme = plugin.manifest.themes.find(
          (entry) => formatPluginThemeId(pluginId, entry.id) === themeId,
        );
        if (!theme) continue;
        return readPluginThemeCodeTheme(
          themeId,
          theme.codeTheme ?? undefined,
          theme.codeThemePaths,
        );
      }
      return null;
    },

    events: {
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
      emitThreadDeleted(thread) {
        emitThreadEvent("thread.deleted", () => ({
          thread: buildThreadDto(thread),
        }));
      },
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
          const manifest = await readPluginManifest(bundled.rootDir);
          const loop = createPluginDevLoop({
            pluginId: row.id,
            hasApp: manifest.appEntry !== undefined,
            hasHost: manifest.hostEntry !== undefined,
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
              await withLifecycleLock(row.id, async () => {
                const current = getInstalledPlugin(deps.db, row.id);
                if (current === undefined) return;
                await disposeOne(row.id);
                await loadOne(current);
              });
              await syncCliSkill();
              notifyPluginsChanged();
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
        // Only a repository holds several plugins; npm and builtin sources
        // are one package each.
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
          // Only a repository holds several plugins.
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
          // The uninstalled tree is no longer reloadable, so stop the module
          // resolve hook from scanning it on every later import.
          forgetMutableRoot(row.rootDir);
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
          logger.info(
            `plugin ${id} removed from ${row.source}; its settings, secrets, and schedules were deleted`,
          );
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
          if (row) {
            await withLifecycleLock(id, () => loadOne(row));
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
        (row) => id === undefined || row.id === id,
      );
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        await withLifecycleLock(row.id, () => loadOne(row));
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    getApi(id) {
      return loaded.get(id)?.handle.api;
    },

    getAppAsset(id, kind) {
      // Honest gate: assets are only downloadable while the plugin runtime
      // is live. A disabled/errored/removed plugin's recorded snapshot may
      // still ride the inventory for display, but its bytes are not served.
      if (!loaded.has(id)) return undefined;
      const assets = appBundles.get(id)?.assets;
      if (!assets) return undefined;
      const path = kind === "js" ? assets.jsPath : assets.cssPath;
      if (path === null) return undefined;
      return { path, hash: assets.hash };
    },

    getBrandingAsset(id, variant) {
      // Branding is identity, not runtime: serve it for a disabled or
      // incompatible plugin too, matching the inventory.
      const set = loaded.has(id)
        ? brandingAssets.get(id)
        : identities.get(id)?.brandingAssets;
      const asset =
        variant === "icon"
          ? set?.compactIcon
          : variant === "logo-dark"
            ? set?.logoDark
            : set?.logo;
      if (!asset) return undefined;
      return {
        bytes: asset.bytes,
        contentType: asset.contentType,
        hash: asset.hash,
      };
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
          return adoptHttpRouteResponse(response);
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
        const parsedInput = await validateRpcValue(
          handler.inputSchema,
          input,
          "input",
        );
        const result = await handler.handler(parsedInput as never);
        const parsedOutput = await validateRpcValue(
          handler.outputSchema,
          result,
          "output",
        );
        return normalizeRpcJsonResult(parsedOutput);
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
      return collectAgentTools().map(({ pluginId, record }) => ({
        pluginId,
        tool: toAgentDynamicTool(pluginId, record),
        instructions: record.instructions,
      }));
    },

    async resolveAgentConfiguration({ context, skillIdsByPlugin }) {
      const allTools = collectAgentTools();
      const tools: PluginAgentToolContribution[] = [];
      const selectedSkillIdsByPlugin = new Map<string, ReadonlySet<string>>();
      const dynamicInstructions: Array<{ pluginId: string; text: string }> = [];

      for (const [pluginId, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const pluginTools = allTools.filter(
          (entry) => entry.pluginId === pluginId,
        );
        const provider = plugin.handle.agentConfigurationProvider;
        if (provider === null) {
          tools.push(
            ...pluginTools.map(({ record }) => ({
              pluginId,
              tool: toAgentDynamicTool(pluginId, record),
              instructions: record.instructions,
            })),
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
            value: provider(context),
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
            .map(({ record }) => ({
              pluginId,
              tool: toAgentDynamicTool(
                pluginId,
                record,
                parameterOverrides.get(record.name) ?? record.inputSchema,
              ),
              instructions: record.instructions,
            })),
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
