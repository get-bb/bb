import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import {
  parentPort,
  receiveMessageOnPort,
  workerData,
} from "node:worker_threads";
import type Database from "better-sqlite3";
import { Context } from "hono";
import {
  adoptHttpRouteResponse,
  normalizeRpcRegistration,
  runPluginStorageMigrations,
} from "@get-bb/plugin-sdk/internal/host-policy";
import type { BbPluginApi, PluginBbSdk } from "@get-bb/plugin-sdk";
import { openPluginDatabase } from "./plugin-database.js";
import { createPluginRpcCallerSdk } from "./plugin-rpc-caller.js";
import { runPluginRpcMethod } from "./plugin-rpc-method.js";
import { wrapSdkForPlugin } from "./plugin-sdk-wrapping.js";
import {
  PLUGIN_SERVER_WORKER_UNSUPPORTED_ERROR,
  RemoteCodec,
  SYNC_CALL_TIMEOUT_MS,
  type CoreToWorkerMessage,
  type PluginServerWorkerData,
  type SyncReply,
  type SyncRequest,
  type WorkerLogLevel,
  type WorkerToCoreMessage,
} from "./plugin-server-worker-protocol.js";
import { maintainPluginDatabases } from "../system/sqlite-incremental-vacuum.js";
import { findUnsupportedPluginServerApi } from "./plugin-server-worker-preflight.js";

if (parentPort === null) {
  throw new Error("plugin server worker must run in a worker thread");
}
const port = parentPort;
const data = workerData as PluginServerWorkerData;
const syncFlag = new Int32Array(data.syncFlag);

function post(message: WorkerToCoreMessage, transfer: Transferable[] = []) {
  port.postMessage(message, transfer as never);
}

const pendingSync = new Map<
  number,
  { resolve(value: unknown): void; reject(error: unknown): void }
>();
const invocationContext = new AsyncLocalStorage<number>();

const codec = new RemoteCodec({
  importFunction: (id) => {
    return (...args: unknown[]) => syncRequest({ t: "invoke", fn: id, args });
  },
  postAbort: (signal, reason) => post({ t: "abort", signal, reason }),
});

function syncRequest(request: SyncRequest): unknown {
  const transfer: Transferable[] = [];
  const encoded: SyncRequest =
    request.t === "get"
      ? request
      : { ...request, args: request.args.map((arg) => codec.encode(arg, transfer)) };
  Atomics.store(syncFlag, 0, 0);
  data.syncPort.postMessage(encoded, transfer as never);
  if (Atomics.wait(syncFlag, 0, 0, SYNC_CALL_TIMEOUT_MS) === "timed-out") {
    throw new Error(
      `bb server did not answer a plugin API call within ${SYNC_CALL_TIMEOUT_MS}ms`,
    );
  }
  const received = receiveMessageOnPort(data.syncPort);
  if (received === undefined) {
    throw new Error("bb server answered a plugin API call without a reply");
  }
  const reply = received.message as SyncReply;
  if ("pending" in reply) {
    return new Promise((resolve, reject) => {
      pendingSync.set(reply.pending, { resolve, reject });
    });
  }
  if (!reply.ok) throw codec.decode(reply.error);
  return codec.decode(reply.value);
}

function call(path: string) {
  return (...args: unknown[]) => syncRequest({ t: "call", path, args });
}

function unsupported(member: string) {
  return () => {
    post({ t: "unsupported", member });
    const error = new Error(
      `${member} is not available to a plugin server running in its own worker yet`,
    );
    error.name = PLUGIN_SERVER_WORKER_UNSUPPORTED_ERROR;
    throw error;
  };
}

function pluginLog(level: WorkerLogLevel) {
  return (message: string) =>
    post({ t: "pluginLog", level, message: String(message) });
}

const serverLogger = {
  debug: (fields: object, message: string) =>
    post({ t: "serverLog", level: "debug", fields: codec.encode(fields), message }),
  info: (fields: object, message: string) =>
    post({ t: "serverLog", level: "info", fields: codec.encode(fields), message }),
  warn: (fields: object, message: string) =>
    post({ t: "serverLog", level: "warn", fields: codec.encode(fields), message }),
};

const databaseHandles: Database.Database[] = [];
let databaseHandle: Database.Database | undefined;
const localRpcHandlers = new Map<string, unknown>();

function httpHandler(handler: unknown) {
  if (typeof handler !== "function") return handler;
  return codec.markFunction(
    async (request: {
      url: string;
      method: string;
      headers: Array<[string, string]>;
      body: ReadableStream<Uint8Array> | null;
      signal: AbortSignal;
      path: string;
      routePath: string;
      params: Record<string, string>;
      variables: Record<string, unknown>;
    }) => {
      const raw = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        ...(request.body === null
          ? {}
          : { body: request.body, duplex: "half" as const }),
      } as RequestInit);
      const encodedParams = Object.fromEntries(
        Object.entries(request.params).map(([key, value]) => [
          key,
          encodeURIComponent(value),
        ]),
      );
      const route = {
        basePath: "/",
        path: request.routePath,
        method: "ALL",
        handler,
      };
      const context = new Context(raw, {
        path: request.path,
        matchResult: [[[[handler, route], encodedParams]]],
      } as ConstructorParameters<typeof Context>[1]);
      for (const [key, value] of Object.entries(request.variables)) {
        context.set(key as never, value as never);
      }
      const response = await (handler as (context: Context) => unknown)(
        context,
      );
      return adoptHttpRouteResponse(response);
    },
    "http",
  );
}

