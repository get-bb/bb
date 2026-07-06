import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import { Hono } from "hono";
import { z } from "zod";
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
  PluginSettingDescriptor,
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
  PluginThreadEventPayloads,
  PluginUi,
} from "../backend-contract.js";
import {
  createFakeSdk,
  type FakeSdkHarness,
  type FakeSdkOverrides,
} from "./fake-sdk.js";

/**
 * `createFakePluginHost` — an in-process stand-in for the BB server's plugin
 * runtime (apps/server/src/services/plugins/plugin-api.ts), for unit-testing
 * a plugin's `server.ts` without a server. `bb` satisfies {@link BbPluginApi};
 * `harness` drives and inspects it.
 *
 * Faithful where a plugin can observe it: registration name validation and
 * error messages, the kv 256KB cap, append-only sqlite migrations, settings
 * read/update semantics (including onChange), rpc/cli invocation shapes
 * (JSON round-tripping, exit-code normalization), `threads.spawn`
 * attribution, and dispose order (services aborted, hooks LIFO, sqlite
 * closed, stale handles throw).
 *
 * Deliberately different from the real host:
 * - storage is process-local: kv in a Map, `storage.sqlite()` one shared
 *   better-sqlite3 handle in a temp directory (same data across calls, like
 *   the host's shared file), secret settings alongside plain values (no files).
 * - `bb.sdk` is always bound (no listen gate) and every unstubbed method
 *   throws instead of hitting a server.
 * - http auth modes are recorded but not enforced — signature checks and
 *   token handling inside handlers still run.
 * - background services/schedules never run on timers; `harness.runService`
 *   and `harness.runSchedule` invoke them deterministically.
 */

/** Same shape (and name) the real host throws for stale API handles. */
export class PluginContextStaleError extends Error {
  constructor(pluginId: string) {
    super(
      `plugin "${pluginId}" used a stale API handle — it was reloaded or disabled; ` +
        `re-entry happens via a fresh factory call`,
    );
    this.name = "PluginContextStaleError";
  }
}

/** JSON values ≤256KB; larger writes are rejected with a clear error. */
const KV_VALUE_MAX_BYTES = 256 * 1024;

const PLUGIN_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const RPC_METHOD_PATTERN = /^[a-zA-Z0-9_-]+$/;
const BACKGROUND_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;
const AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const THREAD_ACTION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MENTION_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SETTING_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Copies of the server's hand-maintained reserved-name lists
 * (RESERVED_BB_CLI_COMMANDS / RESERVED_AGENT_TOOL_NAMES in
 * apps/server/src/services/plugins/plugin-api.ts) so registrations fail here
 * the same way they fail there. Update alongside the server lists.
 */
