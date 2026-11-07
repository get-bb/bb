import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MessageChannel,
  SHARE_ENV,
  Worker,
  type MessagePort,
} from "node:worker_threads";
import type { Context } from "hono";
import type { InstalledPluginRow } from "@bb/db";
import type { ServerLogger } from "../../types.js";
import {
  PluginContextStaleError,
  type PluginApiHandle,
  type PluginRpcHandler,
} from "./plugin-api.js";
import { PluginRpcBoundaryError } from "./plugin-rpc-method.js";
import {
  PLUGIN_SERVER_WORKER_UNSUPPORTED_ERROR,
  RemoteCodec,
  type CoreToWorkerMessage,
  type PluginServerLoader,
  type PluginServerWorkerData,
  type SyncReply,
  type SyncRequest,
  type WorkerControlOp,
  type WorkerToCoreMessage,
} from "./plugin-server-worker-protocol.js";

export function isPluginServerIsolationCandidate(
  row: Pick<InstalledPluginRow, "provenance" | "sourceKind">,
): boolean {
  return (
    row.provenance !== "builtin" &&
    (row.sourceKind === "git" || row.sourceKind === "npm")
  );
}

export function isPluginServerWorkerUnsupportedError(
  error: unknown,
): error is Error {
  return (
    error instanceof Error &&
    error.name === PLUGIN_SERVER_WORKER_UNSUPPORTED_ERROR
  );
}

export function pluginServerWorkerUnsupportedError(member: string): Error {
  const error = new Error(
    `${member} is not available to a plugin server running in its own worker yet`,
  );
  error.name = PLUGIN_SERVER_WORKER_UNSUPPORTED_ERROR;
  return error;
}

const WORKER_ENTRY_CANDIDATES = [
  "./plugin-server-worker.js",
  "./plugin-server-worker.ts",
];

function resolveWorkerEntry(): { url: URL; execArgv: string[] | undefined } {
  for (const candidate of WORKER_ENTRY_CANDIDATES) {
    const url = new URL(candidate, import.meta.url);
    if (!existsSync(fileURLToPath(url))) continue;
    if (candidate.endsWith(".js")) return { url, execArgv: undefined };
    const tsx = pathToFileURL(
      createRequire(import.meta.url).resolve("tsx/esm"),
    ).href;
    return {
      url,
      execArgv: ["--conditions=source", "--import", tsx],
    };
  }
  throw new Error(
    `plugin server worker entry not found beside ${fileURLToPath(import.meta.url)}`,
  );
}

export interface PluginServerWorker {
  readonly startupMs: number;
  load(): Promise<void>;
  maintainDatabases(): Promise<void>;
  close(timeoutMs: number): Promise<void>;
  terminate(): Promise<void>;
}

export interface StartPluginServerWorkerArgs {
  pluginId: string;
  dataDir: string;
  entry: { path: string; loader: PluginServerLoader };
  runtimeExternalUrls: ReadonlyMap<string, string>;
  handle: PluginApiHandle;
  rpcCallerToken: string;
  logger: ServerLogger;
  captureInvocationContext(): unknown;
  onUncaught(error: unknown, invocationContext: unknown): void;
  onUnsupported(member: string): void;
  onExit(detail: string): void;
}

