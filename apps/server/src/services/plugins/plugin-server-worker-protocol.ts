import type { MessagePort } from "node:worker_threads";

export const PLUGIN_RPC_REFUSAL_SYMBOL = Symbol.for(
  "@get-bb/plugin-sdk/rpc-refusal",
);

export const PLUGIN_SERVER_WORKER_UNSUPPORTED_ERROR =
  "PluginServerWorkerUnsupportedError";

export const SYNC_CALL_TIMEOUT_MS = 120_000;

export type PluginServerLoader = "cjs" | "esm";

export interface PluginServerWorkerData {
  pluginId: string;
  dataDir: string;
  entryPath: string;
  loader: PluginServerLoader;
  runtimeExternalUrls: Array<[string, string]>;
  syncPort: MessagePort;
  syncFlag: SharedArrayBuffer;
}

export type SyncRequest =
  | { t: "call"; path: string; args: unknown[] }
  | { t: "get"; path: string }
  | { t: "invoke"; fn: number; args: unknown[] };

export type SyncReply =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown }
  | { pending: number };

export type WorkerControlOp = "load" | "close" | "maintainDatabases";

export type CoreToWorkerMessage =
  | {
      t: "invoke";
      id: number;
      fn: number;
      args: unknown[];
    }
  | { t: "control"; id: number; op: WorkerControlOp }
  | { t: "abort"; signal: number; reason: unknown }
  | { t: "pending"; id: number; ok: boolean; value: unknown };

export type WorkerLogLevel = "debug" | "info" | "warn" | "error";

export type WorkerToCoreMessage =
  | { t: "result"; id: number; ok: boolean; value: unknown }
  | { t: "abort"; signal: number; reason: unknown }
  | { t: "pluginLog"; level: WorkerLogLevel; message: string }
  | {
      t: "serverLog";
      level: WorkerLogLevel;
      fields: unknown;
      message: string;
    }
  | { t: "uncaught"; invocation: number | null; error: unknown }
  | { t: "unsupported"; member: string };

const MARKER = "~bb";

const STRUCTURED_CLONE_PASSTHROUGH: ReadonlyArray<abstract new (
  ...args: never[]
) => object> = [
  Date,
  RegExp,
  Map,
  Set,
  ArrayBuffer,
  SharedArrayBuffer,
  Blob,
];

interface EncodedError {
  name: string;
  message: string;
  stack: string | undefined;
  refusal: boolean;
  props: Record<string, unknown>;
}

export interface RemoteCodecOptions {
  importFunction(id: number): (...args: unknown[]) => unknown;
  importHttpHandler?(id: number): (...args: unknown[]) => unknown;
  decodeError?(encoded: EncodedError, error: Error): Error;
  postAbort(signal: number, reason: unknown): void;
}

export class RemoteCodec {
  private nextFunctionId = 1;
  private nextSignalId = 1;
  private readonly exportedFunctions = new Map<
    number,
    (...args: unknown[]) => unknown
  >();
  private readonly exportedSignalIds = new WeakMap<AbortSignal, number>();
  private readonly importedSignals = new Map<number, WeakRef<AbortSignal>>();
  private readonly importedControllers = new WeakMap<
    AbortSignal,
    AbortController
  >();
  private readonly signalCleanup = new FinalizationRegistry<number>((id) => {
    this.importedSignals.delete(id);
  });
  private readonly httpHandlers = new WeakSet<object>();

  constructor(private readonly options: RemoteCodecOptions) {}

  markHttpHandler<T extends object>(fn: T): T {
    this.httpHandlers.add(fn);
    return fn;
  }

  exportFunction(fn: (...args: unknown[]) => unknown): number {
    const id = this.nextFunctionId++;
    this.exportedFunctions.set(id, fn);
    return id;
  }

  exportedFunction(id: number): ((...args: unknown[]) => unknown) | undefined {
    return this.exportedFunctions.get(id);
  }

  abortImported(id: number, reason: unknown): void {
    const signal = this.importedSignals.get(id)?.deref();
    if (signal === undefined) return;
    this.importedSignals.delete(id);
    this.importedControllers.get(signal)?.abort(this.decode(reason));
  }

  encode(value: unknown, transfer: Transferable[] = []): unknown {
    return this.encodeValue(value, transfer, new Map(), undefined);
  }

  decode(value: unknown): unknown {
    return this.decodeValue(value, new Map());
  }

  private exportSignal(signal: AbortSignal): number {
    const existing = this.exportedSignalIds.get(signal);
    if (existing !== undefined) return existing;
    const id = this.nextSignalId++;
    this.exportedSignalIds.set(signal, id);
    if (!signal.aborted) {
      signal.addEventListener(
        "abort",
        () => this.options.postAbort(id, this.encode(signal.reason)),
        { once: true },
      );
    }
    return id;
  }

  private importSignal(id: number, aborted: boolean, reason: unknown) {
    const live = this.importedSignals.get(id)?.deref();
    if (live !== undefined) return live;
    const controller = new AbortController();
    if (aborted) {
      controller.abort(this.decode(reason));
      return controller.signal;
    }
    this.importedControllers.set(controller.signal, controller);
    this.importedSignals.set(id, new WeakRef(controller.signal));
    this.signalCleanup.register(controller.signal, id);
    return controller.signal;
  }

