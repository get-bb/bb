import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import {
  deletePluginKvValue,
  getPluginKvValue,
  listPluginKvKeys,
  setPluginKvValue,
  type DbConnection,
} from "@bb/db";
import type {
  BbPluginApi,
  PluginAgentToolContext,
  PluginAgentToolResult,
  PluginAgents,
  PluginBackground,
  PluginCli,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliResult,
  PluginHttp,
  PluginHttpAuthMode,
  PluginHttpHandler,
  PluginKvStorage,
  PluginLogger,
  PluginMentionItem,
  PluginMentionSearchContext,
  PluginRealtime,
  PluginRpc,
  PluginSettingDescriptors,
  PluginSettingValue,
  PluginSettings,
  PluginSettingsValues,
  PluginStatusApi,
  PluginStorage,
  PluginThreadActionContext,
  PluginThreadActionResult,
  PluginThreadEventHandler,
  PluginThreadEventName,
  PluginUi,
} from "@bb/plugin-sdk";
import type { BbSdk, ThreadSpawnArgs } from "@bb/sdk";
import type { ServerLogger } from "../../types.js";
import { appendPluginLogLine } from "./plugin-log.js";
import {
  readPluginSettingsValues,
  registerSettingDescriptors,
} from "./plugin-settings.js";

// The backend plugin API contract lives in @bb/plugin-sdk (plugin authors
// compile against it); this module implements it. Re-exported so server code
// keeps one import site for plugin API types.
export type {
  BbPluginApi,
  PluginAgentToolContentPart,
  PluginAgentToolContext,
  PluginAgentToolRegistrationBase,
  PluginAgentToolResult,
  PluginAgents,
  PluginBackground,
  PluginCli,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
  PluginHttp,
  PluginHttpAuthMode,
  PluginHttpHandler,
  PluginKvStorage,
  PluginLogger,
  PluginMentionItem,
  PluginMentionProviderRegistration,
  PluginMentionSearchContext,
  PluginRealtime,
  PluginRpc,
  PluginSettings,
  PluginSettingsHandle,
  PluginSettingsValues,
  PluginStatusApi,
  PluginStorage,
  PluginThreadActionContext,
  PluginThreadActionRegistration,
  PluginThreadActionResult,
  PluginThreadActionToast,
  PluginThreadEventHandler,
  PluginThreadEventName,
  PluginThreadEventPayloads,
  PluginUi,
} from "@bb/plugin-sdk";

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

/** JSON values ≤256KB; larger writes are rejected with a clear error. */
const KV_VALUE_MAX_BYTES = 256 * 1024;

/** Per-event handler lists recorded by `bb.on`; dropped with the handle. */
export type PluginThreadEventHandlers = {
  [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
};

/**
 * Wire surfaces (design §4.6/§4.7). Registration is load-safe: routes and
 * rpc handlers are recorded on the handle; the boot-time dispatcher in
 * routes/plugins.ts looks them up live per request, so reload swaps them
 * without touching Hono's routing table.
 */
export interface PluginHttpRouteRecord {
  /** Uppercased HTTP method. */
  method: string;
  /** Exact-match path starting with "/" (no params/wildcards in V1). */
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

/** Runtime shape of a registered rpc handler; inputs arrive JSON-parsed. */
export type PluginRpcHandler = (input: unknown) => unknown;

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
  // "automation" is intentionally absent: the builtin automations plugin owns it.
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
  /** Native tools recorded by `bb.agents.registerTool`. */
  agentTools: PluginAgentToolRecord[];
  /** Thread actions recorded by `bb.ui.registerThreadAction`. */
  threadActions: PluginThreadActionRecord[];
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
    "thread.deleted": [],
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

  const agentTools: PluginAgentToolRecord[] = [];
  const agents: PluginAgents = {
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
    agentTools,
    threadActions,
    mentionProviders,
    invalidate() {
      invalidated = true;
    },
  };
}