interface PendingInvocation {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

function resolveApiPath(
  root: object,
  path: string,
): { holder: object; key: string } {
  const segments = path.split(".");
  const key = segments.pop();
  let holder: unknown = root;
  for (const segment of segments) {
    holder =
      typeof holder === "object" && holder !== null
        ? Reflect.get(holder, segment)
        : undefined;
  }
  if (key === undefined || typeof holder !== "object" || holder === null) {
    throw new Error(`unknown plugin API member "${path}"`);
  }
  return { holder, key };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

export function startPluginServerWorker(
  args: StartPluginServerWorkerArgs,
): PluginServerWorker {
  const startedAt = performance.now();
  const { url, execArgv } = resolveWorkerEntry();
  const channel = new MessageChannel();
  const syncPort: MessagePort = channel.port1;
  const syncFlagBuffer = new SharedArrayBuffer(4);
  const syncFlag = new Int32Array(syncFlagBuffer);
  const workerData: PluginServerWorkerData = {
    pluginId: args.pluginId,
    dataDir: args.dataDir,
    entryPath: args.entry.path,
    loader: args.entry.loader,
    runtimeExternalUrls: [...args.runtimeExternalUrls],
    syncPort: channel.port2,
    syncFlag: syncFlagBuffer,
  };
  const worker = new Worker(url, {
    workerData,
    transferList: [channel.port2],
    env: SHARE_ENV,
    name: `bb-plugin-server:${args.pluginId}`,
    ...(execArgv === undefined ? {} : { execArgv }),
  });

  let nextInvocationId = 1;
  let nextPendingId = 1;
  let exited = false;
  let closing = false;
  let lastError: unknown;
  const pending = new Map<number, PendingInvocation>();
  const invocationContexts = new Map<number, unknown>();

  function post(message: CoreToWorkerMessage, transfer: Transferable[] = []) {
    if (exited) return;
    worker.postMessage(message, transfer as never);
  }

  function invokeWorker(
    message:
      | { t: "invoke"; fn: number; args: unknown[] }
      | { t: "control"; op: WorkerControlOp },
  ): Promise<unknown> {
    if (exited) {
      return Promise.reject(
        new Error(`plugin "${args.pluginId}" server worker is not running`),
      );
    }
    const id = nextInvocationId++;
    const context = args.captureInvocationContext();
    if (context !== undefined) invocationContexts.set(id, context);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (message.t === "control") {
        post({ t: "control", id, op: message.op });
        return;
      }
      const transfer: Transferable[] = [];
      let encodedArgs: unknown[];
      try {
        encodedArgs = message.args.map((arg) => codec.encode(arg, transfer));
      } catch (error) {
        pending.delete(id);
        reject(error);
        return;
      }
      post({ t: "invoke", id, fn: message.fn, args: encodedArgs }, transfer);
    });
  }

  const codec: RemoteCodec = new RemoteCodec({
    importFunction: (id) => {
      return (...callArgs: unknown[]) => {
        const result = invokeWorker({ t: "invoke", fn: id, args: callArgs });
        result.catch(() => {});
        return result;
      };
    },
    importHttpHandler: (id) => {
      return async (...callArgs: unknown[]) => {
        const raw = (callArgs[0] as Context).req.raw;
        return invokeWorker({
          t: "invoke",
          fn: id,
          args: [
            {
              url: raw.url,
              method: raw.method,
              headers: [...raw.headers],
              body: raw.body,
              signal: raw.signal,
            },
          ],
        });
      };
    },
    decodeError: (encoded, error) => {
      if (encoded.name === "PluginContextStaleError") {
        return new PluginContextStaleError(args.pluginId);
      }
      if (encoded.name === "PluginRpcBoundaryError") {
        const rpcError = Reflect.get(error, "rpcError");
        if (typeof rpcError === "object" && rpcError !== null) {
          return new PluginRpcBoundaryError(
            rpcError as PluginRpcBoundaryError["rpcError"],
          );
        }
      }
      return error;
    },
    postAbort: (signal, reason) => post({ t: "abort", signal, reason }),
  });

  function registerIsolatedRpc(
    methods: Array<{
      name: string;
      publication: PluginRpcHandler["publication"];
      invoke: PluginRpcHandler["invoke"];
    }>,
  ): void {
    args.handle.assertLive();
    for (const method of methods) {
      args.handle.rpcHandlers.set(method.name, {
        publication: method.publication,
        invoke: method.invoke,
      });
    }
  }

  function readSdkCredential(): { baseUrl: string; token: string } {
    void args.handle.api.sdk;
    return {
      baseUrl: args.handle.api.server.loopbackBaseUrl,
      token: args.rpcCallerToken,
    };
  }