function settingsListener(listener: unknown) {
  if (typeof listener !== "function") return listener;
  return codec.markFunction((...args: unknown[]) => {
    try {
      listener(...args);
    } catch (error) {
      return { threw: error };
    }
    return null;
  }, "listener");
}

let sdk: PluginBbSdk | undefined;

const api = {
  internal_DO_NOT_USE_recordPluginUse: call(
    "internal_DO_NOT_USE_recordPluginUse",
  ),
  pluginId: data.pluginId,
  log: {
    debug: pluginLog("debug"),
    info: pluginLog("info"),
    warn: pluginLog("warn"),
    error: pluginLog("error"),
  },
  settings: {
    define(descriptors: Record<string, unknown>) {
      for (const [key, descriptor] of Object.entries(descriptors ?? {})) {
        if (
          typeof descriptor === "object" &&
          descriptor !== null &&
          Reflect.get(descriptor, "experimental_schema") !== undefined
        ) {
          return unsupported(
            `bb.settings.define (setting "${key}" experimental_schema)`,
          )();
        }
      }
      const handle = syncRequest({
        t: "call",
        path: "settings.define",
        args: [descriptors],
      }) as { onChange: (listener: unknown) => unknown };
      const onChange = handle.onChange;
      return {
        ...handle,
        onChange: (listener: unknown) => onChange(settingsListener(listener)),
      };
    },
  },
  storage: {
    kv: {
      get: call("storage.kv.get"),
      set: call("storage.kv.set"),
      delete: call("storage.kv.delete"),
      list: call("storage.kv.list"),
    },
    database() {
      if (databaseHandle?.open) return databaseHandle;
      if (databaseHandle) {
        const index = databaseHandles.indexOf(databaseHandle);
        if (index !== -1) databaseHandles.splice(index, 1);
      }
      const database = openPluginDatabase(data.dataDir, data.pluginId);
      databaseHandle = database;
      databaseHandles.push(database);
      return database;
    },
    migrate(database: Database.Database, statements: string[]) {
      runPluginStorageMigrations(database, statements);
    },
  },
  http: {
    route(method: string, path: string, handler: unknown, opts?: unknown) {
      return syncRequest({
        t: "call",
        path: "http.route",
        args: [method, path, httpHandler(handler), opts],
      });
    },
    experimental_websocket: unsupported("bb.http.experimental_websocket"),
  },
  rpc: {
    experimental_whileWatched: call("rpc.experimental_whileWatched"),
    experimental_invalidate: call("rpc.experimental_invalidate"),
    experimental_invalidateAll: call("rpc.experimental_invalidateAll"),
    register(contract: unknown, handlers: unknown, options?: unknown) {
      const records = normalizeRpcRegistration(
        contract,
        handlers,
        localRpcHandlers,
        options,
      );
      syncRequest({
        t: "call",
        path: "rpc.registerIsolated",
        args: [
          records.map(([name, record]) => ({
            name,
            publication: record.publication,
            invoke: (input: unknown, context: never) =>
              runPluginRpcMethod(record, input, context),
          })),
        ],
      });
      for (const [name, record] of records) localRpcHandlers.set(name, record);
    },
  },
  realtime: { publish: call("realtime.publish") },
  background: {
    service: call("background.service"),
    schedule: call("background.schedule"),
  },
  cli: { register: call("cli.register") },
  agents: {
    configure: unsupported("bb.agents.configure"),
    contributeInstructions: unsupported("bb.agents.contributeInstructions"),
    registerTool: unsupported("bb.agents.registerTool"),
  },
  providers: {
    register: unsupported("bb.providers.register"),
    experimental_contributeEnv: unsupported(
      "bb.providers.experimental_contributeEnv",
    ),
    experimental_contributeEnvHealth: unsupported(
      "bb.providers.experimental_contributeEnvHealth",
    ),
  },
  ui: {
    requestInput: call("ui.requestInput"),
    registerMentionProvider: unsupported("bb.ui.registerMentionProvider"),
  },
  events: { on: call("events.on") },
  experimental_hooks: {
    on: unsupported("bb.experimental_hooks.on"),
    recheck: call("experimental_hooks.recheck"),
  },
  experimental_environments: {
    register: unsupported("bb.experimental_environments.register"),
    recheck: call("experimental_environments.recheck"),
  },
  experimental_machines: {
    register: unsupported("bb.experimental_machines.register"),
    getResource: call("experimental_machines.getResource"),
    bootstrap: unsupported("bb.experimental_machines.bootstrap"),
  },
  experimental_serverAccess: {
    register: unsupported("bb.experimental_serverAccess.register"),
    recheck: call("experimental_serverAccess.recheck"),
  },
  status: { needsConfiguration: call("status.needsConfiguration") },
  server: {
    get experimental_appUrl() {
      return syncRequest({ t: "get", path: "server.experimental_appUrl" });
    },
    get loopbackBaseUrl() {
      return syncRequest({ t: "get", path: "server.loopbackBaseUrl" });
    },
    get experimental_dataDir() {
      return syncRequest({ t: "get", path: "server.experimental_dataDir" });
    },
    internal_DO_NOT_USE_openTunnelIngress: unsupported(
      "bb.server.internal_DO_NOT_USE_openTunnelIngress",
    ),
  },
  hosts: {
    experimental_client: unsupported("bb.hosts.experimental_client"),
    ensureSharedPortTunnel: call("hosts.ensureSharedPortTunnel"),
    declareSharedPorts: call("hosts.declareSharedPorts"),
    internal_DO_NOT_USE_setNextTunnels: unsupported(
      "bb.hosts.internal_DO_NOT_USE_setNextTunnels",
    ),
    internal_DO_NOT_USE_nextTunnelStatuses: unsupported(
      "bb.hosts.internal_DO_NOT_USE_nextTunnelStatuses",
    ),
    internal_DO_NOT_USE_onNextTunnelStatusChange: unsupported(
      "bb.hosts.internal_DO_NOT_USE_onNextTunnelStatusChange",
    ),
  },
  experimental_aiServices: {
    register: unsupported("bb.experimental_aiServices.register"),
  },
  get sdk(): PluginBbSdk {
    if (sdk !== undefined) return sdk;
    const credential = syncRequest({ t: "get", path: "sdkCredential" }) as {
      baseUrl: string;
      token: string;
    };
    sdk = wrapSdkForPlugin(
      createPluginRpcCallerSdk(credential),
      data.pluginId,
    );
    return sdk;
  },
  onDispose: call("onDispose"),
  onInstall: call("onInstall"),
} satisfies Record<keyof BbPluginApi, unknown>;

