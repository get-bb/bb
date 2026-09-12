import {
  environmentCompositionSchema,
  validateServerAccessProviderDeclaration,
  type NormalizedPluginEnvironmentComposition,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { createMachineBootstrapApi } from "../machines/bootstrap.js";
import type { MachineEnrollments } from "../machines/enrollments.js";
import { listServerAccessProviders } from "./plugin-server-access-registry.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import {
  deletePluginKvValue,
  getPluginKvValue,
  getHost,
  listPluginKvKeys,
  setPluginKvValue,
  type DbConnection,
} from "@bb/db";
import type { JsonValue } from "@bb/domain";
import type {
  BbPluginApi,
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgentToolContext,
  PluginAgentToolPresentation,
  PluginBbSdk,
  PluginAgentToolResult,
  PluginAgents,
  PluginBackground,
  PluginCli,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliResult,
  PluginEnvironments,
  PluginHooks,
  PluginHookHandler,
  PluginHookName,
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
  PluginMachines,
  PluginAiServiceDeclaration,
  PluginAiServices,
  PluginProviderDeclaration,
  ExperimentalPluginProviderEnvContext,
  ExperimentalPluginProviderEnvEntry,
  ExperimentalPluginProviderEnvHealth,
  ExperimentalPluginProviderEnvHealthContext,
  ExperimentalPluginWebSocket,
  ExperimentalPluginWebSocketHandler,
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
} from "@get-bb/plugin-sdk";
import {
  KV_VALUE_MAX_BYTES,
  normalizeAgentToolRegistration,
  normalizeCliRegistration,
  normalizeHttpRouteRegistration,
  normalizeInteractionRequest,
  normalizeMentionProviderRegistration,
  normalizeRealtimePayload,
  normalizeRpcRegistration,
  normalizeWebSocketRouteRegistration,
  pluginCliCollisionWarning,
  registerSettingDescriptors,
  runPluginStorageMigrations,
  isStandardSchema,
  aiServiceAlreadyRegisteredMessage,
  pluginHookAlreadyRegisteredMessage,
  storePluginHook,
  validateBackgroundServiceRegistration,
  validatePluginEnvironmentProviderDeclaration,
  validatePluginMachineProviderDeclaration,
  providerAlreadyRegisteredMessage,
  providerIconRefusalMessage,
  undeclaredIconProblem,
  validateProviderEnvContribution,
  validateScheduleRegistration,
  validateSettingsUpdate,
  validatePluginAiServiceDeclaration,
  validatePluginProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  AiServiceHostBinding,
  NormalizedPluginEnvironmentProvider,
  NormalizedPluginMachineProvider,
  NormalizedPluginProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  BbSdk,
  ThreadForkArgs,
  ThreadPluginMetadataArgs,
  ThreadPluginMetadataUpdateArgs,
  ThreadSpawnArgs,
} from "@bb/sdk";
import { requestEnvironmentProviderRecheck } from "./plugin-environment-provider-registry.js";
import { requestServerAccessRecheck } from "./plugin-server-access-registry.js";
import type { ServerLogger } from "../../types.js";
import type { PluginInteractionResult } from "../interactions/pending-interactions.js";
import { appendPluginLogLine } from "./plugin-log.js";
import type { PluginHostArtifactSnapshot } from "./plugin-service-internal.js";
import {
  readPluginSettingsValues,
  writePluginSettingsUpdate,
} from "./plugin-settings.js";

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

export function isNeedsConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}

/**
 * The handler this plugin registered per hook, or null where it registered
 * none. A mapped type over the hook-name union rather than a loose map: a hook
 * added to the contract without an entry here fails to compile, which is what
 * keeps the registry and the contract from drifting.
 */
export type PluginHookRecords = {
  [K in PluginHookName]: PluginHookHandler<K> | null;
};