const RESERVED_BB_CLI_COMMANDS: readonly string[] = [
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
const RESERVED_AGENT_TOOL_NAMES: readonly string[] = [
  "update_environment_directory",
];

export type FakeLogLevel = "debug" | "info" | "warn" | "error";

export interface FakeLogEntry {
  level: FakeLogLevel;
  message: string;
}

export interface FakeHttpRouteRecord {
  method: string;
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

export interface FakeScheduleRecord {
  name: string;
  cron: string;
  fn: () => void | Promise<void>;
}

export interface FakeServiceRecord {
  name: string;
  start: (signal: AbortSignal) => void | Promise<void>;
}

export interface FakeCliRecord {
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
  run: (
    argv: string[],
    ctx: PluginCliContext,
  ) => PluginCliResult | Promise<PluginCliResult>;
}

export interface FakeAgentToolRecord {
  name: string;
  description: string;
  instructions: string | null;
  /** JSON-schema object the host would send providers. */
  inputSchema: unknown;
  parse(
    input: unknown,
  ): { ok: true; value: unknown } | { ok: false; error: string };
  execute(
    params: unknown,
    ctx: PluginAgentToolContext,
  ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}

export interface FakeThreadActionRecord {
  id: string;
  title: string;
  icon: string | null;
  confirm: string | null;
  run: (
    ctx: PluginThreadActionContext,
  ) => PluginThreadActionResult | Promise<PluginThreadActionResult>;
}

export interface FakeMentionProviderRecord {
  id: string;
  label: string;
  search: (
    ctx: PluginMentionSearchContext,
  ) => PluginMentionItem[] | Promise<PluginMentionItem[]>;
  resolve: (
    itemId: string,
  ) => { context: string } | Promise<{ context: string }>;
}

export interface FakeRealtimeSignal {
  channel: string;
  /** JSON-round-tripped, like the WS broadcast; `undefined` → `null`. */
  payload: unknown;
}

/** Everything the plugin registered, exposed raw for assertions. */
export interface FakePluginRegistrations {
  settingsDescriptors: PluginSettingDescriptors;
  httpRoutes: FakeHttpRouteRecord[];
  rpcMethods: string[];
  services: FakeServiceRecord[];
  schedules: FakeScheduleRecord[];
  cli: FakeCliRecord | null;
  agentTools: FakeAgentToolRecord[];
  threadActions: FakeThreadActionRecord[];
  threadEventHandlers: Record<PluginThreadEventName, number>;
  mentionProviders: FakeMentionProviderRecord[];
}

export interface FakePluginHarness {
  readonly pluginId: string;
  /** Every `bb.log` line, in order. */
  readonly logEntries: FakeLogEntry[];
  /** Every `bb.realtime.publish`, payload normalized like the wire. */
  readonly realtimeSignals: FakeRealtimeSignal[];
  /** Every `bb.status.needsConfiguration` message, in order. */
  readonly needsConfigurationMessages: string[];
  /** Recorded `bb.sdk` calls + stub control. */
  readonly sdk: FakeSdkHarness;
  readonly registrations: FakePluginRegistrations;
  /**
   * Apply a settings update the way the host's settings save does:
   * validate against the declared descriptors (`null` unsets), store, and
   * fire `onChange` listeners when effective values changed. Throws on
   * unknown keys or wrong value types.
   */
  setSettings(
    values: Record<string, PluginSettingValue | null>,
  ): Promise<void>;
  /**
   * Invoke a registered rpc method with host semantics: the input and the
   * result are JSON-round-tripped, and a handler failure rejects with an
   * `Error` carrying the handler's message (what the frontend rpc client
   * would surface). Throws for unregistered methods.
   */
  callRpc(method: string, input?: unknown): Promise<unknown>;
  /**
   * Invoke the plugin's CLI command with host semantics: the result's
   * exitCode must be a number, stdout/stderr default to "", and a throwing
   * run() becomes `{ exitCode: 1, stderr: "bb <name> failed: …" }`.
   */
  runCli(argv: string[], ctx?: PluginCliContext): Promise<PluginCliResult>;
  /**
   * Dispatch a request to a registered `bb.http` route (exact method+path
   * match, like the host's V1 router) through a real Hono context. Auth
   * modes are not enforced. A throwing handler yields the host's 500
   * `{ ok: false, error: "plugin route failed: …" }` response.
   */
  fetchHttp(
    method: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
  /**
   * Start a registered background service once, deterministically. `done`
   * settles when `start` returns; abort `controller` to signal shutdown.
   * A thrown NeedsConfigurationError (matched by name, like the host) is
   * recorded via needsConfiguration and resolves `done`; other errors
   * reject it.
   */
  runService(name: string): { controller: AbortController; done: Promise<void> };
  /** Run a registered schedule's function once (no timers, no cron sweep). */
  runSchedule(name: string): Promise<void>;
  /**
   * Deliver a thread lifecycle event to every `bb.on` handler. Handlers run
   * sequentially; errors are caught and logged like the host's
   * fire-and-forget dispatch, and returned for assertions.
   */
  emitThreadEvent<E extends PluginThreadEventName>(
    event: E,
    payload: PluginThreadEventPayloads[E],
  ): Promise<{ errors: unknown[] }>;
  /**
   * Call a registered agent tool the way a provider tool-call would:
   * arguments go through the tool's parse step (zod-validated for zod
   * registrations; a parse failure throws), then execute. `ctx` fields
   * default to "thread-test"/"project-test" and a fresh signal.
   */
  callAgentTool(
    name: string,
    input: unknown,
    ctx?: Partial<PluginAgentToolContext>,
  ): Promise<PluginAgentToolResult>;
  /**
   * Dispose like a host reload/disable: abort services started via
   * runService, run onDispose hooks LIFO (isolated), close sqlite handles,
   * then poison the `bb` handle (further use throws
   * PluginContextStaleError). Idempotent.
   */
  dispose(): Promise<void>;
}

export interface CreateFakePluginHostOptions {
  /** Defaults to "test-plugin". */
  pluginId?: string;
  /**
   * Pre-seeded stored settings values (as if saved before this load) —
   * including secret ones, which the fake keeps in memory instead of
   * files. Values with the wrong type for their descriptor fall back to
   * the descriptor default on read, like the host.
   */
  settings?: Record<string, PluginSettingValue>;
  /** Initial `bb.sdk` stubs; extend later via `harness.sdk.stub`. */
  sdk?: FakeSdkOverrides;
}

export interface FakePluginHost {
  bb: BbPluginApi;
  harness: FakePluginHarness;
}

// ---------------------------------------------------------------------------
// Settings descriptor validation — ported from the server's
// plugin-settings.ts so plugins trip over the same errors here.
// ---------------------------------------------------------------------------

const settingsBaseFields = {
  label: z.string().min(1),
  description: z.string().min(1).optional(),
};

const settingDescriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      ...settingsBaseFields,
      secret: z.literal(true).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("boolean"),
      ...settingsBaseFields,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      ...settingsBaseFields,
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project"),
      ...settingsBaseFields,
      default: z.string().optional(),
    })
    .strict(),
]);