function installRuntimeExternals(): void {
  const externals = new Map(data.runtimeExternalUrls);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = externals.get(specifier);
      if (url !== undefined) return { url, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}

async function loadPlugin(): Promise<void> {
  const unsupportedMember = await findUnsupportedPluginServerApi(
    data.entryPath,
  );
  if (unsupportedMember !== null) unsupported(unsupportedMember)();
  installRuntimeExternals();
  let mod: { default?: unknown };
  if (data.loader === "cjs") {
    const exported: unknown = createRequire(import.meta.url)(data.entryPath);
    mod =
      typeof exported === "function"
        ? { default: exported }
        : (exported as { default?: unknown });
  } else {
    mod = (await import(pathToFileURL(data.entryPath).href)) as {
      default?: unknown;
    };
  }
  const factory = mod.default;
  if (typeof factory !== "function") {
    throw new Error(
      `server entry must default-export a factory (bb) => void, got ${typeof factory}`,
    );
  }
  await (factory as (bb: typeof api) => unknown)(api);
}

function closeDatabases(): void {
  for (const database of databaseHandles.splice(0)) {
    try {
      database.close();
    } catch (error) {
      post({
        t: "pluginLog",
        level: "warn",
        message: `database close failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

async function runControl(op: string): Promise<unknown> {
  switch (op) {
    case "load":
      return loadPlugin();
    case "close":
      closeDatabases();
      return undefined;
    case "maintainDatabases":
      return maintainPluginDatabases(
        databaseHandles.map((database) => ({
          database,
          pluginId: data.pluginId,
        })),
        {
          logger: serverLogger,
          checkpoint: async (database) => {
            database.pragma("wal_checkpoint(PASSIVE)");
          },
        },
      );
    default:
      throw new Error(`unknown plugin worker control "${op}"`);
  }
}

function settle(id: number, run: () => unknown): void {
  void Promise.resolve()
    .then(run)
    .then(
      (value) => {
        const transfer: Transferable[] = [];
        post({ t: "result", id, ok: true, value: codec.encode(value, transfer) }, transfer);
      },
      (error: unknown) => {
        post({ t: "result", id, ok: false, value: codec.encode(error) });
      },
    );
}

port.on("message", (message: CoreToWorkerMessage) => {
  switch (message.t) {
    case "invoke": {
      const fn = codec.exportedFunction(message.fn);
      settle(message.id, () =>
        invocationContext.run(message.id, () => {
          if (fn === undefined) {
            throw new Error(`plugin worker has no function ${message.fn}`);
          }
          return fn(...(codec.decode(message.args) as unknown[]));
        }),
      );
      return;
    }
    case "control":
      settle(message.id, () => runControl(message.op));
      return;
    case "abort":
      codec.abortImported(message.signal, message.reason);
      return;
    case "pending": {
      const waiter = pendingSync.get(message.id);
      if (waiter === undefined) return;
      pendingSync.delete(message.id);
      if (message.ok) waiter.resolve(codec.decode(message.value));
      else waiter.reject(codec.decode(message.value));
      return;
    }
  }
});

process.on("uncaughtException", (error: unknown) => {
  post({
    t: "uncaught",
    invocation: invocationContext.getStore() ?? null,
    error: codec.encode(error),
  });
});