/** Per-event handler lists recorded by `bb.events.on`; dropped with the handle. */
type PluginThreadEventHandlers = {
  [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
};

export interface PluginHttpRouteRecord {
  method: string;
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

export interface PluginWebSocketRouteRecord {
  path: string;
  auth: PluginHttpAuthMode;
  handler: ExperimentalPluginWebSocketHandler;
  active: boolean;
  sockets: Set<ExperimentalPluginWebSocket>;
}

export interface PluginRpcHandler {
  inputSchema: StandardSchemaV1;
  outputSchema: StandardSchemaV1;
  handler: (input: unknown) => unknown;
}

export interface PluginAgentToolRecord {
  name: string;
  description: string;
  presentation: PluginAgentToolPresentation | null;
  instructions: string | null;
  inputSchema: unknown;
  parse(
    input: unknown,
  ): { ok: true; value: unknown } | { ok: false; error: string };
  execute(
    params: unknown,
    ctx: PluginAgentToolContext,
  ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}

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
  /** Hook handlers recorded by `bb.experimental_hooks.on`. */
  hooks: PluginHookRecords;
  environmentCompositions: Map<string, NormalizedPluginEnvironmentComposition>;
  environmentProviders: Map<string, NormalizedPluginEnvironmentProvider>;
  machineProviders: Map<string, NormalizedPluginMachineProvider>;
  serverAccessProviders: Map<
    string,
    import("@get-bb/plugin-sdk").ServerAccessProviderDeclaration
  >;
  /** HTTP routes recorded by `bb.http.route`; dropped with the handle. */
  httpRoutes: PluginHttpRouteRecord[];
  websocketRoutes: PluginWebSocketRouteRecord[];
  rpcHandlers: Map<string, PluginRpcHandler>;
  hostWorkerExitHandlers: PluginHostWorkerExitHandler[];
  hostSignalHandlers: PluginHostSignalHandler[];
  backgroundServices: PluginBackgroundServiceRecord[];
  schedules: PluginScheduleRecord[];
  cli: { registration: PluginCliRegistrationRecord | null };
  agentTools: PluginAgentToolRecord[];
  listProviderDeclarations(): NormalizedPluginProviderDeclaration[];
  providerEnvResolvers: ReadonlyMap<string, PluginProviderEnvResolver>;
  providerEnvHealthResolvers: ReadonlyMap<
    string,
    PluginProviderEnvHealthResolver
  >;
  agentConfigurationProvider: PluginAgentConfigurationProvider | null;
  instructionProvider: PluginInstructionProvider | null;
  mentionProviders: PluginMentionProviderRecord[];
  activate(): void;
  closeWebSockets(): void;
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

export type PluginProviderEnvResolver = (
  context: ExperimentalPluginProviderEnvContext,
) =>
  | readonly ExperimentalPluginProviderEnvEntry[]
  | Promise<readonly ExperimentalPluginProviderEnvEntry[]>;

export type PluginProviderEnvHealthResolver = (
  context: ExperimentalPluginProviderEnvHealthContext,
) =>
  | ExperimentalPluginProviderEnvHealth
  | null
  | Promise<ExperimentalPluginProviderEnvHealth | null>;

function withPluginThreadAttribution<
  TArgs extends ThreadForkArgs | ThreadSpawnArgs,
>(args: TArgs, pluginId: string): TArgs {
  const attribution: Pick<ThreadSpawnArgs, "origin" | "originPluginId"> =
    args.pluginMetadata !== undefined
      ? { origin: "plugin", originPluginId: pluginId }
      : args.origin === undefined || args.origin === "plugin"
        ? { origin: "plugin", originPluginId: args.originPluginId ?? pluginId }
        : { origin: args.origin };
  return { ...args, ...attribution };
}

function wrapSdkForPlugin(sdk: BbSdk, pluginId: string): PluginBbSdk {
  return {
    ...sdk,
    threads: {
      ...sdk.threads,
      async getPluginMetadata(
        args: Omit<ThreadPluginMetadataArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.getPluginMetadata({
          ...args,
          pluginId: args.pluginId ?? pluginId,
        });
      },
      async updatePluginMetadata(
        args: Omit<ThreadPluginMetadataUpdateArgs, "pluginId"> & {
          pluginId?: string;
        },
      ) {
        return sdk.threads.updatePluginMetadata({
          ...args,
          pluginId: args.pluginId ?? pluginId,
        });
      },
      fork(args: ThreadForkArgs) {
        return sdk.threads.fork(withPluginThreadAttribution(args, pluginId));
      },
      spawn(args: ThreadSpawnArgs) {
        return sdk.threads.spawn(withPluginThreadAttribution(args, pluginId));
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
}): {
  register(declaration: TDeclaration): { dispose(): void };
  flush(): void;
  values(): TNormalized[];
} {
  const entries = new Map<
    string,
    {
      declaration: TNormalized;
      binding: TBinding;
      disposer: { dispose(): void } | null;
      disposed: boolean;
    }
  >();
  return {
    register(declaration) {
      options.assertLive();
      const normalized = options.validate(declaration);
      const binding = options.bind(normalized.id);
      if (entries.has(normalized.id)) {
        throw new Error(options.alreadyRegisteredMessage(normalized.id));
      }
      const entry = {
        declaration: normalized,
        binding,
        disposer: null as { dispose(): void } | null,
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

const PLUGIN_HOST_CALL_MAX_TIMEOUT_MS = 30 * 60_000;

export function createPluginApi(options: {
  pluginId: string;
  logger: ServerLogger;
  db: DbConnection;
  dataDir: string;
  getSdk: () => BbSdk | undefined;
  getMachineEnrollments: () => MachineEnrollments;
  getAppUrl: () => string | null;
  getLoopbackBaseUrl: () => string | undefined;
  publishSignal: (channel: string, payload: unknown) => void;
  settingsChanged: () => void;
  reportNeedsConfiguration: (message: string) => void;
  isAgentToolNameTaken: (name: string) => string | undefined;
  isEnvironmentProviderIdTaken: (id: string) => string | undefined;
  isMachineProviderIdTaken: (id: string) => string | undefined;
  reportAgentToolProblem: (message: string) => void;
  /**
   * Schedules a re-attempt of every plugin-queued row
   * (`bb.experimental_hooks.recheck`). Coalescing, pacing and the walk
   * itself belong to the queue; this only asks for it.
   */
  requestQueueDrain: () => void;
  /**
   * The names this plugin's manifest declares under
   * `bb.branding.experimental_icons`: what a namespaced glyph
   * (`"<pluginId>/<name>"`) in a tool presentation or a provider icon must
   * name. Empty when the manifest declares none.
   */
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
    input: unknown;
    hostId: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }) => Promise<unknown>;
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
    getAppUrl,
    getLoopbackBaseUrl,
    publishSignal,
    settingsChanged,
    reportNeedsConfiguration,
    isAgentToolNameTaken,
    reportAgentToolProblem,
    requestQueueDrain,
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
  let wrappedSdk: PluginBbSdk | undefined;
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
    "experimental_thread.events": [],
    "experimental_terminal.input": [],
    "thread.created": [],
    "thread.active": [],
    "thread.idle": [],
    "thread.failed": [],
    "thread.archived": [],
    "thread.deleted": [],
    "interaction.pending": [],
    "message.queued": [],
    "message.dispatched": [],
    "turn.failed": [],
    "message.cancelled": [],
    "thread.unarchived": [],
  };
  const hooks: PluginHookRecords = {
    "message.dispatch": null,
  };
  const environmentCompositions = new Map<
    string,
    NormalizedPluginEnvironmentComposition
  >();
  const environmentProviders = new Map<
    string,
    NormalizedPluginEnvironmentProvider
  >();
  const machineProviders = new Map<string, NormalizedPluginMachineProvider>();
  const serverAccessProviders = new Map<
    string,
    import("@get-bb/plugin-sdk").ServerAccessProviderDeclaration
  >();
  const httpRoutes: PluginHttpRouteRecord[] = [];
  const websocketRoutes: PluginWebSocketRouteRecord[] = [];
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
    return requestInteraction({
      ...normalizeInteractionRequest(request),
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
      runPluginStorageMigrations(database, statements);
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
          return (await readPluginSettingsValues({
            db,
            dataDir,
            pluginId,
            descriptors: validated,
          })) as Values;
        },
        async experimental_set(values) {
          assertLive();
          const rawValues: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(values)) {
            rawValues[key] = value;
          }
          const errors = validateSettingsUpdate(validated, rawValues);
          if (errors.length > 0) {
            throw new Error(errors.join("; "));
          }
          const storeArgs = {
            db,
            dataDir,
            pluginId,
            descriptors: settingsRecord.descriptors,
          };
          const prev = await readPluginSettingsValues(storeArgs);
          await writePluginSettingsUpdate({ ...storeArgs, values: rawValues });
          const next = await readPluginSettingsValues(storeArgs);
          if (JSON.stringify(next) !== JSON.stringify(prev)) {
            for (const listener of settingsRecord.listeners) {
              try {
                listener(next, prev);
              } catch (error) {
                emitLog(
                  "warn",
                  `settings onChange listener failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
            if (activated) settingsChanged();
          }
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

  const http: PluginHttp = {
    route(method, path, handler, opts) {
      assertLive();
      const route = normalizeHttpRouteRegistration(
        method,
        path,
        handler,
        opts,
        httpRoutes,
      );
      httpRoutes.push({ ...route, handler });
    },
    experimental_websocket(path, handler, opts) {
      assertLive();
      const route = normalizeWebSocketRouteRegistration(
        path,
        handler,
        opts,
        websocketRoutes,
      );
      websocketRoutes.push({
        ...route,
        handler,
        active: true,
        sockets: new Set(),
      });
    },
  };

  const rpc: PluginRpc = {
    register(contract, handlers) {
      assertLive();
      for (const [name, record] of normalizeRpcRegistration(
        contract,
        handlers,
        rpcHandlers,
      )) {
        rpcHandlers.set(name, record);
      }
    },
  };

  const realtime: PluginRealtime = {
    publish(channel, payload) {
      assertLive();
      publishSignal(channel, normalizeRealtimePayload(channel, payload));
    },
  };

  const background: PluginBackground = {
    service(name, service) {
      assertLive();
      backgroundServices.push(
        validateBackgroundServiceRegistration(
          name,
          service,
          backgroundServices,
        ),
      );
    },
    schedule(name, cron, fn) {
      assertLive();
      schedules.push(
        validateScheduleRegistration(
          name,
          cron,
          fn,
          schedules,
          (expression) => {
            CronExpressionParser.parse(expression);
          },
        ),
      );
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
  const providerEnvResolvers = new Map<string, PluginProviderEnvResolver>();
  const providerEnvHealthResolvers = new Map<
    string,
    PluginProviderEnvHealthResolver
  >();
  let agentConfigurationProvider: PluginAgentConfigurationProvider | null =
    null;
  let instructionProvider: PluginInstructionProvider | null = null;

  const agents: PluginAgents = {
    configure(provider) {
      assertLive();
      if (agentConfigurationProvider !== null) {
        throw new Error("agent configuration is already registered");
      }
      if (typeof provider !== "function") {
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
      if (typeof provider !== "function") {
        throw new Error(
          "contributeInstructions requires a provider function (ctx) => string | null",
        );
      }
      instructionProvider = provider;
    },
    registerTool(tool: {
      name: string;
      description: string;
      instructions?: string;
      presentation?: PluginAgentToolPresentation;
      parameters: unknown;
      execute(
        params: never,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }) {
      assertLive();
      const record = normalizeAgentToolRegistration({
        pluginId,
        declaredIconNames,
        tool,
      });
      const owner = isAgentToolNameTaken(record.name);
      if (owner !== undefined) {
        const problem = `tool "${record.name}" is already registered by plugin "${owner}" — not registered`;
        if (activated) reportAgentToolProblem(problem);
        else pendingAgentToolProblems.push(problem);
        return;
      }
      if (agentTools.some((existing) => existing.name === record.name)) {
        throw new Error(`tool "${record.name}" is already registered`);
      }
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
      mentionProviders.push(
        normalizeMentionProviderRegistration(provider, mentionProviders),
      );
    },
  };

  const cliRecord: PluginApiHandle["cli"] = { registration: null };
  const cli: PluginCli = {
    register(registration) {
      assertLive();
      cliRecord.registration = normalizeCliRegistration(
        registration,
        cliRecord.registration !== null,
      );
    },
  };

  const status: PluginStatusApi = {
    needsConfiguration(message) {
      assertLive();
      const normalized =
        typeof message === "string" && message.length > 0
          ? message
          : "needs configuration";
      if (activated) reportNeedsConfiguration(normalized);
      else pendingNeedsConfiguration = normalized;
    },
  };

  const server: PluginServerApi = {
    get experimental_appUrl(): string | null {
      assertLive();
      return getAppUrl();
    },
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
          if (typeof method !== "string" || contract[method] === undefined) {
            throw new Error(`unknown host rpc method "${String(method)}"`);
          }
          if (
            typeof callOptions !== "object" ||
            callOptions === null ||
            typeof callOptions.hostId !== "string" ||
            callOptions.hostId.length === 0
          ) {
            throw new Error(`host rpc method "${method}" requires a host id`);
          }
          return callPluginHost({
            contract,
            method,
            input,
            hostId: callOptions.hostId,
            ...(callOptions.signal === undefined
              ? {}
              : { signal: callOptions.signal }),
            ...(callOptions.timeoutMs === undefined
              ? {}
              : {
                  timeoutMs: Math.min(
                    Math.max(1_000, Math.floor(callOptions.timeoutMs)),
                    PLUGIN_HOST_CALL_MAX_TIMEOUT_MS,
                  ),
                }),
          });
        },
        experimental_onWorkerExit(handler) {
          assertLive();
          if (typeof handler !== "function") {
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
          const descriptor = experimental_signals?.[signal];
          if (
            typeof signal !== "string" ||
            signal.length === 0 ||
            typeof descriptor !== "object" ||
            descriptor === null ||
            !isStandardSchema(descriptor.payload)
          ) {
            throw new Error(`unknown host signal "${String(signal)}"`);
          }
          if (typeof handler !== "function") {
            throw new Error("host signal subscription requires a handler");
          }
          const record: PluginHostSignalHandler = {
            signal,
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

  const experimental_hooks: PluginHooks = {
    on(hook, handler) {
      assertLive();
      if (hooks[hook] !== null) {
        // Two handlers from one plugin for one hook would make the order
        // within the plugin invisible. Say so at registration rather than
        // silently keeping one.
        throw new Error(pluginHookAlreadyRegisteredMessage(hook));
      }
      storePluginHook(hooks, hook, handler);
    },
    async recheck(hook) {
      assertLive();
      // One hook key exists; the parameter selects which question to re-pose
      // and widens additively when a second key ever ships.
      void hook;
      // Resolves on SCHEDULING. The walk runs on a later macrotask, and the
      // caller is not the one it reports to — a failed re-attempt lands on the
      // row it failed, like every other background drain.
      requestQueueDrain();
    },
  };

  const providers: PluginProviders = {
    register: providerRegistrations.register,
    experimental_contributeEnv(providerId, resolve) {
      assertLive();
      validateProviderEnvContribution(
        "provider environment contribution",
        providerId,
        resolve,
        providerEnvResolvers,
      );
      providerEnvResolvers.set(providerId, resolve);
    },
    experimental_contributeEnvHealth(providerId, resolve) {
      assertLive();
      validateProviderEnvContribution(
        "provider environment health contribution",
        providerId,
        resolve,
        providerEnvHealthResolvers,
      );
      providerEnvHealthResolvers.set(providerId, resolve);
    },
  };

  const experimental_environments: PluginEnvironments = {
    register(
      declaration:
        | import("@get-bb/plugin-sdk").PluginEnvironmentProviderDeclaration
        | NormalizedPluginEnvironmentComposition,
    ) {
      assertLive();
      if ("machineProviderId" in declaration) {
        const composition = environmentCompositionSchema.parse(declaration);
        const problem =
          composition.icon === null
            ? null
            : undeclaredIconProblem(
                pluginId,
                declaredIconNames,
                composition.icon,
              );
        if (problem !== null)
          throw new Error(providerIconRefusalMessage(composition.id, problem));
        const owner = options.isEnvironmentProviderIdTaken(composition.id);
        if (owner !== undefined)
          throw new Error(
            `environment provider "${composition.id}" is already registered by plugin "${owner}"`,
          );
        if (environmentProviders.has(composition.id))
          throw new Error(
            "Environment ID is already registered as a concrete provider",
          );
        environmentCompositions.set(composition.id, composition);
        return;
      }
      if (environmentCompositions.has(declaration.id))
        throw new Error(
          "Environment ID is already registered as a composition",
        );
      const provider =
        validatePluginEnvironmentProviderDeclaration(declaration);
      const problem =
        provider.icon === null
          ? null
          : undeclaredIconProblem(pluginId, declaredIconNames, provider.icon);
      if (problem !== null)
        throw new Error(providerIconRefusalMessage(provider.id, problem));
      const owner = options.isEnvironmentProviderIdTaken(provider.id);
      if (owner !== undefined) {
        throw new Error(
          `environment provider "${provider.id}" is already registered by plugin "${owner}"`,
        );
      }
      environmentProviders.set(provider.id, provider);
    },
    async recheck() {
      assertLive();
      requestEnvironmentProviderRecheck(options.pluginId);
    },
  };

  const experimental_serverAccess: import("@get-bb/plugin-sdk").PluginServerAccess =
    {
      register(declaration) {
        assertLive();
        validateServerAccessProviderDeclaration(declaration);
        if (
          serverAccessProviders.has(declaration.id) ||
          listServerAccessProviders().some(
            (entry) =>
              entry.provider.id === declaration.id &&
              entry.pluginId !== pluginId,
          )
        ) {
          throw new Error(
            `Server access provider "${declaration.id}" is already registered`,
          );
        }
        serverAccessProviders.set(declaration.id, declaration);
      },
      recheck() {
        assertLive();
        requestServerAccessRecheck(options.pluginId);
      },
    };

  const enrollmentApi: MachineEnrollments = {
    clearPending(key) {
      assertLive();
      options.getMachineEnrollments().clearPending(key);
    },
    prepare(request) {
      assertLive();
      return options.getMachineEnrollments().prepare(request);
    },
    waitForConnection(request) {
      assertLive();
      return options.getMachineEnrollments().waitForConnection(request);
    },
  };
  const experimental_machines: PluginMachines = {
    ...createMachineBootstrapApi(enrollmentApi),
    async getResource(hostId) {
      assertLive();
      return getHost(db, hostId)?.resource ?? null;
    },
    register(declaration) {
      assertLive();
      const provider = validatePluginMachineProviderDeclaration(declaration);
      const problem = undeclaredIconProblem(
        pluginId,
        declaredIconNames,
        provider.icon,
      );
      if (problem !== null) {
        throw new Error(providerIconRefusalMessage(provider.id, problem));
      }
      const owner = options.isMachineProviderIdTaken(provider.id);
      if (owner !== undefined) {
        throw new Error(
          `machine provider "${provider.id}" is already registered by plugin "${owner}"`,
        );
      }
      machineProviders.set(provider.id, provider);
    },
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
    experimental_hooks,
    experimental_environments,
    experimental_machines,
    experimental_serverAccess,
    status,
    server,
    hosts,
    experimental_aiServices,
    get sdk(): PluginBbSdk {
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
    hooks,
    environmentCompositions,
    environmentProviders,
    machineProviders,
    serverAccessProviders,
    httpRoutes,
    websocketRoutes,
    rpcHandlers,
    hostWorkerExitHandlers,
    hostSignalHandlers,
    backgroundServices,
    schedules,
    cli: cliRecord,
    agentTools,
    listProviderDeclarations: providerRegistrations.values,
    providerEnvResolvers,
    providerEnvHealthResolvers,
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
    closeWebSockets() {
      for (const route of websocketRoutes) {
        route.active = false;
        for (const socket of route.sockets) {
          try {
            socket.close(1012, "Plugin reloaded or disabled");
          } catch (error) {
            emitLog(
              "warn",
              `websocket ${route.path} close failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    },
    invalidate() {
      invalidated = true;
    },
  };
}