function registerSettingDescriptors(
  target: PluginSettingDescriptors,
  added: Record<string, unknown>,
): PluginSettingDescriptors {
  const validated: PluginSettingDescriptors = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" — use letters, digits, "-" and "_"`,
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    const parsed = settingDescriptorSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `invalid descriptor for setting "${key}"${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`,
      );
    }
    const descriptor = parsed.data;
    if (
      descriptor.type === "select" &&
      descriptor.default !== undefined &&
      !descriptor.options.includes(descriptor.default)
    ) {
      throw new Error(
        `default for setting "${key}" must be one of its options`,
      );
    }
    validated[key] = descriptor;
  }
  Object.assign(target, validated);
  return validated;
}

/** Effective typed values: stored value when valid, else the default, else undefined. */
function readSettingsValues(
  descriptors: PluginSettingDescriptors,
  stored: Map<string, PluginSettingValue>,
): Record<string, PluginSettingValue | undefined> {
  const values: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    let value = stored.get(key);
    const expected = descriptor.type === "boolean" ? "boolean" : "string";
    if (typeof value !== expected) value = undefined;
    if (
      descriptor.type === "select" &&
      typeof value === "string" &&
      !descriptor.options.includes(value)
    ) {
      value = undefined;
    }
    values[key] = value ?? descriptor.default;
  }
  return values;
}

function validateSettingsUpdate(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor: PluginSettingDescriptor | undefined = descriptors[key];
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue; // unset
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------

function isNeedsConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}

/** Duck-typed zod detection, same as the host (plugins may carry their own zod). */
function isZodSchemaLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonRoundTrip(value: unknown, what: string): unknown {
  if (value === undefined) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (json === undefined) {
    throw new Error(`${what} is not JSON-serializable`);
  }
  return JSON.parse(json);
}