  private encodeError(error: Error, transfer: Transferable[]): EncodedError {
    const props: Record<string, unknown> = {};
    for (const key of Object.keys(error)) {
      if (key === "name" || key === "message" || key === "stack") continue;
      props[key] = this.encode(Reflect.get(error, key), transfer);
    }
    if (error.cause !== undefined && !("cause" in props)) {
      props.cause = this.encode(error.cause, transfer);
    }
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      refusal: Reflect.get(error, PLUGIN_RPC_REFUSAL_SYMBOL) === true,
      props,
    };
  }

  private encodeValue(
    value: unknown,
    transfer: Transferable[],
    seen: Map<object, unknown>,
    holder: object | undefined,
  ): unknown {
    if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      if (this.httpHandlers.has(fn)) {
        return { [MARKER]: "http", id: this.exportFunction(fn) };
      }
      const bound = holder === undefined ? fn : fn.bind(holder);
      return { [MARKER]: "fn", id: this.exportFunction(bound) };
    }
    if (typeof value === "symbol") return undefined;
    if (typeof value !== "object" || value === null) return value;
    const prior = seen.get(value);
    if (prior !== undefined) return prior;
    if (value instanceof AbortSignal) {
      return {
        [MARKER]: "signal",
        id: this.exportSignal(value),
        aborted: value.aborted,
        reason: value.aborted ? this.encode(value.reason, transfer) : undefined,
      };
    }
    if (value instanceof Error) {
      return { [MARKER]: "error", error: this.encodeError(value, transfer) };
    }
    if (value instanceof ReadableStream) {
      transfer.push(value as unknown as Transferable);
      return value;
    }
    if (value instanceof Response) {
      const body = value.body;
      if (body !== null) transfer.push(body as unknown as Transferable);
      return {
        [MARKER]: "response",
        status: value.status,
        statusText: value.statusText,
        headers: [...value.headers],
        body,
      };
    }
    if (ArrayBuffer.isView(value)) return value;
    if (
      STRUCTURED_CLONE_PASSTHROUGH.some((type) => value instanceof type)
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) {
        out.push(this.encodeValue(item, transfer, seen, value));
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const key of Object.keys(value)) {
      out[key] = this.encodeValue(
        Reflect.get(value, key),
        transfer,
        seen,
        value,
      );
    }
    if (MARKER in out) return { [MARKER]: "object", entries: out };
    return out;
  }

  private decodeValue(value: unknown, seen: Map<object, unknown>): unknown {
    if (typeof value !== "object" || value === null) return value;
    const prior = seen.get(value);
    if (prior !== undefined) return prior;
    if (
      ArrayBuffer.isView(value) ||
      value instanceof ReadableStream ||
      STRUCTURED_CLONE_PASSTHROUGH.some((type) => value instanceof type)
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      seen.set(value, out);
      for (const item of value) out.push(this.decodeValue(item, seen));
      return out;
    }
    const marker: unknown = Reflect.get(value, MARKER);
    if (typeof marker === "string") {
      return this.decodeMarker(marker, value, seen);
    }
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const key of Object.keys(value)) {
      out[key] = this.decodeValue(Reflect.get(value, key), seen);
    }
    return out;
  }

  private decodeMarker(
    marker: string,
    value: object,
    seen: Map<object, unknown>,
  ): unknown {
    switch (marker) {
      case "fn":
        return this.options.importFunction(Number(Reflect.get(value, "id")));
      case "http": {
        const importHttp = this.options.importHttpHandler;
        if (importHttp === undefined) {
          throw new Error("http handlers cannot cross in this direction");
        }
        return importHttp(Number(Reflect.get(value, "id")));
      }
      case "signal":
        return this.importSignal(
          Number(Reflect.get(value, "id")),
          Reflect.get(value, "aborted") === true,
          Reflect.get(value, "reason"),
        );
      case "error":
        return this.decodeEncodedError(
          Reflect.get(value, "error") as EncodedError,
        );
      case "response": {
        const status = Number(Reflect.get(value, "status"));
        const body = Reflect.get(value, "body") as ReadableStream | null;
        return new Response(body, {
          status,
          statusText: String(Reflect.get(value, "statusText")),
          headers: Reflect.get(value, "headers") as Array<[string, string]>,
        });
      }
      case "object": {
        const entries = Reflect.get(value, "entries") as Record<
          string,
          unknown
        >;
        const out: Record<string, unknown> = {};
        seen.set(value, out);
        for (const key of Object.keys(entries)) {
          out[key] = this.decodeValue(entries[key], seen);
        }
        return out;
      }
      default:
        throw new Error(`unknown plugin worker value marker "${marker}"`);
    }
  }

  private decodeEncodedError(encoded: EncodedError): Error {
    const error = new Error(encoded.message);
    error.name = encoded.name;
    if (encoded.stack !== undefined) error.stack = encoded.stack;
    for (const [key, prop] of Object.entries(encoded.props)) {
      Reflect.set(error, key, this.decode(prop));
    }
    if (encoded.refusal) {
      Reflect.set(error, PLUGIN_RPC_REFUSAL_SYMBOL, true);
    }
    return this.options.decodeError?.(encoded, error) ?? error;
  }
}
