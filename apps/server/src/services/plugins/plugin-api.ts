import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import type { Context } from "hono";
import { z } from "zod";
import {
  deletePluginKvValue,
  getPluginKvValue,
  listPluginKvKeys,
  setPluginKvValue,
  type DbConnection,
} from "@bb/db";
import type { PromptInput } from "@bb/domain";
import type { BbSdk, ThreadSpawnArgs } from "@bb/sdk";
import type { ThreadResponse } from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import { appendPluginLogLine } from "./plugin-log.js";
import {
  readPluginSettingsValues,
  registerSettingDescriptors,
  type PluginSettingDescriptor,
  type PluginSettingDescriptors,
  type PluginSettingValue,
} from "./plugin-settings.js";

/**
 * Thrown when a plugin calls into an API handle that has been invalidated by
 * reload/disable (pi's stale-context discipline): captured `bb` references
 * from a previous load fail loudly instead of acting on dead state.
 */
export class PluginContextStaleError extends Error {
  constructor(pluginId: string) {
    super(
      `plugin "${pluginId}" used a stale API handle — it was reloaded or disabled; ` +
        `re-entry happens via a fresh factory call`,
    );
    this.name = "PluginContextStaleError";
  }
}

/**
 * Thrown from a background service's `start()` to mark the plugin
 * `needs-configuration` (e.g. no API key yet) instead of crash-looping: the
 * service is not restarted until the plugin is reloaded or its settings are
 * saved (which reloads it). Matched by name too, so plugin code without a
 * runtime import can `throw Object.assign(new Error(msg), { name:
 * "NeedsConfigurationError" })`.
 */
export class NeedsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsConfigurationError";
  }
}

export function isNeedsConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** JSON values ≤256KB; larger writes are rejected with a clear error. */
const KV_VALUE_MAX_BYTES = 256 * 1024;

export interface PluginKvStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginStorage {
  kv: PluginKvStorage;
  /**
   * Open (or reuse the path of) the plugin's own SQLite database at
   * <dataDir>/plugins/<id>/data.db — the server's better-sqlite3, WAL mode,
   * busy_timeout 5000. Handles are host-tracked and closed on
   * dispose/reload; a closed handle throws on use.
   */
  sqlite(): Database.Database;
  /**
   * Ordered-statement migration helper: statement index = migration id in a
   * `_bb_migrations` table; unapplied statements run in one transaction.
   * Append-only — never reorder or edit shipped statements.
   */
  migrate(db: Database.Database, statements: string[]): void;
}

/** `default` present → non-optional value; absent → `T | undefined`. */
export type PluginSettingsValues<
  Ds extends Record<string, PluginSettingDescriptor>,
> = {
  [K in keyof Ds]: Ds[K] extends { default: string | boolean }
    ? PluginSettingValueOf<Ds[K]>
    : PluginSettingValueOf<Ds[K]> | undefined;
};

type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
  type: "boolean";
}
  ? boolean
  : string;

export interface PluginSettingsHandle<
  Ds extends Record<string, PluginSettingDescriptor>,
> {
  /** Load-safe: callable inside the factory. */
  get(): Promise<PluginSettingsValues<Ds>>;
  /** Fires after values change through the settings route/CLI. */
  onChange(
    listener: (
      next: PluginSettingsValues<Ds>,
      prev: PluginSettingsValues<Ds>,
    ) => void,
  ): void;
}

export interface PluginSettings {
  define<Ds extends Record<string, PluginSettingDescriptor>>(
    descriptors: Ds,
  ): PluginSettingsHandle<Ds>;
}

/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
export interface PluginThreadEventPayloads {
  "thread.created": { thread: ThreadResponse };
  /** Fired when a thread transitions into `idle`. `lastAssistantText` is
   * assembled the same way GET /threads/:id/output is. */
  "thread.idle": { thread: ThreadResponse; lastAssistantText: string | null };
  /** Fired when a thread transitions into `error`. `error` is the latest
   * system/error event message, when one exists. */
  "thread.failed": { thread: ThreadResponse; error: string | null };
}

export type PluginThreadEventName = keyof PluginThreadEventPayloads;

export type PluginThreadEventHandler<E extends PluginThreadEventName> = (
  payload: PluginThreadEventPayloads[E],
) => void | Promise<void>;