export function createFakePluginHost(
  options: CreateFakePluginHostOptions = {},
): FakePluginHost {
  const pluginId = options.pluginId ?? "test-plugin";
  let invalidated = false;
  let disposed = false;

  function assertLive(): void {
    if (invalidated) throw new PluginContextStaleError(pluginId);
  }

  // --- log ---
  const logEntries: FakeLogEntry[] = [];
  function emitLog(level: FakeLogLevel, message: string): void {
    logEntries.push({ level, message });
  }
  const log: PluginLogger = {
    debug: (message) => emitLog("debug", message),
    info: (message) => emitLog("info", message),
    warn: (message) => emitLog("warn", message),
    error: (message) => emitLog("error", message),
  };

  // --- storage ---
  const kvRows = new Map<string, string>();
  const kv: PluginKvStorage = {
    async get(key) {
      assertLive();
      const raw = kvRows.get(key);
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
      kvRows.set(key, json);
    },
    async delete(key) {
      assertLive();
      kvRows.delete(key);
    },
    async list(prefix) {
      assertLive();
      return [...kvRows.keys()]
        .filter((key) => prefix === undefined || key.startsWith(prefix))
        .sort();
    },
  };

  const storageRoot = mkdtempSync(join(tmpdir(), "bb-fake-plugin-host-"));

  // One shared temp-file handle: every sqlite() call sees the same data,
  // like the host's handles over one on-disk file.
  let sqliteHandle: Database.Database | undefined;
  const storage: PluginStorage = {
    kv,
    sqlite() {
      assertLive();
      if (!sqliteHandle) {
        sqliteHandle = new Database(join(storageRoot, "data.db"));
        sqliteHandle.pragma("busy_timeout = 5000");
      }
      return sqliteHandle;
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

  // --- settings ---
  const settingsDescriptors: PluginSettingDescriptors = {};
  const settingsListeners: Array<
    (
      next: Record<string, PluginSettingValue | undefined>,
      prev: Record<string, PluginSettingValue | undefined>,
    ) => void
  > = [];
  const storedSettings = new Map<string, PluginSettingValue>(
    Object.entries(options.settings ?? {}),
  );

  const settings: PluginSettings = {
    define(descriptors) {
      assertLive();
      registerSettingDescriptors(
        settingsDescriptors,
        descriptors as Record<string, unknown>,
      );
      type Values = PluginSettingsValues<typeof descriptors>;
      return {
        async get() {
          assertLive();
          return readSettingsValues(
            settingsDescriptors,
            storedSettings,
          ) as Values;
        },
        onChange(listener) {
          assertLive();
          settingsListeners.push(
            listener as (typeof settingsListeners)[number],
          );
        },
      };
    },
  };

  // --- http ---
  const httpRoutes: FakeHttpRouteRecord[] = [];
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

  // --- rpc ---
  const rpcHandlers = new Map<string, (input: unknown) => unknown>();
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
        rpcHandlers.set(name, handler as (input: unknown) => unknown);
      }
    },
  };

  // --- realtime ---
  const realtimeSignals: FakeRealtimeSignal[] = [];
  const realtime: PluginRealtime = {
    publish(channel, payload) {
      assertLive();
      if (typeof channel !== "string" || channel.length === 0) {
        throw new Error("realtime channel must be a non-empty string");
      }
      const normalized =
        payload === undefined
          ? null
          : (jsonRoundTrip(
              payload,
              `realtime payload for channel "${channel}"`,
            ) ?? null);
      realtimeSignals.push({ channel, payload: normalized });
    },
  };

  // --- background ---
  const services: FakeServiceRecord[] = [];
  const schedules: FakeScheduleRecord[] = [];
  const background: PluginBackground = {
    service(name, service) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid service name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (services.some((record) => record.name === name)) {
        throw new Error(`background service "${name}" is already registered`);
      }
      if (typeof service?.start !== "function") {
        throw new Error(
          `background service "${name}" must provide a start(signal) function`,
        );
      }
      services.push({ name, start: service.start.bind(service) });
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
          `invalid cron ${JSON.stringify(cron)} for schedule "${name}": ${errorMessage(error)}`,
        );
      }
      if (typeof fn !== "function") {
        throw new Error(`schedule "${name}" must provide a function`);
      }
      schedules.push({ name, cron: String(cron), fn });
    },
  };

  // --- cli ---
  const cliRecord: { registration: FakeCliRecord | null } = {
    registration: null,
  };
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
      cliRecord.registration = {
        name,
        summary: registration.summary,
        commands: validatedCommands,
        run: registration.run.bind(registration),
      };
    },
  };

  // --- agents ---
  const agentTools: FakeAgentToolRecord[] = [];
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
      let parse: FakeAgentToolRecord["parse"];
      if (isZodSchemaLike(parameters)) {
        try {
          inputSchema = z.toJSONSchema(parameters as z.ZodType, {
            io: "input",
          });
        } catch (error) {
          throw new Error(
            `tool "${name}" parameters look like a zod schema but could not be converted to JSON Schema (${errorMessage(error)}) — use zod 4, or pass a plain JSON-schema object`,
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
      const record: FakeAgentToolRecord = {
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

  // --- ui ---
  const threadActions: FakeThreadActionRecord[] = [];
  const mentionProviders: FakeMentionProviderRecord[] = [];
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

  // --- status ---
  const needsConfigurationMessages: string[] = [];
  const status: PluginStatusApi = {
    needsConfiguration(message) {
      assertLive();
      needsConfigurationMessages.push(
        typeof message === "string" && message.length > 0
          ? message
          : "needs configuration",
      );
    },
  };

  // --- sdk ---
  const { sdk, harness: sdkHarness } = createFakeSdk({
    pluginId,
    overrides: options.sdk,
  });

  // --- thread events / dispose ---
  const threadEventHandlers: {
    [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
  } = {
    "thread.created": [],
    "thread.idle": [],
    "thread.failed": [],
    "thread.deleted": [],
  };
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const serviceControllers: AbortController[] = [];

  const bb: BbPluginApi = {
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
    get sdk() {
      assertLive();
      return sdk;
    },
    on(event, handler) {
      assertLive();
      const handlers = threadEventHandlers[event];
      if (handlers === undefined) {
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

  const harness: FakePluginHarness = {
    pluginId,
    logEntries,
    realtimeSignals,
    needsConfigurationMessages,
    sdk: sdkHarness,
    registrations: {
      settingsDescriptors,
      httpRoutes,
      get rpcMethods() {
        return [...rpcHandlers.keys()];
      },
      services,
      schedules,
      get cli() {
        return cliRecord.registration;
      },
      agentTools,
      threadActions,
      get threadEventHandlers() {
        return {
          "thread.created": threadEventHandlers["thread.created"].length,
          "thread.idle": threadEventHandlers["thread.idle"].length,
          "thread.failed": threadEventHandlers["thread.failed"].length,
          "thread.deleted": threadEventHandlers["thread.deleted"].length,
        };
      },
      mentionProviders,
    },

    async setSettings(values) {
      const errors = validateSettingsUpdate(settingsDescriptors, values);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }
      const prev = readSettingsValues(settingsDescriptors, storedSettings);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) storedSettings.delete(key);
        else storedSettings.set(key, value);
      }
      const next = readSettingsValues(settingsDescriptors, storedSettings);
      if (JSON.stringify(next) === JSON.stringify(prev)) return;
      for (const listener of settingsListeners) {
        try {
          listener(next, prev);
        } catch (error) {
          emitLog(
            "warn",
            `settings onChange listener failed: ${errorMessage(error)}`,
          );
        }
      }
    },

    async callRpc(method, input) {
      const handler = rpcHandlers.get(method);
      if (!handler) {
        throw new Error(`plugin "${pluginId}" has no rpc method "${method}"`);
      }
      const parsedInput =
        input === undefined
          ? undefined
          : jsonRoundTrip(input, `rpc "${method}" input`);
      const result = await handler(parsedInput);
      // Same round-trip as the dispatcher: a bigint/circular result is this
      // call's clear error, not a serializer crash later.
      const json = JSON.stringify(result);
      return json === undefined ? undefined : (JSON.parse(json) as unknown);
    },

    async runCli(argv, ctx = {}) {
      const registration = cliRecord.registration;
      if (!registration) {
        throw new Error(`plugin "${pluginId}" registers no CLI command`);
      }
      try {
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
      } catch (error) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `bb ${registration.name} failed: ${errorMessage(error)}`,
        };
      }
    },

    async fetchHttp(method, path, init) {
      const normalizedMethod = String(method).toUpperCase();
      const pathname = new URL(path, "http://plugin.test").pathname;
      const route = httpRoutes.find(
        (candidate) =>
          candidate.method === normalizedMethod &&
          candidate.path === pathname,
      );
      if (!route) {
        throw new Error(
          `no http route ${normalizedMethod} ${pathname} is registered — ` +
            `registered: ${
              httpRoutes.map((r) => `${r.method} ${r.path}`).join(", ") ||
              "(none)"
            }`,
        );
      }
      const app = new Hono();
      app.on(route.method, route.path, async (context) => {
        try {
          const response = await route.handler(context);
          if (!(response instanceof Response)) {
            throw new Error("http route handler must return a Response");
          }
          return response;
        } catch (error) {
          const message = errorMessage(error);
          emitLog(
            "warn",
            `http ${route.method} ${route.path} failed: ${message}`,
          );
          return context.json(
            { ok: false, error: `plugin route failed: ${message}` },
            500,
          );
        }
      });
      return app.request(path, { ...init, method: normalizedMethod });
    },

    runService(name) {
      const service = services.find((record) => record.name === name);
      if (!service) {
        throw new Error(`no background service "${name}" is registered`);
      }
      const controller = new AbortController();
      serviceControllers.push(controller);
      // start() runs synchronously (like the host's post-factory start), so
      // it observes an abort() issued right after runService returns.
      let started: Promise<void>;
      try {
        started = Promise.resolve(service.start(controller.signal)).then(
          () => undefined,
        );
      } catch (error) {
        started = Promise.reject(error);
      }
      const done = started.catch((error: unknown) => {
        if (isNeedsConfigurationError(error)) {
          needsConfigurationMessages.push(error.message);
          return undefined;
        }
        throw error;
      });
      return { controller, done };
    },

    async runSchedule(name) {
      const schedule = schedules.find((record) => record.name === name);
      if (!schedule) {
        throw new Error(`no schedule "${name}" is registered`);
      }
      await schedule.fn();
    },

    async emitThreadEvent(event, payload) {
      const errors: unknown[] = [];
      for (const handler of [...threadEventHandlers[event]]) {
        try {
          await handler(payload);
        } catch (error) {
          errors.push(error);
          emitLog("warn", `${event} handler failed: ${errorMessage(error)}`);
        }
      }
      return { errors };
    },

    async callAgentTool(name, input, ctx) {
      const record = agentTools.find((tool) => tool.name === name);
      if (!record) {
        throw new Error(`no agent tool "${name}" is registered`);
      }
      const parsed = record.parse(input);
      if (!parsed.ok) {
        throw new Error(`tool "${name}" arguments are invalid: ${parsed.error}`);
      }
      return record.execute(parsed.value, {
        threadId: ctx?.threadId ?? "thread-test",
        projectId: ctx?.projectId ?? "project-test",
        signal: ctx?.signal ?? new AbortController().signal,
      });
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      // Host order (§3): services first, then hooks LIFO (isolated), then
      // vended sqlite handles, then handle invalidation.
      for (const controller of serviceControllers) controller.abort();
      for (const hook of [...disposeHooks].reverse()) {
        try {
          await hook();
        } catch (error) {
          emitLog("warn", `dispose hook failed: ${errorMessage(error)}`);
        }
      }
      if (sqliteHandle) {
        try {
          sqliteHandle.close();
        } catch (error) {
          emitLog("warn", `sqlite close failed: ${errorMessage(error)}`);
        }
      }
      rmSync(storageRoot, { recursive: true, force: true });
      invalidated = true;
    },
  };

  return { bb, harness };
}
