import { createHash } from "node:crypto";
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
import {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "@bb/domain";
import type {
  BbPluginApi,
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgentToolContext,
  PluginAgentToolPresentation,
  PluginAgentToolResult,
  PluginAgents,
  PluginBackground,
  PluginCli,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliResult,
  PluginEvents,
  PluginHttp,
  PluginHttpAuthMode,
  PluginHttpHandler,
  PluginHosts,
  PluginKvStorage,
  PluginLogger,
  PluginMentionItem,
  PluginMentionSearchContext,
  PluginMentionTrigger,
  PluginAiServiceDeclaration,
  PluginAiServices,
  PluginProviderDeclaration,
  PluginProviders,
  PluginRealtime,
  PluginRpc,
  PluginServerApi,
  PluginSettingDescriptors,
  PluginSettingValue,
  PluginSettings,
  PluginSettingsValues,
  PluginStatusApi,
  PluginStorage,
  PluginThreadEventHandler,
  PluginThreadEventName,
  PluginUi,
  StandardSchemaV1,
  PluginRpcContract,
  PluginRpcHandlers,
} from "@get-bb/plugin-sdk";
import {
  AGENT_TOOL_NAME_PATTERN,
  assertNoRecursiveJsonSchemaReferences,
  BACKGROUND_NAME_PATTERN,
  CLI_COMMAND_NAME_PATTERN,
  isZodSchemaLike,
  KV_VALUE_MAX_BYTES,
  MENTION_PROVIDER_ID_PATTERN,
  normalizeMentionProviderTriggers,
  PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS,
  PLUGIN_HTTP_METHODS,
  parsePluginAgentToolPresentation,
  pluginCliCollisionWarning,
  readRpcMethodContract,
  registerSettingDescriptors,
  rejectStaleAgentToolFields,
  RESERVED_AGENT_TOOL_NAMES,
  RPC_METHOD_PATTERN,
  isStandardSchema,
  summarizeParseIssues,
  agentToolIconRefusalMessage,
  aiServiceAlreadyRegisteredMessage,
  providerAlreadyRegisteredMessage,
  providerIconRefusalMessage,
  undeclaredIconProblem,
  validatePluginAiServiceDeclaration,
  validatePluginProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  AiServiceHostBinding,
  NormalizedPluginProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import type { BbSdk, ThreadForkArgs, ThreadSpawnArgs } from "@bb/sdk";
import type { ServerLogger } from "../../types.js";
import type { PluginInteractionResult } from "../interactions/pending-interactions.js";
import { appendPluginLogLine } from "./plugin-log.js";
import type {
  PluginHostArtifactSnapshot,
  PluginHostCallResult,
} from "./plugin-service-internal.js";
import { readPluginSettingsValues } from "./plugin-settings.js";

const LEGACY_UNKNOWN_MIGRATION_HASH = "legacy-unknown";

function migrationStatementHash(statement: string): string {
  return createHash("sha256").update(statement).digest("hex");
}
const { mkdirSync } = process.getBuiltinModule("node:fs");

export type {
  BbPluginApi,
  PluginAgentConfigurationContext,
  PluginAgentToolContext,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginMentionTrigger,
  PluginThreadEventName,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";

class PluginContextStaleError extends Error {
  constructor(pluginId: string) {
    super(
      `plugin "${pluginId}" used a stale API handle — it was reloaded or disabled; ` +
        `re-entry happens via a fresh factory call`,
    );
    this.name = "PluginContextStaleError";
  }
}

export function isNeedsConfigurationError(cause: unknown): cause is Error {
  return cause instanceof Error && cause.name === "NeedsConfigurationError";
}

type PluginThreadEventHandlers = {
  [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
};

export interface PluginHttpRouteRecord {
  method: string;
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

export interface PluginRpcHandler {
  inputSchema: StandardSchemaV1;
  outputSchema: StandardSchemaV1;
  handler: PluginRpcHandlers<PluginRpcContract>[string];
}

type PluginAgentToolValue = z.output<z.ZodType>;
type PluginAgentToolRegistration = Parameters<PluginAgents["registerTool"]>[0];
type PluginSignalPayload = Parameters<PluginRealtime["publish"]>[1];
type PluginHostCallInput = Parameters<
  PluginRpcHandlers<PluginRpcContract>[string]
>[0];

type PluginAgentToolParseResult =
  | { ok: true; value: PluginAgentToolValue }
  | { ok: false; error: string };

const pluginRecordSchema = z.object({}).passthrough();
const pluginFunctionSchema = z.function();

export interface PluginAgentToolRecord {
  name: string;
  description: string;
  presentation: PluginAgentToolPresentation | null;
  instructions: string | null;
  inputSchema: JsonValue;
  parse(input: PluginAgentToolValue): PluginAgentToolParseResult;
  execute(
    params: PluginAgentToolValue,
    ctx: PluginAgentToolContext,
  ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}

export { RESERVED_AGENT_TOOL_NAMES };

interface PluginMentionProviderRecord {
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
  search: (
    ctx: PluginMentionSearchContext,
  ) => PluginMentionItem[] | Promise<PluginMentionItem[]>;
  resolve: (
    itemId: string,
  ) => { context: string } | Promise<{ context: string }>;
}

interface StagedRegistrationEntry<TNormalized, TBinding> {
  declaration: TNormalized;
  binding: TBinding;
  disposer: { dispose(): void } | null;
  disposed: boolean;
}

interface StagedRegistrations<
  TDeclaration,
  TNormalized extends { id: string },
> {
  register(declaration: TDeclaration): { dispose(): void };
  flush(): void;
  values(): TNormalized[];
}

export interface PluginBackgroundServiceRecord {
  name: string;
  start: (signal: AbortSignal) => void | Promise<void>;
}

interface PluginScheduleRecord {
  name: string;
  cron: string;
  fn: () => void | Promise<void>;
}

interface PluginCliRegistrationRecord {
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
  run: (
    argv: string[],
    ctx: PluginCliContext,
  ) => PluginCliResult | Promise<PluginCliResult>;
}

type PluginSettingsListener = (
  next: Record<string, PluginSettingValue | undefined>,
  prev: Record<string, PluginSettingValue | undefined>,
) => void;

export interface PluginApiHandle {
  api: BbPluginApi;
  disposeHooks: Array<() => void | Promise<void>>;
  settings: {
    descriptors: PluginSettingDescriptors;
    listeners: PluginSettingsListener[];
  };
  databaseHandles: Database.Database[];
  threadEventHandlers: PluginThreadEventHandlers;
  httpRoutes: PluginHttpRouteRecord[];
  rpcHandlers: Map<string, PluginRpcHandler>;
  hostWorkerExitHandlers: PluginHostWorkerExitHandler[];
  hostSignalHandlers: PluginHostSignalHandler[];
  backgroundServices: PluginBackgroundServiceRecord[];
  schedules: PluginScheduleRecord[];
  cli: { registration: PluginCliRegistrationRecord | null };
  agentTools: PluginAgentToolRecord[];
  listProviderDeclarations(): NormalizedPluginProviderDeclaration[];
  agentConfigurationProvider: PluginAgentConfigurationProvider | null;
  instructionProvider: PluginInstructionProvider | null;
  mentionProviders: PluginMentionProviderRecord[];
  activate(): void;
  invalidate(): void;
}

type PluginHostWorkerExitHandler = (event: {
  hostId: string;
}) => void | Promise<void>;

interface PluginHostSignalHandler {
  signal: string;
  payloadSchema: StandardSchemaV1;
  handler: (event: {
    hostId: string;
    payload: unknown;
  }) => void | Promise<void>;
}

type PluginInstructionProvider = (ctx: {
  threadId: string;
  projectId: string;
}) => string | null;

type PluginAgentConfigurationProvider = (
  context: PluginAgentConfigurationContext,
) => PluginAgentConfiguration;

function wrapSdkForPlugin(sdk: BbSdk, pluginId: string): BbSdk {
  return {
    ...sdk,
    threads: {
      ...sdk.threads,
      fork(args: ThreadForkArgs) {
        const origin = args.origin ?? "plugin";
        const forkArgs = {
          ...args,
          origin,
        };
        if (origin === "plugin") {
          forkArgs.originPluginId = args.originPluginId ?? pluginId;
        }
        return sdk.threads.fork(forkArgs);
      },
      spawn(args: ThreadSpawnArgs) {
        const origin = args.origin ?? "plugin";
        const spawnArgs = {
          ...args,
          origin,
        };
        if (origin === "plugin") {
          spawnArgs.originPluginId = args.originPluginId ?? pluginId;
        }
        return sdk.threads.spawn(spawnArgs);
      },
    },
  };
}

function createStagedRegistrations<
  TDeclaration,
  TNormalized extends { id: string },
  TBinding,
>(options: {
  validate: (declaration: TDeclaration) => TNormalized;
  bind: (id: string) => TBinding;
  isTaken: (id: string) => boolean;
  registerLive: (
    declaration: TNormalized,
    binding: TBinding,
  ) => { dispose(): void };
  alreadyRegisteredMessage: (id: string) => string;
  assertLive: () => void;
  isActivated: () => boolean;
  disposeHooks: Array<() => void | Promise<void>>;
}): StagedRegistrations<TDeclaration, TNormalized> {
  const entries = new Map<
    string,
    StagedRegistrationEntry<TNormalized, TBinding>
  >();
  return {
    register(declaration) {
      options.assertLive();
      const normalized = options.validate(declaration);
      const binding = options.bind(normalized.id);
      if (entries.has(normalized.id)) {
        throw new Error(options.alreadyRegisteredMessage(normalized.id));
      }
      const entry: StagedRegistrationEntry<TNormalized, TBinding> = {
        declaration: normalized,
        binding,
        disposer: null,
        disposed: false,
      };
      if (options.isActivated()) {
        entry.disposer = options.registerLive(normalized, binding);
      } else if (options.isTaken(normalized.id)) {
        throw new Error(options.alreadyRegisteredMessage(normalized.id));
      }
      entries.set(normalized.id, entry);
      const dispose = (): void => {
        if (entry.disposed) return;
        entry.disposed = true;
        entry.disposer?.dispose();
        if (entries.get(normalized.id) === entry) {
          entries.delete(normalized.id);
        }
      };
      options.disposeHooks.push(dispose);
      return { dispose };
    },
    flush() {
      for (const entry of entries.values()) {
        if (!entry.disposed && entry.disposer === null) {
          entry.disposer = options.registerLive(
            entry.declaration,
            entry.binding,
          );
        }
      }
    },
    values() {
      return [...entries.values()].map((entry) => entry.declaration);
    },
  };
}

export function createPluginApi(options: {
  pluginId: string;
  logger: ServerLogger;
  db: DbConnection;
  dataDir: string;
  getSdk: () => BbSdk | undefined;
  getLoopbackBaseUrl: () => string | undefined;
  publishSignal: (channel: string, payload: PluginSignalPayload) => void;
  reportNeedsConfiguration: (message: string) => void;
  isAgentToolNameTaken: (name: string) => string | undefined;
  reportAgentToolProblem: (message: string) => void;
  declaredIconNames: ReadonlySet<string>;
  requestInteraction: (args: {
    threadId: string;
    rendererId: string;
    title: string;
    payload: JsonValue;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<PluginInteractionResult>;
  ensureSharedPortTunnel: PluginHosts["ensureSharedPortTunnel"];
  validateSharedPortDeclaration: (
    hostId: string,
    ports: readonly number[],
  ) => readonly number[];
  declareSharedPorts: PluginHosts["declareSharedPorts"];
  replaceDeclaredSharedPorts: (
    declarations: readonly {
      hostId: string;
      ports: readonly number[];
    }[],
  ) => void;
  callPluginHost: (args: {
    contract: PluginRpcContract;
    method: string;
    input: PluginHostCallInput;
    hostId: string;
    signal?: AbortSignal;
  }) => Promise<PluginHostCallResult>;
  registerProvider: (declaration: NormalizedPluginProviderDeclaration) => {
    dispose(): void;
  };
  registerAiService: (
    declaration: PluginAiServiceDeclaration,
    binding: AiServiceHostBinding<PluginHostArtifactSnapshot>,
  ) => {
    dispose(): void;
  };
  isProviderIdTaken: (providerId: string) => boolean;
  isAiServiceIdTaken: (serviceId: string) => boolean;
  assertAiServiceRegistrable: (
    serviceId: string,
  ) => AiServiceHostBinding<PluginHostArtifactSnapshot>;
  assertProviderRegistrable: (providerId: string) => void;
}): PluginApiHandle {
  const {
    pluginId,
    logger,
    db,
    dataDir,
    getSdk,
    getLoopbackBaseUrl,
    publishSignal,
    reportNeedsConfiguration,
    isAgentToolNameTaken,
    reportAgentToolProblem,
    declaredIconNames,
    requestInteraction,
    ensureSharedPortTunnel,
    validateSharedPortDeclaration,
    declareSharedPorts,
    replaceDeclaredSharedPorts,
    callPluginHost,
    registerProvider,
    registerAiService,
    isProviderIdTaken,
    assertProviderRegistrable,
    isAiServiceIdTaken,
    assertAiServiceRegistrable,
  } = options;
  let invalidated = false;
  let activated = false;
  let wrappedSdk: BbSdk | undefined;
  let pendingNeedsConfiguration: string | null = null;
  const pendingAgentToolProblems: string[] = [];
  const pendingSharedPorts = new Map<string, readonly number[]>();
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const settingsRecord: PluginApiHandle["settings"] = {
    descriptors: {},
    listeners: [],
  };
  const databaseHandles: Database.Database[] = [];
  const threadEventHandlers: PluginThreadEventHandlers = {
    "thread.created": [],
    "thread.active": [],
    "thread.idle": [],
    "thread.failed": [],
    "thread.archived": [],
    "thread.deleted": [],
  };
  const httpRoutes: PluginHttpRouteRecord[] = [];
  const rpcHandlers = new Map<string, PluginRpcHandler>();
  const hostWorkerExitHandlers: PluginHostWorkerExitHandler[] = [];
  const hostSignalHandlers: PluginHostSignalHandler[] = [];
  const backgroundServices: PluginBackgroundServiceRecord[] = [];
  const schedules: PluginScheduleRecord[] = [];

  function assertLive(): void {
    if (invalidated) throw new PluginContextStaleError(pluginId);
  }

  const prefix = `[plugin:${pluginId}]`;
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

  async function requestInput(
    request: Parameters<PluginUi["requestInput"]>[0],
    requestOptions?: Parameters<PluginUi["requestInput"]>[1],
  ) {
    assertLive();
    if (!pluginRecordSchema.safeParse(request).success) {
      throw new Error("ui.requestInput requires an options object");
    }
    if (
      !z.string().safeParse(request.threadId).success ||
      request.threadId.length === 0
    ) {
      throw new Error("ui.requestInput threadId must be a non-empty string");
    }
    if (
      !z.string().safeParse(request.rendererId).success ||
      !/^[a-zA-Z0-9_-]+$/.test(request.rendererId)
    ) {
      throw new Error(
        "ui.requestInput rendererId must use letters, digits, '-' or '_'",
      );
    }
    if (
      !z.string().safeParse(request.title).success ||
      request.title.trim().length === 0 ||
      request.title.trim().length > PLUGIN_INTERACTION_MAX_TITLE_LENGTH
    ) {
      throw new Error(
        `ui.requestInput title must be 1-${PLUGIN_INTERACTION_MAX_TITLE_LENGTH} characters`,
      );
    }
    let payload: JsonValue;
    try {
      const json = JSON.stringify(request.payload);
      if (json === undefined) throw new Error();
      if (
        Buffer.byteLength(json, "utf8") > PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES
      ) {
        throw new Error("ui.requestInput payload exceeds 64 KiB");
      }
      payload = jsonValueSchema.parse(JSON.parse(json));
    } catch (error) {
      if (error instanceof Error && error.message.includes("64 KiB"))
        throw error;
      throw new Error("ui.requestInput payload must be JSON-serializable");
    }
    const timeoutMs = request.timeoutMs ?? 10 * 60 * 1000;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 60 * 60 * 1000
    ) {
      throw new Error(
        "ui.requestInput timeoutMs must be between 1 and 3600000",
      );
    }
    return requestInteraction({
      threadId: request.threadId,
      rendererId: request.rendererId,
      title: request.title.trim(),
      payload,
      timeoutMs,
      signal: requestOptions?.signal,
    });
  }

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
            `Store large data in storage.database() instead.`,
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

  let databaseHandle: Database.Database | undefined;
  const storage: PluginStorage = {
    kv,
    database() {
      assertLive();
      if (databaseHandle?.open) return databaseHandle;
      if (databaseHandle) {
        const index = databaseHandles.indexOf(databaseHandle);
        if (index !== -1) databaseHandles.splice(index, 1);
      }
      const dir = join(dataDir, "plugins", pluginId);
      mkdirSync(dir, { recursive: true });
      const database = new Database(join(dir, "data.db"));
      database.pragma("journal_mode = WAL");
      database.pragma("busy_timeout = 5000");
      databaseHandle = database;
      databaseHandles.push(database);
      return database;
    },
    migrate(database, statements) {
      assertLive();
      database.exec(
        "CREATE TABLE IF NOT EXISTS _bb_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, statement_hash TEXT)",
      );
      const migrationColumns = database
        .prepare<[], { name: string }>("PRAGMA table_info(_bb_migrations)")
        .all();
      if (
        !migrationColumns.some((column) => column.name === "statement_hash")
      ) {
        database.exec(
          "ALTER TABLE _bb_migrations ADD COLUMN statement_hash TEXT",
        );
      }
      const rows = database
        .prepare<[], { id: number; statement_hash: string | null }>(
          "SELECT id, statement_hash FROM _bb_migrations ORDER BY id",
        )
        .all();
      const applied = new Map<number, string | null>();
      for (const row of rows) applied.set(row.id, row.statement_hash);
      const statementHashes = statements.map(migrationStatementHash);
      statementHashes.forEach((statementHash, index) => {
        const recordedHash = applied.get(index);
        if (
          recordedHash !== undefined &&
          recordedHash !== null &&
          recordedHash !== statementHash
        ) {
          throw new Error(
            `migration ${index} does not match the recorded statement; append a new migration instead of changing or reusing an index`,
          );
        }
      });
      const adopt = database.prepare(
        "UPDATE _bb_migrations SET statement_hash = ? WHERE id = ? AND statement_hash IS NULL",
      );
      const record = database.prepare(
        "INSERT INTO _bb_migrations (id, applied_at, statement_hash) VALUES (?, ?, ?)",
      );
      database.transaction(() => {
        for (const row of rows) {
          if (row.statement_hash !== null) continue;
          adopt.run(
            statementHashes[row.id] ?? LEGACY_UNKNOWN_MIGRATION_HASH,
            row.id,
          );
        }
        statements.forEach((statement, index) => {
          if (applied.has(index)) return;
          database.exec(statement);
          record.run(index, Date.now(), statementHashes[index]);
        });
      })();
    },
  };

  const settings: PluginSettings = {
    define(descriptors) {
      assertLive();
      const validated = registerSettingDescriptors(
        settingsRecord.descriptors,
        descriptors,
      );
      type Values = PluginSettingsValues<typeof descriptors>;
      return {
        async get() {
          assertLive();
          // SAFETY: The validated descriptors determine the exact settings value shape.
          return (await readPluginSettingsValues({
            db,
            dataDir,
            pluginId,
            descriptors: validated,
          })) as Values;
        },
        onChange(listener) {
          assertLive();
          // SAFETY: The listener receives the same validated descriptor values as the settings handle.
          settingsRecord.listeners.push(listener as PluginSettingsListener);
        },
      };
    },
  };

  const http: PluginHttp = {
    route(method, path, handler, opts) {
      assertLive();
      const normalizedMethod = String(method).toUpperCase();
      if (!PLUGIN_HTTP_METHODS.has(normalizedMethod)) {
        throw new Error(
          `invalid http method "${String(method)}" — use one of: ${[...PLUGIN_HTTP_METHODS].join(", ")}`,
        );
      }
      if (!z.string().safeParse(path).success || !path.startsWith("/")) {
        throw new Error(
          `http route path must be a string starting with "/", got ${JSON.stringify(path)}`,
        );
      }
      if (!pluginFunctionSchema.safeParse(handler).success) {
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
    register(contract, handlers) {
      assertLive();
      if (!pluginRecordSchema.safeParse(contract).success) {
        throw new Error("rpc.register contract must be an object");
      }
      if (!pluginRecordSchema.safeParse(handlers).success) {
        throw new Error("rpc.register handlers must be an object");
      }
      const pending: Array<[string, PluginRpcHandler]> = [];
      const contractEntries = Object.entries(contract);
      const contractNames = new Set(contractEntries.map(([name]) => name));
      for (const extraName of Object.keys(handlers)) {
        if (!contractNames.has(extraName)) {
          throw new Error(
            `rpc handler "${extraName}" has no matching contract method`,
          );
        }
      }
      for (const [name, methodContractValue] of contractEntries) {
        if (!RPC_METHOD_PATTERN.test(name)) {
          throw new Error(
            `invalid rpc method name "${name}" — use letters, digits, "-" and "_"`,
          );
        }
        const methodContract = readRpcMethodContract(name, methodContractValue);
        // SAFETY: The contract name set contains every handler key before this lookup.
        const handler = handlers[name as keyof typeof handlers];
        if (!pluginFunctionSchema.safeParse(handler).success) {
          throw new Error(
            `rpc method "${name}" must provide a handler function`,
          );
        }
        if (rpcHandlers.has(name)) {
          throw new Error(`rpc method "${name}" is already registered`);
        }
        pending.push([
          name,
          {
            inputSchema: methodContract.input,
            outputSchema: methodContract.output,
            // SAFETY: The contract name and handler key come from the same validated registration.
            handler: handler as PluginRpcHandler["handler"],
          },
        ]);
      }
      for (const [name, record] of pending) {
        rpcHandlers.set(name, record);
      }
    },
  };

  const realtime: PluginRealtime = {
    publish(channel, payload) {
      assertLive();
      if (!z.string().safeParse(channel).success || channel.length === 0) {
        throw new Error("realtime channel must be a non-empty string");
      }
      let normalized: JsonValue = null;
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
        normalized = jsonValueSchema.parse(JSON.parse(json));
      }
      publishSignal(channel, normalized);
    },
  };

  const background: PluginBackground = {
    service(name, service) {
      assertLive();
      if (
        !z.string().safeParse(name).success ||
        !BACKGROUND_NAME_PATTERN.test(name)
      ) {
        throw new Error(
          `invalid service name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (backgroundServices.some((record) => record.name === name)) {
        throw new Error(`background service "${name}" is already registered`);
      }
      if (
        !pluginRecordSchema.safeParse(service).success ||
        !pluginFunctionSchema.safeParse(service.start).success
      ) {
        throw new Error(
          `background service "${name}" must provide a start(signal) function`,
        );
      }
      backgroundServices.push({ name, start: service.start.bind(service) });
    },
    schedule(name, cron, fn) {
      assertLive();
      if (
        !z.string().safeParse(name).success ||
        !BACKGROUND_NAME_PATTERN.test(name)
      ) {
        throw new Error(
          `invalid schedule name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (schedules.some((record) => record.name === name)) {
        throw new Error(`schedule "${name}" is already registered`);
      }
      if (!pluginFunctionSchema.safeParse(fn).success) {
        throw new Error(`schedule "${name}" must provide a function`);
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
      schedules.push({ name, cron: String(cron), fn });
    },
  };

  const agentTools: PluginAgentToolRecord[] = [];
  const providerRegistrations = createStagedRegistrations({
    validate: (declaration: PluginProviderDeclaration) => {
      const normalized = validatePluginProviderDeclaration(declaration);
      const problem =
        normalized.icon === undefined
          ? null
          : undeclaredIconProblem(pluginId, declaredIconNames, normalized.icon);
      if (problem !== null) {
        throw new Error(providerIconRefusalMessage(normalized.id, problem));
      }
      return normalized;
    },
    bind: assertProviderRegistrable,
    isTaken: isProviderIdTaken,
    registerLive: registerProvider,
    alreadyRegisteredMessage: providerAlreadyRegisteredMessage,
    assertLive,
    isActivated: () => activated,
    disposeHooks,
  });
  let agentConfigurationProvider: PluginAgentConfigurationProvider | null =
    null;
  let instructionProvider: PluginInstructionProvider | null = null;

  const agents: PluginAgents = {
    configure(provider) {
      assertLive();
      if (agentConfigurationProvider !== null) {
        throw new Error("agent configuration is already registered");
      }
      if (!pluginFunctionSchema.safeParse(provider).success) {
        throw new Error(
          "configure requires a provider function (context) => ({ tools, skills, instructions? })",
        );
      }
      agentConfigurationProvider = provider;
    },
    contributeInstructions(provider) {
      assertLive();
      if (instructionProvider !== null) {
        throw new Error("agent instructions are already registered");
      }
      if (!pluginFunctionSchema.safeParse(provider).success) {
        throw new Error(
          "contributeInstructions requires a provider function (ctx) => string | null",
        );
      }
      instructionProvider = provider;
    },
    registerTool(tool: PluginAgentToolRegistration) {
      assertLive();
      if (!pluginRecordSchema.safeParse(tool).success) {
        throw new Error("agents.registerTool requires an options object");
      }
      const name = tool.name;
      if (
        !z.string().safeParse(name).success ||
        !AGENT_TOOL_NAME_PATTERN.test(name)
      ) {
        throw new Error(
          `invalid tool name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (RESERVED_AGENT_TOOL_NAMES.includes(name)) {
        throw new Error(
          `tool name "${name}" is a built-in bb tool — pick another name`,
        );
      }
      rejectStaleAgentToolFields(name, tool);
      if (
        !z.string().safeParse(tool.description).success ||
        tool.description.trim().length === 0
      ) {
        throw new Error(`tool "${name}" must provide a description`);
      }
      if (
        tool.instructions !== undefined &&
        !z.string().safeParse(tool.instructions).success
      ) {
        throw new Error(`tool "${name}" instructions must be a string`);
      }
      if (
        tool.instructions !== undefined &&
        tool.instructions.length > PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS
      ) {
        throw new Error(
          `tool "${name}" instructions exceed the ${PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS}-character limit`,
        );
      }
      const presentation = parsePluginAgentToolPresentation(
        name,
        tool.presentation,
      );
      if (presentation?.icon !== undefined) {
        const problem = undeclaredIconProblem(
          pluginId,
          declaredIconNames,
          presentation.icon.glyph,
        );
        if (problem !== null) {
          throw new Error(agentToolIconRefusalMessage(name, problem));
        }
      }
      const parameters = tool.parameters;
      let inputSchema: JsonValue;
      let parse: PluginAgentToolRecord["parse"];
      if (!pluginFunctionSchema.safeParse(tool.execute).success) {
        throw new Error(
          `tool "${name}" must provide an execute(params, ctx) function`,
        );
      }
      const zodParameters = z
        .custom<z.ZodType>((value) => isZodSchemaLike(value))
        .safeParse(parameters);
      if (zodParameters.success) {
        const schema = zodParameters.data;
        try {
          inputSchema = jsonObjectSchema.parse(
            JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: "input" }))),
          );
        } catch (error) {
          throw new Error(
            `tool "${name}" parameters look like a zod schema but could not be converted to JSON Schema (${
              error instanceof Error ? error.message : String(error)
            }) — use zod 4, or pass a plain JSON-schema object`,
          );
        }
        parse = (input) => {
          const result = schema.safeParse(input);
          if (result.success) return { ok: true, value: result.data };
          return { ok: false, error: summarizeParseIssues(result.error) };
        };
      } else {
        const jsonSchema = z
          .record(z.string(), z.custom<PluginAgentToolValue>())
          .safeParse(parameters);
        if (!jsonSchema.success) {
          throw new Error(
            `tool "${name}" parameters must be a zod schema or a JSON-schema object`,
          );
        }
        try {
          inputSchema = jsonObjectSchema.parse(
            JSON.parse(JSON.stringify(jsonSchema.data)),
          );
        } catch {
          throw new Error(
            `tool "${name}" parameters JSON schema is not JSON-serializable`,
          );
        }
        parse = (input) => ({ ok: true, value: input });
      }
      assertNoRecursiveJsonSchemaReferences(
        inputSchema,
        `tool "${name}" parameters`,
      );
      const owner = isAgentToolNameTaken(name);
      if (owner !== undefined) {
        const problem = `tool "${name}" is already registered by plugin "${owner}" — not registered`;
        if (activated) reportAgentToolProblem(problem);
        else pendingAgentToolProblems.push(problem);
        return;
      }
      if (agentTools.some((existing) => existing.name === name)) {
        throw new Error(`tool "${name}" is already registered`);
      }
      const record: PluginAgentToolRecord = {
        name,
        description: tool.description,
        presentation,
        instructions:
          tool.instructions !== undefined && tool.instructions.trim().length > 0
            ? tool.instructions
            : null,
        inputSchema,
        parse,
        execute: tool.execute.bind(tool),
      };
      agentTools.push(record);
    },
  };
  Object.defineProperty(agents, "experimental_registerProvider", {
    enumerable: false,
    configurable: false,
    get(): never {
      throw new Error(
        "bb.agents.experimental_registerProvider was removed in SDK 0.4.16; use bb.providers.register",
      );
    },
  });

  const mentionProviders: PluginMentionProviderRecord[] = [];
  const ui: PluginUi = {
    requestInput,
    registerMentionProvider(provider) {
      assertLive();
      if (!pluginRecordSchema.safeParse(provider).success) {
        throw new Error(
          "ui.registerMentionProvider requires an options object",
        );
      }
      const id = provider.id;
      if (
        !z.string().safeParse(id).success ||
        !MENTION_PROVIDER_ID_PATTERN.test(id)
      ) {
        throw new Error(
          `invalid mention provider id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (mentionProviders.some((record) => record.id === id)) {
        throw new Error(`mention provider "${id}" is already registered`);
      }
      if (
        !z.string().safeParse(provider.label).success ||
        provider.label.trim().length === 0
      ) {
        throw new Error(`mention provider "${id}" must provide a label`);
      }
      if (!pluginFunctionSchema.safeParse(provider.search).success) {
        throw new Error(
          `mention provider "${id}" must provide a search({ query, projectId, threadId }) function`,
        );
      }
      if (!pluginFunctionSchema.safeParse(provider.resolve).success) {
        throw new Error(
          `mention provider "${id}" must provide a resolve(itemId) function`,
        );
      }
      mentionProviders.push({
        id,
        label: provider.label.trim(),
        triggers: normalizeMentionProviderTriggers(id, provider.triggers),
        search: provider.search.bind(provider),
        resolve: provider.resolve.bind(provider),
      });
    },
  };

  const cliRecord: PluginApiHandle["cli"] = { registration: null };
  const cli: PluginCli = {
    register(registration) {
      assertLive();
      if (!pluginRecordSchema.safeParse(registration).success) {
        throw new Error("cli.register requires an options object");
      }
      if (cliRecord.registration !== null) {
        throw new Error("cli command is already registered");
      }
      const name = registration.name;
      if (
        !z.string().safeParse(name).success ||
        !CLI_COMMAND_NAME_PATTERN.test(name)
      ) {
        throw new Error(
          `invalid cli command name ${JSON.stringify(name)} — use lowercase letters, digits, and "-"`,
        );
      }
      if (
        !z.string().safeParse(registration.summary).success ||
        registration.summary.trim().length === 0
      ) {
        throw new Error(`cli command "${name}" must provide a summary`);
      }
      const commands = registration.commands ?? [];
      if (
        !z.array(z.custom<PluginAgentToolValue>()).safeParse(commands).success
      ) {
        throw new Error(`cli command "${name}" commands must be an array`);
      }
      const validatedCommands = commands.map((command, index) => {
        if (
          !pluginRecordSchema.safeParse(command).success ||
          !z.string().safeParse(command.name).success ||
          !z.string().safeParse(command.summary).success ||
          !z.string().safeParse(command.usage).success
        ) {
          throw new Error(
            `cli command "${name}" commands[${index}] must be { name: [a-z0-9-]+, summary, usage }`,
          );
        }
        if (
          !CLI_COMMAND_NAME_PATTERN.test(command.name) ||
          command.summary.trim().length === 0 ||
          command.usage.trim().length === 0
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
      if (!pluginFunctionSchema.safeParse(registration.run).success) {
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

  const status: PluginStatusApi = {
    needsConfiguration(message) {
      assertLive();
      if (!z.string().safeParse(message).success) {
        throw new Error("status.needsConfiguration message must be a string");
      }
      const normalized = message.length > 0 ? message : "needs configuration";
      if (activated) reportNeedsConfiguration(normalized);
      else pendingNeedsConfiguration = normalized;
    },
  };

  const server: PluginServerApi = {
    get loopbackBaseUrl(): string {
      assertLive();
      const baseUrl = getLoopbackBaseUrl();
      if (baseUrl === undefined) {
        throw new Error(
          "bb.server.loopbackBaseUrl is not available until the server is listening — " +
            "use it inside handlers, services, or timers, not at factory load time",
        );
      }
      return baseUrl;
    },
    get experimental_dataDir(): string {
      assertLive();
      return dataDir;
    },
  };

  const hosts: PluginHosts = {
    experimental_client({ contract, experimental_signals }) {
      assertLive();
      return {
        async call(method, input, callOptions) {
          assertLive();
          if (!activated) {
            throw new Error(
              "host plugin calls are unavailable during factory registration; call from a handler, service, or timer",
            );
          }
          if (contract[method] === undefined) {
            throw new Error(`unknown host rpc method "${String(method)}"`);
          }
          const parsedCallOptions = z
            .object({
              hostId: z.string().min(1),
              signal: z.custom<AbortSignal>().optional(),
            })
            .safeParse(callOptions);
          if (!parsedCallOptions.success) {
            throw new Error(`host rpc method "${method}" requires a host id`);
          }
          const callArgs: Parameters<typeof callPluginHost>[0] = {
            contract,
            method,
            input,
            hostId: parsedCallOptions.data.hostId,
          };
          if (parsedCallOptions.data.signal !== undefined) {
            callArgs.signal = parsedCallOptions.data.signal;
          }
          return callPluginHost(callArgs);
        },
        experimental_onWorkerExit(handler) {
          assertLive();
          if (!pluginFunctionSchema.safeParse(handler).success) {
            throw new Error("host worker exit subscription requires a handler");
          }
          hostWorkerExitHandlers.push(handler);
          let subscribed = true;
          return () => {
            if (!subscribed) return;
            subscribed = false;
            const index = hostWorkerExitHandlers.indexOf(handler);
            if (index >= 0) hostWorkerExitHandlers.splice(index, 1);
          };
        },
        experimental_onSignal(signal, handler) {
          assertLive();
          const parsedSignal = z.string().min(1).safeParse(signal);
          if (!parsedSignal.success) {
            throw new Error(`unknown host signal "${String(signal)}"`);
          }
          const descriptor = experimental_signals?.[parsedSignal.data];
          if (
            descriptor === undefined ||
            !isStandardSchema(descriptor.payload)
          ) {
            throw new Error(`unknown host signal "${String(signal)}"`);
          }
          if (!pluginFunctionSchema.safeParse(handler).success) {
            throw new Error("host signal subscription requires a handler");
          }
          const record: PluginHostSignalHandler = {
            signal: parsedSignal.data,
            payloadSchema: descriptor.payload,
            handler,
          };
          hostSignalHandlers.push(record);
          let subscribed = true;
          return () => {
            if (!subscribed) return;
            subscribed = false;
            const index = hostSignalHandlers.indexOf(record);
            if (index >= 0) hostSignalHandlers.splice(index, 1);
          };
        },
      };
    },
    ensureSharedPortTunnel(hostId) {
      assertLive();
      return ensureSharedPortTunnel(hostId);
    },
    declareSharedPorts(hostId, ports) {
      assertLive();
      if (activated) declareSharedPorts(hostId, ports);
      else {
        pendingSharedPorts.set(
          hostId,
          validateSharedPortDeclaration(hostId, ports),
        );
      }
    },
  };
  const events: PluginEvents = {
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
  };

  const providers: PluginProviders = {
    register: providerRegistrations.register,
  };

  const aiServiceRegistrations = createStagedRegistrations({
    validate: validatePluginAiServiceDeclaration,
    bind: assertAiServiceRegistrable,
    isTaken: isAiServiceIdTaken,
    registerLive: registerAiService,
    alreadyRegisteredMessage: aiServiceAlreadyRegisteredMessage,
    assertLive,
    isActivated: () => activated,
    disposeHooks,
  });
  const experimental_aiServices: PluginAiServices = {
    register: aiServiceRegistrations.register,
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
    providers,
    ui,
    events,
    status,
    server,
    hosts,
    experimental_aiServices,
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
    onDispose(hook) {
      assertLive();
      disposeHooks.push(hook);
    },
  };

  return {
    api,
    disposeHooks,
    settings: settingsRecord,
    databaseHandles,
    threadEventHandlers,
    httpRoutes,
    rpcHandlers,
    hostWorkerExitHandlers,
    hostSignalHandlers,
    backgroundServices,
    schedules,
    cli: cliRecord,
    agentTools,
    listProviderDeclarations: providerRegistrations.values,
    get agentConfigurationProvider() {
      return agentConfigurationProvider;
    },
    get instructionProvider() {
      return instructionProvider;
    },
    mentionProviders,
    activate() {
      if (activated) return;
      assertLive();
      replaceDeclaredSharedPorts(
        [...pendingSharedPorts].map(([hostId, ports]) => ({ hostId, ports })),
      );
      providerRegistrations.flush();
      aiServiceRegistrations.flush();
      activated = true;
      const cliWarning = cliRecord.registration
        ? pluginCliCollisionWarning(pluginId, cliRecord.registration.name)
        : null;
      if (cliWarning) emitLog("warn", cliWarning);
      pendingSharedPorts.clear();
      for (const problem of pendingAgentToolProblems) {
        reportAgentToolProblem(problem);
      }
      pendingAgentToolProblems.length = 0;
      if (pendingNeedsConfiguration !== null) {
        reportNeedsConfiguration(pendingNeedsConfiguration);
        pendingNeedsConfiguration = null;
      }
    },
    invalidate() {
      invalidated = true;
    },
  };
}