/** Per-event handler lists recorded by `bb.on`; dropped with the handle. */
export type PluginThreadEventHandlers = {
  [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
};

/**
 * The API object handed to a plugin's factory. Grows per design phase
 * (plans/plugin-system-design.md §4); this is the P1.1 core plus P1.3
 * settings + storage and P1.5 thread lifecycle events.
 */
export interface BbPluginApi {
  /** The plugin's own id (namespaces storage, routes, commands). */
  readonly pluginId: string;
  /** Leveled, plugin-scoped logger. */
  readonly log: PluginLogger;
  /** Declarative settings (design §4.2). */
  readonly settings: PluginSettings;
  /** Namespaced KV + per-plugin SQLite (design §4.3). */
  readonly storage: PluginStorage;
  /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
  readonly http: PluginHttp;
  /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
  readonly rpc: PluginRpc;
  /** Ephemeral push to connected frontends (design §4.7). */
  readonly realtime: PluginRealtime;
  /** Long-lived services + cron schedules (design §4.8). */
  readonly background: PluginBackground;
  /** Agent-facing `bb` CLI subcommand (design §4.4). */
  readonly cli: PluginCli;
  /** Per-turn agent context contributions (design §4.4). */
  readonly agents: PluginAgents;
  /** Host-rendered UI contributions (design §4.9). */
  readonly ui: PluginUi;
  /** Plugin-reported status (needs-configuration). */
  readonly status: PluginStatusApi;
  /**
   * The full BB SDK, bound to this server over loopback (design §4.1).
   * Bind-gated: plugins load before/independent of the HTTP listener, so
   * reading this inside the factory throws until the server is listening —
   * use it inside handlers, services, and timers instead.
   * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
   * this plugin's id so spawned threads are attributed automatically.
   */
  readonly sdk: BbSdk;
  /**
   * Observe thread lifecycle events (design §4.5). Load-safe registration;
   * handlers run async after the transition and never affect it. Errors are
   * caught, logged, and counted against this plugin's handler stats.
   */
  on<E extends PluginThreadEventName>(
    event: E,
    handler: PluginThreadEventHandler<E>,
  ): void;
  /**
   * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
   * The sanctioned place to clear timers and close connections.
   */
  onDispose(hook: () => void | Promise<void>): void;
}

/**
 * Wire surfaces (design §4.6/§4.7). Registration is load-safe: routes and
 * rpc handlers are recorded on the handle; the boot-time dispatcher in
 * routes/plugins.ts looks them up live per request, so reload swaps them
 * without touching Hono's routing table.
 */
export type PluginHttpAuthMode = "local" | "token" | "none";

export type PluginHttpHandler = (
  context: Context,
) => Response | Promise<Response>;

export interface PluginHttpRouteRecord {
  /** Uppercased HTTP method. */
  method: string;
  /** Exact-match path starting with "/" (no params/wildcards in V1). */
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

export interface PluginHttp {
  /**
   * Register an HTTP route, mounted at
   * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
   * - "local": Origin/Host must be a local BB app origin; non-GET requires
   *   content-type application/json (forces a CORS preflight).
   * - "token": requires the per-plugin token (`bb plugin token <id>`) via
   *   the x-bb-plugin-token header or ?token=.
   * - "none": no checks — only for signature-verified webhooks.
   */
  route(
    method: string,
    path: string,
    handler: PluginHttpHandler,
    opts?: { auth?: PluginHttpAuthMode },
  ): void;
}

/** Runtime shape of a registered rpc handler; inputs arrive JSON-parsed. */
export type PluginRpcHandler = (input: unknown) => unknown;

export interface PluginRpc {
  /**
   * Register rpc methods, served at POST
   * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
   * JSON request body is the input; the response is
   * `{ ok: true, result }` or `{ ok: false, error }`. Inputs and outputs
   * must survive a JSON round-trip — results are serialized with
   * JSON.stringify and nothing else.
   */
  register(handlers: Record<string, (input: never) => unknown>): void;
}

export interface PluginRealtime {
  /**
   * Broadcast an ephemeral `plugin-signal` WS message
   * `{ pluginId, channel, payload }` to every connected client (V1 has no
   * per-channel subscriptions). `payload` must be JSON-serializable;
   * `undefined` is normalized to `null`. Nothing is persisted.
   */
  publish(channel: string, payload: unknown): void;
}

/**
 * Background services and cron schedules (design §4.8). Registration is
 * load-safe (recorded on the handle); the service runner and the schedule
 * rows are driven by the plugin service after the factory completes.
 */
export interface PluginBackground {
  /**
   * Register a long-lived background service. `start` runs after the
   * factory completes and should resolve when `signal` aborts
   * (dispose/reload/disable/shutdown). A crash restarts it with capped
   * exponential backoff; throwing NeedsConfigurationError marks the plugin
   * `needs-configuration` and stops restarting until the next load.
   */
  service(
    name: string,
    service: { start(signal: AbortSignal): void | Promise<void> },
  ): void;
  /**
   * Register a cron schedule (5-field expression, server-local time). The
   * durable row keyed (pluginId, name) is upserted at load; the periodic
   * sweep claims due rows with a CAS on next_run_at, but only while this
   * plugin is loaded. Failures land in last_status/last_error, visible in
   * `bb plugin list`.
   */
  schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}

/**
 * Agent-facing CLI subcommands (design §4.4). A plugin registers one
 * top-level `bb <name>` command; the bb CLI proxies invocations to
 * POST /api/v1/plugins/:id/cli and the handler runs server-side.
 */
export interface PluginCliCommandInfo {
  name: string;
  summary: string;
  usage: string;
}

/** Context forwarded from the invoking CLI when known; all fields optional. */
export interface PluginCliContext {
  cwd?: string;
  threadId?: string;
  projectId?: string;
}

export interface PluginCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface PluginCliRegistration {
  /** Top-level command name (`bb <name> …`): lowercase [a-z0-9-]+, and not
   * a core bb command (see RESERVED_BB_CLI_COMMANDS). */
  name: string;
  summary: string;
  /** Subcommand metadata rendered in help and the plugin-commands skill
   * without executing plugin code. Parsing argv is plugin-owned. */
  commands?: PluginCliCommandInfo[];
  run(
    argv: string[],
    ctx: PluginCliContext,
  ): PluginCliResult | Promise<PluginCliResult>;
}

export interface PluginCli {
  /**
   * Register this plugin's `bb` subcommand. One registration per plugin —
   * a second call replaces the first. Core bb commands always win name
   * collisions; reserved names are rejected at registration.
   */
  register(registration: PluginCliRegistration): void;
}

/** Per-turn context handed to bb.agents context providers (design §4.4). */
export interface PluginAgentTurnContext {
  threadId: string;
  projectId: string;
}

export type PluginAgentContextProvider = (
  ctx: PluginAgentTurnContext,
) => string | null | Promise<string | null>;

/** MCP-style content parts a native tool may return (design §4.4). */
export type PluginAgentToolContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type PluginAgentToolResult =
  | string
  | { content: PluginAgentToolContentPart[]; isError?: boolean };

/** Per-call context handed to a native tool's execute (design §4.4). */
export interface PluginAgentToolContext {
  threadId: string;
  projectId: string;
  /** The tool-call request's abort signal (aborts if the daemon round-trip
   * is torn down mid-call). */
  signal: AbortSignal;
}

export interface PluginAgentToolRegistrationBase {
  /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
   * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES). */
  name: string;
  description: string;
  /**
   * Optional usage snippet appended to the thread instructions whenever
   * this tool is in the session's tool set (mirrors the built-in
   * update_environment_directory guidance). Keep it short.
   */
  instructions?: string;
}

export interface PluginAgents {
  /**
   * Register a per-turn instruction-section provider (design §4.4). Called
   * during runtime-config assembly for every thread turn (global in V1);
   * the returned text is appended to the thread's instructions, labeled
   * with this plugin's id. Return null or an empty string to contribute
   * nothing. Each call is time-boxed (2s) and failure-isolated: a slow or
   * throwing provider is skipped and logged — it can never stall turn
   * submission. Multiple providers per plugin are allowed.
   */
  addContext(provider: PluginAgentContextProvider): void;
  /**
   * Register a native dynamic tool (design §4.4). `parameters` is either a
   * zod schema (validated per call; execute receives the parsed value) or a
   * plain JSON-schema object (no validation; execute receives the raw
   * arguments as `unknown`). Tool-set changes apply on the NEXT session
   * start — a tool registered mid-session is not hot-added to running
   * provider sessions. A second registration of the same name within this
   * plugin replaces the first; a name already registered by another plugin
   * is rejected and surfaced as this plugin's status detail.
   */
  registerTool<Schema extends z.ZodType>(
    tool: PluginAgentToolRegistrationBase & {
      parameters: Schema;
      execute(
        params: z.output<Schema>,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  registerTool(
    tool: PluginAgentToolRegistrationBase & {
      /** Raw JSON-schema escape hatch; params arrive unvalidated. */
      parameters: Record<string, unknown>;
      execute(
        params: unknown,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
}

/** Runtime record of a registered native tool. */
export interface PluginAgentToolRecord {
  name: string;
  description: string;
  /** Instructions snippet for the thread-instructions assembly; null when
   * the registration carried none (description-only). */
  instructions: string | null;
  /** JSON-schema object sent to providers as the tool's input schema. */
  inputSchema: unknown;
  /** Validates raw arguments: zod-backed for zod registrations,
   * pass-through for raw JSON-schema ones. */
  parse(
    input: unknown,
  ): { ok: true; value: unknown } | { ok: false; error: string };
  execute(
    params: unknown,
    ctx: PluginAgentToolContext,
  ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}

/**
 * Core `bb` CLI top-level command names (plus commander's built-in help).
 * Plugin CLI commands may not shadow these. Maintained by hand — kept in
 * sync with apps/cli/src/index.ts by
 * apps/cli/src/__tests__/plugin-cli-proxy.test.ts.
 */
export const RESERVED_BB_CLI_COMMANDS: readonly string[] = [
  "automation",
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "status",
  "theme",
  "thread",
  "ui",
];

/**
 * Built-in dynamic tool names plugins may not shadow. Maintained by hand —
 * kept in sync with the built-in tools in
 * services/threads/thread-runtime-config.ts by
 * test/services/plugins/plugin-agent-tools.test.ts.
 */
export const RESERVED_AGENT_TOOL_NAMES: readonly string[] = [
  "update_environment_directory",
];

/**
 * Built-in composer slash commands plugins may not shadow. Maintained by
 * hand — kept in sync with BUILT_IN_PROVIDER_COMMANDS in
 * services/threads/provider-command-typeahead.ts by
 * test/services/plugins/plugin-slash-commands.test.ts.
 */
export const RESERVED_COMPOSER_SLASH_COMMANDS: readonly string[] = ["compact"];

/**
 * Host-rendered UI contributions (design §4.9): declarative registrations
 * served by GET /plugins/contributions and rendered by the shipped app — no
 * frontend bundle required.
 */
export interface PluginThreadActionContext {
  threadId: string;
  projectId: string;
}

export interface PluginThreadActionToast {
  kind: "success" | "error" | "info";
  message: string;
}

export type PluginThreadActionResult = void | {
  toast?: PluginThreadActionToast;
};

export interface PluginThreadActionRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (becomes a URL segment). */
  id: string;
  /** Button label rendered in the thread header. */
  title: string;
  /** Optional icon name; the host falls back to a generic icon. */
  icon?: string;
  /** Optional confirmation prompt the host shows before running. */
  confirm?: string;
  /**
   * Runs server-side when the user clicks the action. The host shows a
   * pending state while in flight, the returned toast on completion, and an
   * automatic error toast when this throws.
   */
  run(
    ctx: PluginThreadActionContext,
  ): PluginThreadActionResult | Promise<PluginThreadActionResult>;
}

/**
 * Composer slash-command invocation context (design §4.9). `threadId` and
 * `projectId` are null when the command runs from the homepage (new-thread)
 * composer before a thread or project is committed.
 */
export interface PluginSlashCommandContext {
  /**
   * Text passed after the command name; "" when none. The shipped composer
   * currently always sends "" — its trigger query stops at the first
   * whitespace, so nothing typed after the name reaches the command.
   * Non-empty args arrive only from a direct
   * `POST /plugins/:id/slash/:name` (e.g. scripts or tests).
   */
  args: string;
  threadId: string | null;
  projectId: string | null;
}

/**
 * Return contract: void completes silently, `insertText` inserts a draft
 * into the composer at the cursor, `send` submits the inputs as a message
 * through the composer's normal send path.
 */
export type PluginSlashCommandResult =
  | void
  | { insertText: string }
  | { send: PromptInput[] };

export interface PluginSlashCommandRegistration {
  /** Menu name (`/<name>`): lowercase [a-z0-9-]+, and not a built-in
   * composer command (see RESERVED_COMPOSER_SLASH_COMMANDS). */
  name: string;
  /** Shown next to the name in the composer's `/` menu. */
  description: string;
  /**
   * Runs server-side when the user picks the command. The composer menu
   * shows a pending state while in flight and an error toast when this
   * throws.
   */
  run(
    ctx: PluginSlashCommandContext,
  ): PluginSlashCommandResult | Promise<PluginSlashCommandResult>;
}

/** Runtime record of a registered slash command. */
export interface PluginSlashCommandRecord {
  name: string;
  description: string;
  run: (
    ctx: PluginSlashCommandContext,
  ) => PluginSlashCommandResult | Promise<PluginSlashCommandResult>;
}

/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
export interface PluginMentionSearchContext {
  query: string;
  projectId: string | null;
  threadId: string | null;
}

/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
export interface PluginMentionItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
}

export interface PluginMentionProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
   * wire item ids as "<providerId>:<itemId>"). */
  id: string;
  /** Section label shown above this provider's rows in the mention menu. */
  label: string;
  /**
   * Runs server-side as the user types after `@` in the composer. Each call
   * is time-boxed (2s) and failure-isolated: a slow or throwing provider
   * contributes an empty list — it can never break the mention menu.
   */
  search(
    ctx: PluginMentionSearchContext,
  ): PluginMentionItem[] | Promise<PluginMentionItem[]>;
  /**
   * Resolves one picked item into agent context, called once per unique
   * item at message send time. The returned `context` is attached to the
   * message as an agent-visible (user-hidden) prompt input. Throwing blocks
   * the send with a visible error.
   */
  resolve(itemId: string): { context: string } | Promise<{ context: string }>;
}

/** Runtime record of a registered mention provider. */
export interface PluginMentionProviderRecord {
  id: string;
  label: string;
  search: (
    ctx: PluginMentionSearchContext,
  ) => PluginMentionItem[] | Promise<PluginMentionItem[]>;
  resolve: (
    itemId: string,
  ) => { context: string } | Promise<{ context: string }>;
}

export interface PluginUi {
  /**
   * Register a thread action rendered in the shipped app's thread header
   * (design §4.9). Multiple actions per plugin; ids must be unique within
   * the plugin. Invoked via POST /plugins/:id/actions/:actionId.
   */
  registerThreadAction(action: PluginThreadActionRegistration): void;
  /**
   * Register a composer slash command rendered in the shipped app's `/`
   * menu (design §4.9). Multiple commands per plugin; names must be unique
   * within the plugin. Invoked via POST /plugins/:id/slash/:name.
   */
  registerSlashCommand(command: PluginSlashCommandRegistration): void;
  /**
   * Register an `@`-mention provider for the shipped app's composer
   * (design §4.9). Items group under `label` in the mention menu; a picked
   * item becomes a `{ kind: "plugin" }` mention resource whose context is
   * resolved once at send time. Multiple providers per plugin; ids must be
   * unique within the plugin.
   */
  registerMentionProvider(provider: PluginMentionProviderRegistration): void;
}

/** Runtime record of a registered thread action. */
export interface PluginThreadActionRecord {
  id: string;
  title: string;
  icon: string | null;
  confirm: string | null;
  run: (
    ctx: PluginThreadActionContext,
  ) => PluginThreadActionResult | Promise<PluginThreadActionResult>;
}

export interface PluginStatusApi {
  /**
   * Mark this plugin `needs-configuration` (with a message shown in
   * `bb plugin list` and the UI) instead of failing — e.g. a factory or
   * service that finds no API key configured. Cleared on the next load;
   * saving settings does not auto-reload in V1, so ask the user to
   * `bb plugin reload <id>` after configuring.
   */
  needsConfiguration(message: string): void;
}

/** Runtime record of a registered background service. */
export interface PluginBackgroundServiceRecord {
  name: string;
  start: (signal: AbortSignal) => void | Promise<void>;
}

/** Runtime record of a registered schedule; cron is validated at registration. */
export interface PluginScheduleRecord {
  name: string;
  cron: string;
  fn: () => void | Promise<void>;
}

/** Validated record of the plugin's `bb.cli.register` call. */
export interface PluginCliRegistrationRecord {
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
  run: (
    argv: string[],
    ctx: PluginCliContext,
  ) => PluginCliResult | Promise<PluginCliResult>;
}

const PLUGIN_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

// Rpc method names become URL path segments.
const RPC_METHOD_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Service/schedule names appear in status text and plugin_schedules rows.
const BACKGROUND_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// CLI command names become `bb <name>` invocations.
const CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;

// Agent tool names are shown to (and called by) the model.
const AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Thread action ids become URL path segments.
const THREAD_ACTION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Slash command names become `/<name>` menu entries and URL path segments.
const SLASH_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;

// Mention provider ids prefix wire item ids ("<providerId>:<itemId>"), so
// ":" is excluded to keep the split unambiguous.
const MENTION_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type PluginSettingsListener = (
  next: Record<string, PluginSettingValue | undefined>,
  prev: Record<string, PluginSettingValue | undefined>,
) => void;

export interface PluginApiHandle {
  api: BbPluginApi;
  /** Dispose hooks in registration order (runner executes them LIFO). */
  disposeHooks: Array<() => void | Promise<void>>;
  /** Settings schema + change listeners recorded by `settings.define`. */
  settings: {
    descriptors: PluginSettingDescriptors;
    listeners: PluginSettingsListener[];
  };
  /** Every sqlite handle vended by `storage.sqlite()`; closed on dispose. */
  sqliteHandles: Database.Database[];
  /** Thread lifecycle handlers recorded by `bb.on`. */
  threadEventHandlers: PluginThreadEventHandlers;
  /** HTTP routes recorded by `bb.http.route`; dropped with the handle. */
  httpRoutes: PluginHttpRouteRecord[];
  /** RPC handlers recorded by `bb.rpc.register`; dropped with the handle. */
  rpcHandlers: Map<string, PluginRpcHandler>;
  /** Background services recorded by `bb.background.service`. */
  backgroundServices: PluginBackgroundServiceRecord[];
  /** Schedules recorded by `bb.background.schedule`. */
  schedules: PluginScheduleRecord[];
  /** The plugin's CLI command (`bb.cli.register`); null when none. */
  cli: { registration: PluginCliRegistrationRecord | null };
  /** Per-turn context providers recorded by `bb.agents.addContext`. */
  contextProviders: PluginAgentContextProvider[];
  /** Native tools recorded by `bb.agents.registerTool`. */
  agentTools: PluginAgentToolRecord[];
  /** Thread actions recorded by `bb.ui.registerThreadAction`. */
  threadActions: PluginThreadActionRecord[];
  /** Slash commands recorded by `bb.ui.registerSlashCommand`. */
  slashCommands: PluginSlashCommandRecord[];
  /** Mention providers recorded by `bb.ui.registerMentionProvider`. */
  mentionProviders: PluginMentionProviderRecord[];
  /** Poison every method on the handle. */
  invalidate(): void;
}

/** Duck-typed zod detection: plugin sources may carry their own zod copy,
 * so instanceof is useless — anything with safeParse is treated as zod. */
function isZodSchemaLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/** Compact issue summary from a (possibly foreign-instance) zod error. */
function summarizeParseIssues(error: unknown): string {
  const issues = (
    error as { issues?: Array<{ path?: PropertyKey[]; message?: string }> }
  )?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((issue) => {
        const path =
          Array.isArray(issue.path) && issue.path.length > 0
            ? issue.path.join(".")
            : "(input)";
        return `${path}: ${issue.message ?? "invalid"}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wrap the shared server-bound SDK for one plugin: `threads.spawn` gets
 * default attribution (`origin: "plugin"`, `originPluginId: <plugin id>`)
 * unless the plugin sets those fields explicitly.
 */
function wrapSdkForPlugin(sdk: BbSdk, pluginId: string): BbSdk {
  return {
    ...sdk,
    threads: {
      ...sdk.threads,
      spawn(args: ThreadSpawnArgs) {
        const origin = args.origin ?? "plugin";
        return sdk.threads.spawn({
          ...args,
          origin,
          ...(origin === "plugin"
            ? { originPluginId: args.originPluginId ?? pluginId }
            : {}),
        });
      },
    },
  };
}

export function createPluginApi(options: {
  pluginId: string;
  logger: ServerLogger;
  db: DbConnection;
  dataDir: string;
  /** Undefined until the server is listening (bb.sdk is bind-gated). */
  getSdk: () => BbSdk | undefined;
  /** Broadcasts a plugin-signal WS message (hub.notifyPluginSignal). */
  publishSignal: (channel: string, payload: unknown) => void;
  /** Marks the plugin needs-configuration in the loader's status table. */
  reportNeedsConfiguration: (message: string) => void;
  /** Returns the owning plugin id when another plugin already registered
   * this agent tool name (cross-plugin collisions lose, design §4.4). */
  isAgentToolNameTaken: (name: string) => string | undefined;
  /** Records an agent-tool registration problem as the plugin's status
   * detail; the plugin itself keeps running. */
  reportAgentToolProblem: (message: string) => void;
}): PluginApiHandle {
  const {
    pluginId,
    logger,
    db,
    dataDir,
    getSdk,
    publishSignal,
    reportNeedsConfiguration,
    isAgentToolNameTaken,
    reportAgentToolProblem,
  } = options;
  let invalidated = false;
  let wrappedSdk: BbSdk | undefined;
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const settingsRecord: PluginApiHandle["settings"] = {
    descriptors: {},
    listeners: [],
  };
  const sqliteHandles: Database.Database[] = [];
  const threadEventHandlers: PluginThreadEventHandlers = {
    "thread.created": [],
    "thread.idle": [],
    "thread.failed": [],
  };
  const httpRoutes: PluginHttpRouteRecord[] = [];
  const rpcHandlers = new Map<string, PluginRpcHandler>();
  const backgroundServices: PluginBackgroundServiceRecord[] = [];
  const schedules: PluginScheduleRecord[] = [];

  function assertLive(): void {
    if (invalidated) throw new PluginContextStaleError(pluginId);
  }

  const prefix = `[plugin:${pluginId}]`;
  // Every bb.log line goes to the prefixed server log and, as JSONL, to the
  // per-plugin log file served by GET /plugins/:id/logs (`bb plugin logs`).
  function emitLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    logger[level](`${prefix} ${message}`);
    appendPluginLogLine(dataDir, pluginId, level, message);
  }
  const log: PluginLogger = {
    debug: (message) => emitLog("debug", message),
    info: (message) => emitLog("info", message),
    warn: (message) => emitLog("warn", message),
    error: (message) => emitLog("error", message),
  };

  const kv: PluginKvStorage = {
    async get(key) {
      assertLive();
      const raw = getPluginKvValue(db, pluginId, key);
      if (raw === undefined) return undefined;
      return JSON.parse(raw);
    },
    async set(key, value) {
      assertLive();
      const json = JSON.stringify(value);
      if (json === undefined) {
        throw new Error(`kv value for "${key}" is not JSON-serializable`);
      }
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > KV_VALUE_MAX_BYTES) {
        throw new Error(
          `kv value for "${key}" is ${bytes} bytes; the limit is ${KV_VALUE_MAX_BYTES} (256KB). ` +
            `Store large data in storage.sqlite() instead.`,
        );
      }
      setPluginKvValue(db, pluginId, key, json);
    },
    async delete(key) {
      assertLive();
      deletePluginKvValue(db, pluginId, key);
    },
    async list(kvPrefix) {
      assertLive();
      return listPluginKvKeys(db, pluginId, kvPrefix);
    },
  };

  const storage: PluginStorage = {
    kv,
    sqlite() {
      assertLive();
      const dir = join(dataDir, "plugins", pluginId);
      mkdirSync(dir, { recursive: true });
      const database = new Database(join(dir, "data.db"));
      database.pragma("journal_mode = WAL");
      database.pragma("busy_timeout = 5000");
      sqliteHandles.push(database);
      return database;
    },
    migrate(database, statements) {
      assertLive();
      database.exec(
        "CREATE TABLE IF NOT EXISTS _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
      );
      const applied = new Set(
        (
          database.prepare("SELECT id FROM _bb_migrations").all() as Array<{
            id: number;
          }>
        ).map((row) => row.id),
      );
      const record = database.prepare(
        "INSERT INTO _bb_migrations (id, applied_at) VALUES (?, ?)",
      );
      database.transaction(() => {
        statements.forEach((statement, index) => {
          if (applied.has(index)) return;
          database.exec(statement);
          record.run(index, Date.now());
        });
      })();
    },
  };

  const settings: PluginSettings = {
    define(descriptors) {
      assertLive();
      const validated = registerSettingDescriptors(
        settingsRecord.descriptors,
        descriptors as Record<string, unknown>,
      );
      type Values = PluginSettingsValues<typeof descriptors>;
      return {
        async get() {
          assertLive();
          // The runtime record is untyped; the descriptor generics are the
          // real contract, re-applied at this boundary.
          return (await readPluginSettingsValues({
            db,
            dataDir,
            pluginId,
            descriptors: validated,
          })) as Values;
        },
        onChange(listener) {
          assertLive();
          settingsRecord.listeners.push(listener as PluginSettingsListener);
        },
      };
    },
  };

  // Plugin sources are untyped at runtime (jiti-loaded TS): every wire
  // registration validates loudly instead of failing at dispatch time.
  const http: PluginHttp = {
    route(method, path, handler, opts) {
      assertLive();
      const normalizedMethod = String(method).toUpperCase();
      if (!PLUGIN_HTTP_METHODS.has(normalizedMethod)) {
        throw new Error(
          `invalid http method "${String(method)}" — use one of: ${[...PLUGIN_HTTP_METHODS].join(", ")}`,
        );
      }
      if (typeof path !== "string" || !path.startsWith("/")) {
        throw new Error(
          `http route path must be a string starting with "/", got ${JSON.stringify(path)}`,
        );
      }
      if (typeof handler !== "function") {
        throw new Error(
          `http route handler for ${normalizedMethod} ${path} must be a function`,
        );
      }
      const auth = opts?.auth ?? "local";
      if (auth !== "local" && auth !== "token" && auth !== "none") {
        throw new Error(
          `invalid auth mode "${String(auth)}" for ${normalizedMethod} ${path} — use "local", "token", or "none"`,
        );
      }
      if (
        httpRoutes.some(
          (route) => route.method === normalizedMethod && route.path === path,
        )
      ) {
        throw new Error(
          `http route ${normalizedMethod} ${path} is already registered`,
        );
      }
      httpRoutes.push({ method: normalizedMethod, path, auth, handler });
    },
  };

  const rpc: PluginRpc = {
    register(handlers) {
      assertLive();
      for (const [name, handler] of Object.entries(handlers)) {
        if (!RPC_METHOD_PATTERN.test(name)) {
          throw new Error(
            `invalid rpc method name "${name}" — use letters, digits, "-" and "_"`,
          );
        }
        if (typeof handler !== "function") {
          throw new Error(`rpc method "${name}" must be a function`);
        }
        if (rpcHandlers.has(name)) {
          throw new Error(`rpc method "${name}" is already registered`);
        }
        rpcHandlers.set(name, handler as PluginRpcHandler);
      }
    },
  };

  const realtime: PluginRealtime = {
    publish(channel, payload) {
      assertLive();
      if (typeof channel !== "string" || channel.length === 0) {
        throw new Error("realtime channel must be a non-empty string");
      }
      // JSON round-trip up front: enforces serializability with a clear
      // error at the publish site and strips prototypes/getters before the
      // payload crosses the WS boundary.
      let normalized: unknown = null;
      if (payload !== undefined) {
        let json: string | undefined;
        try {
          json = JSON.stringify(payload);
        } catch {
          json = undefined;
        }
        if (json === undefined) {
          throw new Error(
            `realtime payload for channel "${channel}" is not JSON-serializable`,
          );
        }
        normalized = JSON.parse(json);
      }
      publishSignal(channel, normalized);
    },
  };

  const background: PluginBackground = {
    service(name, service) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid service name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (backgroundServices.some((record) => record.name === name)) {
        throw new Error(`background service "${name}" is already registered`);
      }
      if (typeof service?.start !== "function") {
        throw new Error(
          `background service "${name}" must provide a start(signal) function`,
        );
      }
      backgroundServices.push({ name, start: service.start.bind(service) });
    },
    schedule(name, cron, fn) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid schedule name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (schedules.some((record) => record.name === name)) {
        throw new Error(`schedule "${name}" is already registered`);
      }
      try {
        CronExpressionParser.parse(String(cron));
      } catch (error) {
        throw new Error(
          `invalid cron ${JSON.stringify(cron)} for schedule "${name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (typeof fn !== "function") {
        throw new Error(`schedule "${name}" must provide a function`);
      }
      schedules.push({ name, cron: String(cron), fn });
    },
  };

  const contextProviders: PluginAgentContextProvider[] = [];
  const agentTools: PluginAgentToolRecord[] = [];
  const agents: PluginAgents = {
    addContext(provider) {
      assertLive();
      if (typeof provider !== "function") {
        throw new Error("agents.addContext requires a function provider");
      }
      contextProviders.push(provider);
    },
    registerTool(tool: {
      name: string;
      description: string;
      instructions?: string;
      parameters: unknown;
      execute(
        params: never,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }) {
      assertLive();
      const name = tool?.name;
      if (typeof name !== "string" || !AGENT_TOOL_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid tool name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (RESERVED_AGENT_TOOL_NAMES.includes(name)) {
        throw new Error(
          `tool name "${name}" is a built-in bb tool — pick another name`,
        );
      }
      if (
        typeof tool.description !== "string" ||
        tool.description.trim().length === 0
      ) {
        throw new Error(`tool "${name}" must provide a description`);
      }
      if (
        tool.instructions !== undefined &&
        typeof tool.instructions !== "string"
      ) {
        throw new Error(`tool "${name}" instructions must be a string`);
      }
      if (typeof tool.execute !== "function") {
        throw new Error(
          `tool "${name}" must provide an execute(params, ctx) function`,
        );
      }
      const parameters: unknown = tool.parameters;
      let inputSchema: unknown;
      let parse: PluginAgentToolRecord["parse"];
      if (isZodSchemaLike(parameters)) {
        // The server's own zod 4 converts the schema; a schema from an
        // incompatible zod copy inside the plugin fails here with a clear
        // registration error instead of a broken wire schema later.
        try {
          inputSchema = z.toJSONSchema(parameters as z.ZodType, {
            io: "input",
          });
        } catch (error) {
          throw new Error(
            `tool "${name}" parameters look like a zod schema but could not be converted to JSON Schema (${
              error instanceof Error ? error.message : String(error)
            }) — use zod 4, or pass a plain JSON-schema object`,
          );
        }
        parse = (input) => {
          const result = (parameters as z.ZodType).safeParse(input);
          if (result.success) return { ok: true, value: result.data };
          return { ok: false, error: summarizeParseIssues(result.error) };
        };
      } else if (
        typeof parameters === "object" &&
        parameters !== null &&
        !Array.isArray(parameters)
      ) {
        // Raw JSON-schema escape hatch: round-trip enforces serializability
        // (the schema rides thread.start commands) and strips prototypes.
        try {
          inputSchema = JSON.parse(JSON.stringify(parameters));
        } catch {
          throw new Error(
            `tool "${name}" parameters JSON schema is not JSON-serializable`,
          );
        }
        parse = (input) => ({ ok: true, value: input });
      } else {
        throw new Error(
          `tool "${name}" parameters must be a zod schema or a JSON-schema object`,
        );
      }
      const owner = isAgentToolNameTaken(name);
      if (owner !== undefined) {
        // Cross-plugin collision: the earlier registration wins; this one
        // is dropped and surfaced as a status detail (design §4.4).
        reportAgentToolProblem(
          `tool "${name}" is already registered by plugin "${owner}" — not registered`,
        );
        return;
      }
      const record: PluginAgentToolRecord = {
        name,
        description: tool.description,
        instructions:
          tool.instructions !== undefined && tool.instructions.trim().length > 0
            ? tool.instructions
            : null,
        inputSchema,
        parse,
        execute: (
          tool.execute as (
            params: unknown,
            ctx: PluginAgentToolContext,
          ) => PluginAgentToolResult | Promise<PluginAgentToolResult>
        ).bind(tool),
      };
      // Second registration of the same name within one plugin replaces
      // the first.
      const existingIndex = agentTools.findIndex(
        (existing) => existing.name === name,
      );
      if (existingIndex >= 0) {
        agentTools[existingIndex] = record;
      } else {
        agentTools.push(record);
      }
    },
  };

  const threadActions: PluginThreadActionRecord[] = [];
  const slashCommands: PluginSlashCommandRecord[] = [];
  const mentionProviders: PluginMentionProviderRecord[] = [];
  const ui: PluginUi = {
    registerThreadAction(action) {
      assertLive();
      const id = action?.id;
      if (typeof id !== "string" || !THREAD_ACTION_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid thread action id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (threadActions.some((record) => record.id === id)) {
        throw new Error(`thread action "${id}" is already registered`);
      }
      if (
        typeof action.title !== "string" ||
        action.title.trim().length === 0
      ) {
        throw new Error(`thread action "${id}" must provide a title`);
      }
      if (action.icon !== undefined && typeof action.icon !== "string") {
        throw new Error(`thread action "${id}" icon must be a string`);
      }
      if (action.confirm !== undefined && typeof action.confirm !== "string") {
        throw new Error(`thread action "${id}" confirm must be a string`);
      }
      if (typeof action.run !== "function") {
        throw new Error(
          `thread action "${id}" must provide a run({ threadId, projectId }) function`,
        );
      }
      threadActions.push({
        id,
        title: action.title,
        icon:
          action.icon !== undefined && action.icon.trim().length > 0
            ? action.icon
            : null,
        confirm:
          action.confirm !== undefined && action.confirm.trim().length > 0
            ? action.confirm
            : null,
        run: action.run.bind(action),
      });
    },
    registerSlashCommand(command) {
      assertLive();
      const name = command?.name;
      if (typeof name !== "string" || !SLASH_COMMAND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid slash command name ${JSON.stringify(name)} — use lowercase letters, digits, and "-"`,
        );
      }
      if (RESERVED_COMPOSER_SLASH_COMMANDS.includes(name)) {
        throw new Error(
          `slash command "/${name}" is a built-in composer command — pick another name`,
        );
      }
      if (slashCommands.some((record) => record.name === name)) {
        throw new Error(`slash command "${name}" is already registered`);
      }
      if (
        typeof command.description !== "string" ||
        command.description.trim().length === 0
      ) {
        throw new Error(`slash command "${name}" must provide a description`);
      }
      if (typeof command.run !== "function") {
        throw new Error(
          `slash command "${name}" must provide a run({ args, threadId, projectId }) function`,
        );
      }
      slashCommands.push({
        name,
        description: command.description,
        run: command.run.bind(command),
      });
    },
    registerMentionProvider(provider) {
      assertLive();
      const id = provider?.id;
      if (typeof id !== "string" || !MENTION_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid mention provider id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (mentionProviders.some((record) => record.id === id)) {
        throw new Error(`mention provider "${id}" is already registered`);
      }
      if (
        typeof provider.label !== "string" ||
        provider.label.trim().length === 0
      ) {
        throw new Error(`mention provider "${id}" must provide a label`);
      }
      if (typeof provider.search !== "function") {
        throw new Error(
          `mention provider "${id}" must provide a search({ query, projectId, threadId }) function`,
        );
      }
      if (typeof provider.resolve !== "function") {
        throw new Error(
          `mention provider "${id}" must provide a resolve(itemId) function`,
        );
      }
      mentionProviders.push({
        id,
        label: provider.label.trim(),
        search: provider.search.bind(provider),
        resolve: provider.resolve.bind(provider),
      });
    },
  };

  const cliRecord: PluginApiHandle["cli"] = { registration: null };
  const cli: PluginCli = {
    register(registration) {
      assertLive();
      const name = registration?.name;
      if (typeof name !== "string" || !CLI_COMMAND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid cli command name ${JSON.stringify(name)} — use lowercase letters, digits, and "-"`,
        );
      }
      if (RESERVED_BB_CLI_COMMANDS.includes(name)) {
        throw new Error(
          `cli command name "${name}" is reserved by the bb CLI — pick another name`,
        );
      }
      if (
        typeof registration.summary !== "string" ||
        registration.summary.trim().length === 0
      ) {
        throw new Error(`cli command "${name}" must provide a summary`);
      }
      const commands = registration.commands ?? [];
      if (!Array.isArray(commands)) {
        throw new Error(`cli command "${name}" commands must be an array`);
      }
      const validatedCommands = commands.map((command, index) => {
        if (
          typeof command?.name !== "string" ||
          !CLI_COMMAND_NAME_PATTERN.test(command.name) ||
          typeof command.summary !== "string" ||
          typeof command.usage !== "string"
        ) {
          throw new Error(
            `cli command "${name}" commands[${index}] must be { name: [a-z0-9-]+, summary, usage }`,
          );
        }
        return {
          name: command.name,
          summary: command.summary,
          usage: command.usage,
        };
      });
      if (typeof registration.run !== "function") {
        throw new Error(
          `cli command "${name}" must provide a run(argv, ctx) function`,
        );
      }
      // One registration per plugin: a second call replaces the first.
      cliRecord.registration = {
        name,
        summary: registration.summary,
        commands: validatedCommands,
        run: registration.run.bind(registration),
      };
    },
  };

  const status: PluginStatusApi = {
    needsConfiguration(message) {
      assertLive();
      reportNeedsConfiguration(
        typeof message === "string" && message.length > 0
          ? message
          : "needs configuration",
      );
    },
  };

  const api: BbPluginApi = {
    pluginId,
    log,
    settings,
    storage,
    http,
    rpc,
    realtime,
    background,
    cli,
    agents,
    ui,
    status,
    get sdk(): BbSdk {
      assertLive();
      const sdk = getSdk();
      if (!sdk) {
        throw new Error(
          "bb.sdk is not available until the server is listening — " +
            "use it inside handlers, services, or timers, not at factory load time",
        );
      }
      wrappedSdk ??= wrapSdkForPlugin(sdk, pluginId);
      return wrappedSdk;
    },
    on(event, handler) {
      assertLive();
      const handlers = threadEventHandlers[event];
      if (handlers === undefined) {
        // Plugin sources are untyped at runtime; fail loudly at registration
        // instead of silently never firing.
        throw new Error(
          `unknown event "${String(event)}" — supported events: ${Object.keys(
            threadEventHandlers,
          ).join(", ")}`,
        );
      }
      handlers.push(handler);
    },
    onDispose(hook) {
      assertLive();
      disposeHooks.push(hook);
    },
  };

  return {
    api,
    disposeHooks,
    settings: settingsRecord,
    sqliteHandles,
    threadEventHandlers,
    httpRoutes,
    rpcHandlers,
    backgroundServices,
    schedules,
    cli: cliRecord,
    contextProviders,
    agentTools,
    threadActions,
    slashCommands,
    mentionProviders,
    invalidate() {
      invalidated = true;
    },
  };
}