  function runSyncRequest(request: SyncRequest): unknown {
    if (request.t === "get") {
      if (request.path === "sdkCredential") return readSdkCredential();
      const { holder, key } = resolveApiPath(args.handle.api, request.path);
      return Reflect.get(holder, key);
    }
    const callArgs = codec.decode(request.args) as unknown[];
    if (request.t === "invoke") {
      const fn = codec.exportedFunction(request.fn);
      if (fn === undefined) {
        throw new Error(`plugin API function ${request.fn} is not available`);
      }
      return fn(...callArgs);
    }
    if (request.path === "rpc.registerIsolated") {
      registerIsolatedRpc(callArgs[0] as Parameters<typeof registerIsolatedRpc>[0]);
      return undefined;
    }
    const { holder, key } = resolveApiPath(args.handle.api, request.path);
    const member: unknown = Reflect.get(holder, key);
    if (typeof member !== "function") {
      throw new Error(`plugin API member "${request.path}" is not a function`);
    }
    return Reflect.apply(member, holder, callArgs);
  }

  function reply(message: SyncReply, transfer: Transferable[] = []): void {
    syncPort.postMessage(message, transfer as never);
    Atomics.store(syncFlag, 0, 1);
    Atomics.notify(syncFlag, 0);
  }

  syncPort.on("message", (request: SyncRequest) => {
    let value: unknown;
    try {
      value = runSyncRequest(request);
    } catch (error) {
      reply({ ok: false, error: codec.encode(error) });
      return;
    }
    if (isThenable(value)) {
      const pendingId = nextPendingId++;
      reply({ pending: pendingId });
      Promise.resolve(value).then(
        (resolved) => {
          const transfer: Transferable[] = [];
          post(
            {
              t: "pending",
              id: pendingId,
              ok: true,
              value: codec.encode(resolved, transfer),
            },
            transfer,
          );
        },
        (error: unknown) => {
          post({
            t: "pending",
            id: pendingId,
            ok: false,
            value: codec.encode(error),
          });
        },
      );
      return;
    }
    const transfer: Transferable[] = [];
    let encoded: unknown;
    try {
      encoded = codec.encode(value, transfer);
    } catch (error) {
      reply({ ok: false, error: codec.encode(error) });
      return;
    }
    reply({ ok: true, value: encoded }, transfer);
  });

  worker.on("message", (message: WorkerToCoreMessage) => {
    switch (message.t) {
      case "result": {
        const waiter = pending.get(message.id);
        if (waiter === undefined) return;
        pending.delete(message.id);
        let decoded: unknown;
        try {
          decoded = codec.decode(message.value);
        } catch (error) {
          waiter.reject(error);
          return;
        }
        if (message.ok) waiter.resolve(decoded);
        else waiter.reject(decoded);
        return;
      }
      case "abort":
        codec.abortImported(message.signal, message.reason);
        return;
      case "pluginLog":
        args.handle.api.log[message.level](message.message);
        return;
      case "serverLog": {
        const fields = codec.decode(message.fields);
        const logFields =
          typeof fields === "object" && fields !== null ? fields : {};
        args.logger[message.level](logFields, message.message);
        return;
      }
      case "uncaught":
        args.onUncaught(
          codec.decode(message.error),
          message.invocation === null
            ? undefined
            : invocationContexts.get(message.invocation),
        );
        return;
      case "unsupported":
        args.onUnsupported(message.member);
        return;
    }
  });

  worker.on("error", (error) => {
    lastError = error;
  });

  const exitedPromise = new Promise<void>((resolve) => {
    worker.once("exit", (code) => {
      exited = true;
      syncPort.close();
      const detail =
        lastError instanceof Error
          ? `server worker exited: ${lastError.message}`
          : `server worker exited with code ${code}`;
      for (const waiter of pending.values()) {
        waiter.reject(new Error(`plugin "${args.pluginId}" ${detail}`));
      }
      pending.clear();
      invocationContexts.clear();
      if (!closing) args.onExit(detail);
      resolve();
    });
  });

  async function terminate(): Promise<void> {
    closing = true;
    if (!exited) await worker.terminate();
    await exitedPromise;
  }

  return {
    get startupMs() {
      return performance.now() - startedAt;
    },
    async load() {
      await invokeWorker({ t: "control", op: "load" });
    },
    async maintainDatabases() {
      await invokeWorker({ t: "control", op: "maintainDatabases" });
    },
    async close(timeoutMs) {
      closing = true;
      if (!exited) {
        await Promise.race([
          invokeWorker({ t: "control", op: "close" }).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
        ]);
      }
      await terminate();
    },
    terminate,
  };
}
