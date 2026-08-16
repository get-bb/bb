import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

interface ValidationIssue {
  readonly message: string;
}

interface StandardSchema {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: unknown; readonly issues?: undefined }
      | { readonly issues: readonly ValidationIssue[] }
      | Promise<
          | { readonly value: unknown; readonly issues?: undefined }
          | { readonly issues: readonly ValidationIssue[] }
        >;
  };
}

interface HostEntry {
  readonly experimental_apiVersion: 1;
  readonly contract: {
    readonly methods: Readonly<
      Record<
        string,
        {
          readonly input: StandardSchema;
          readonly output: StandardSchema;
          readonly target:
            | { readonly kind: "host" }
            | {
                readonly kind: "environment";
                readonly scheduling: "shared" | "exclusive";
              };
        }
      >
    >;
    readonly signals?: Readonly<
      Record<
        string,
        {
          readonly payload: StandardSchema;
          readonly target: "host" | "environment";
        }
      >
    >;
  };
  readonly handlers: Readonly<
    Record<
      string,
      (input: unknown, context: HostCallContext) => unknown | Promise<unknown>
    >
  >;
  readonly dispose?: () => void | Promise<void>;
}

interface HostCallContext {
  readonly target:
    | { readonly kind: "host"; readonly hostId: string }
    | {
        readonly kind: "environment";
        readonly hostId: string;
        readonly environmentId: string;
      };
  readonly cwd: string | null;
  readonly signal: AbortSignal;
  readonly lifecycle: { readonly signal: AbortSignal };
  readonly paths: { readonly dataDir: string; readonly tempDir: string };
  readonly signals: {
    publish(signal: string, payload: unknown): void;
  };
  experimental_watch(
    options: HostWatchOptions,
    listener: HostWatchListener,
  ): Promise<HostWatchSubscription>;
}

interface HostWatchOptions {
  readonly rootPath: string;
  readonly ignoredPaths: readonly string[];
  readonly debounceMs: number;
  readonly maxWaitMs: number;
}

type HostWatchEvent =
  | {
      readonly kind: "changed";
      readonly changes: readonly {
        readonly path: string;
        readonly type: "create" | "update" | "delete";
      }[];
    }
  | { readonly kind: "rescan-required" }
  | { readonly kind: "watch-error"; readonly message: string };

type HostWatchListener = (event: HostWatchEvent) => void | Promise<void>;

interface HostWatchSubscription {
  dispose(): Promise<void>;
}

interface WorkerWatchState {
  readonly watchId: string;
  readonly listener: HostWatchListener;
  readonly subscription: HostWatchSubscription;
  resolve: (subscription: HostWatchSubscription) => void;
  reject: (error: Error) => void;
  ready: boolean;
  disposed: boolean;
}

interface CallMessage {
  readonly type: "call";
  readonly callId: string;
  readonly method: string;
  readonly input: unknown;
  readonly scheduling: "shared" | "exclusive" | null;
  readonly context: Omit<HostCallContext, "signal" | "lifecycle" | "signals">;
}

interface CancelMessage {
  readonly type: "cancel";
  readonly callId: string;
}

interface DisposeMessage {
  readonly type: "dispose";
}

interface WatchReadyMessage {
  readonly type: "watch-ready";
  readonly watchId: string;
}

interface WatchStartErrorMessage {
  readonly type: "watch-start-error";
  readonly watchId: string;
  readonly error: string;
}

interface WatchEventMessage {
  readonly type: "watch-event";
  readonly watchId: string;
  readonly sequence: number;
  readonly event: HostWatchEvent;
}

type ParentMessage =
  | CallMessage
  | CancelMessage
  | DisposeMessage
  | WatchReadyMessage
  | WatchStartErrorMessage
  | WatchEventMessage;

const RESULT_MAX_BYTES = 8 * 1024 * 1024;
const HOST_WORKER_PROTOCOL_VERSION = 1;
const MAX_WATCH_IGNORE_ENTRIES = 4_096;
const MAX_WATCH_PATH_BYTES = 16 * 1024;
const MIN_WATCH_DEBOUNCE_MS = 10;
const MAX_WATCH_DEBOUNCE_MS = 5_000;
const MAX_WATCH_WAIT_MS = 30_000;
const lifecycleController = new AbortController();
const callControllers = new Map<string, AbortController>();
const watches = new Map<string, WorkerWatchState>();
let nextWatchId = 1;
let entry: HostEntry | null = null;
let disposing = false;

function send(message: object): void {
  if (process.connected) process.send?.(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is StandardSchema {
  if (!isRecord(value)) return false;
  const standard = value["~standard"];
  return isRecord(standard) && typeof standard.validate === "function";
}

function parseHostWatchEvent(value: unknown): HostWatchEvent | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "rescan-required") return { kind: value.kind };
  if (value.kind === "watch-error" && typeof value.message === "string") {
    return { kind: value.kind, message: value.message };
  }
  if (value.kind !== "changed" || !Array.isArray(value.changes)) return null;
  const changes: Array<{
    path: string;
    type: "create" | "update" | "delete";
  }> = [];
  for (const change of value.changes) {
    if (!isRecord(change) || typeof change.path !== "string") return null;
    if (
      change.type !== "create" &&
      change.type !== "update" &&
      change.type !== "delete"
    ) {
      return null;
    }
    changes.push({ path: change.path, type: change.type });
  }
  return { kind: value.kind, changes };
}

function isMethodTarget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "host") return Object.keys(value).length === 1;
  return (
    value.kind === "environment" &&
    (value.scheduling === "shared" || value.scheduling === "exclusive")
  );
}

function parseEntry(value: unknown): HostEntry {
  if (!isRecord(value) || value.experimental_apiVersion !== 1) {
    throw new Error(
      "host artifact must default-export experimental_defineHostEntry(...)",
    );
  }
  if (!isRecord(value.contract) || !isRecord(value.contract.methods)) {
    throw new Error("host entry is missing its methods contract");
  }
  if (!isRecord(value.handlers)) {
    throw new Error("host entry is missing handlers");
  }
  for (const [name, method] of Object.entries(value.contract.methods)) {
    if (
      !isRecord(method) ||
      !isSchema(method.input) ||
      !isSchema(method.output) ||
      !isMethodTarget(method.target) ||
      typeof value.handlers[name] !== "function"
    ) {
      throw new Error(
        `host entry has an invalid or missing handler for "${name}"`,
      );
    }
  }
  if (value.contract.signals !== undefined) {
    if (!isRecord(value.contract.signals)) {
      throw new Error("host entry signals contract must be an object");
    }
    for (const [name, signal] of Object.entries(value.contract.signals)) {
      if (
        !isRecord(signal) ||
        !isSchema(signal.payload) ||
        (signal.target !== "host" && signal.target !== "environment")
      ) {
        throw new Error(`host entry has an invalid signal "${name}"`);
      }
    }
  }
  // This is the process boundary: the structural checks above narrow the
  // executable artifact before it enters the worker runtime.
  return value as unknown as HostEntry;
}

async function validate(
  schema: StandardSchema,
  value: unknown,
): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues !== undefined) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.value;
}

function jsonValue(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("host handler returned a non-JSON value");
  }
  if (Buffer.byteLength(serialized) > RESULT_MAX_BYTES) {
    throw new Error(`host handler result exceeds ${RESULT_MAX_BYTES} bytes`);
  }
  return JSON.parse(serialized) as unknown;
}

function validateWatchOptions(value: HostWatchOptions): HostWatchOptions {
  if (
    !isRecord(value) ||
    typeof value.rootPath !== "string" ||
    !isAbsolute(value.rootPath) ||
    Buffer.byteLength(value.rootPath) > MAX_WATCH_PATH_BYTES ||
    !Array.isArray(value.ignoredPaths) ||
    value.ignoredPaths.length > MAX_WATCH_IGNORE_ENTRIES ||
    value.ignoredPaths.some(
      (entry) =>
        typeof entry !== "string" ||
        Buffer.byteLength(entry) > MAX_WATCH_PATH_BYTES,
    ) ||
    !Number.isInteger(value.debounceMs) ||
    value.debounceMs < MIN_WATCH_DEBOUNCE_MS ||
    value.debounceMs > MAX_WATCH_DEBOUNCE_MS ||
    !Number.isInteger(value.maxWaitMs) ||
    value.maxWaitMs < value.debounceMs ||
    value.maxWaitMs > MAX_WATCH_WAIT_MS
  ) {
    throw new Error("invalid host watch options");
  }
  return value;
}

function startWatch(
  options: HostWatchOptions,
  listener: HostWatchListener,
  requestSignal: AbortSignal,
): Promise<HostWatchSubscription> {
  const validated = validateWatchOptions(options);
  if (typeof listener !== "function") {
    throw new Error("host watch listener must be a function");
  }
  if (disposing || lifecycleController.signal.aborted) {
    throw new Error("host worker is disposing");
  }
  const watchId = String(nextWatchId++);
  let resolve!: (subscription: HostWatchSubscription) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<HostWatchSubscription>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const subscription: HostWatchSubscription = {
    async dispose() {
      const state = watches.get(watchId);
      if (state === undefined || state.disposed) return;
      state.disposed = true;
      watches.delete(watchId);
      send({ type: "watch-stop", watchId });
      if (!state.ready) state.reject(new Error("host watch was disposed"));
    },
  };
  const state: WorkerWatchState = {
    watchId,
    listener,
    subscription,
    resolve,
    reject,
    ready: false,
    disposed: false,
  };
  watches.set(watchId, state);
  const abort = (): void => {
    void subscription.dispose();
  };
  requestSignal.addEventListener("abort", abort, { once: true });
  lifecycleController.signal.addEventListener("abort", abort, { once: true });
  const cleanup = (): void => {
    requestSignal.removeEventListener("abort", abort);
    lifecycleController.signal.removeEventListener("abort", abort);
  };
  void pending.then(cleanup, cleanup);
  if (requestSignal.aborted || lifecycleController.signal.aborted) {
    void subscription.dispose();
    return pending;
  }
  send({
    type: "watch-start",
    watchId,
    rootPath: validated.rootPath,
    ignoredPaths: [...validated.ignoredPaths],
    debounceMs: validated.debounceMs,
    maxWaitMs: validated.maxWaitMs,
  });
  return pending;
}

function handleWatchReady(message: WatchReadyMessage): void {
  const state = watches.get(message.watchId);
  if (state === undefined || state.disposed || state.ready) return;
  state.ready = true;
  state.resolve(state.subscription);
}

function handleWatchStartError(message: WatchStartErrorMessage): void {
  const state = watches.get(message.watchId);
  if (state === undefined || state.disposed || state.ready) return;
  state.disposed = true;
  watches.delete(message.watchId);
  state.reject(new Error(message.error));
}

function handleWatchEvent(message: WatchEventMessage): void {
  const state = watches.get(message.watchId);
  if (state === undefined || state.disposed) {
    send({
      type: "watch-ack",
      watchId: message.watchId,
      sequence: message.sequence,
    });
    return;
  }
  void Promise.resolve()
    .then(() => state.listener(message.event))
    .catch((error) => {
      process.stderr.write(
        `Host watch listener failed: ${errorMessage(error)}\n`,
      );
    })
    .finally(() => {
      send({
        type: "watch-ack",
        watchId: message.watchId,
        sequence: message.sequence,
      });
    });
}

async function handleCall(message: CallMessage): Promise<void> {
  const activeEntry = entry;
  if (activeEntry === null || disposing) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: "host worker is disposing",
    });
    return;
  }
  const method = activeEntry.contract.methods[message.method];
  const handler = activeEntry.handlers[message.method];
  if (method === undefined || handler === undefined) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: `unknown host method "${message.method}"`,
    });
    return;
  }
  if (
    method.target.kind !== message.context.target.kind ||
    (method.target.kind === "host" && message.scheduling !== null) ||
    (method.target.kind === "environment" &&
      method.target.scheduling !== message.scheduling)
  ) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: `host method "${message.method}" target or scheduling does not match its contract`,
    });
    return;
  }
  const controller = new AbortController();
  callControllers.set(message.callId, controller);
  const abortForLifecycle = (): void => controller.abort();
  lifecycleController.signal.addEventListener("abort", abortForLifecycle, {
    once: true,
  });
  try {
    const input = await validate(method.input, message.input);
    const context: HostCallContext = {
      ...message.context,
      signal: controller.signal,
      lifecycle: { signal: lifecycleController.signal },
      signals: {
        publish(signalName, payload) {
          const signal = activeEntry.contract.signals?.[signalName];
          if (signal === undefined) {
            throw new Error(`unknown host signal "${signalName}"`);
          }
          if (signal.target !== message.context.target.kind) {
            throw new Error(
              `host signal "${signalName}" cannot be published for a ${message.context.target.kind} target`,
            );
          }
          void validate(signal.payload, payload)
            .then((validated) => {
              send({
                type: "signal",
                signal: signalName,
                payload: jsonValue(validated),
                target: message.context.target,
              });
            })
            .catch((error) => {
              process.stderr.write(
                `Invalid host signal ${signalName}: ${errorMessage(error)}\n`,
              );
            });
        },
      },
      experimental_watch: (options, listener) =>
        startWatch(options, listener, controller.signal),
    };
    const output = await handler(input, context);
    const validatedOutput = await validate(method.output, output);
    send({
      type: "result",
      callId: message.callId,
      ok: true,
      output: jsonValue(validatedOutput),
    });
  } catch (error) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: errorMessage(error),
    });
  } finally {
    lifecycleController.signal.removeEventListener("abort", abortForLifecycle);
    callControllers.delete(message.callId);
  }
}

async function dispose(): Promise<void> {
  if (disposing) return;
  disposing = true;
  lifecycleController.abort();
  for (const controller of callControllers.values()) controller.abort();
  await Promise.all(
    [...watches.values()].map((watch) => watch.subscription.dispose()),
  );
  try {
    await entry?.dispose?.();
  } finally {
    send({ type: "disposed" });
    process.disconnect?.();
  }
}

function parseParentMessage(value: unknown): ParentMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (
    value.type === "call" &&
    typeof value.callId === "string" &&
    typeof value.method === "string" &&
    (value.scheduling === null ||
      value.scheduling === "shared" ||
      value.scheduling === "exclusive") &&
    isRecord(value.context)
  ) {
    return value as unknown as CallMessage;
  }
  if (value.type === "cancel" && typeof value.callId === "string") {
    return { type: "cancel", callId: value.callId };
  }
  if (value.type === "dispose") return { type: "dispose" };
  if (value.type === "watch-ready" && typeof value.watchId === "string") {
    return { type: "watch-ready", watchId: value.watchId };
  }
  if (
    value.type === "watch-start-error" &&
    typeof value.watchId === "string" &&
    typeof value.error === "string"
  ) {
    return {
      type: "watch-start-error",
      watchId: value.watchId,
      error: value.error,
    };
  }
  if (
    value.type === "watch-event" &&
    typeof value.watchId === "string" &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence)
  ) {
    const event = parseHostWatchEvent(value.event);
    if (event !== null) {
      return {
        type: "watch-event",
        watchId: value.watchId,
        sequence: value.sequence,
        event,
      };
    }
  }
  return null;
}

process.on("message", (raw: unknown) => {
  const message = parseParentMessage(raw);
  if (message === null) return;
  if (message.type === "call") void handleCall(message);
  else if (message.type === "cancel")
    callControllers.get(message.callId)?.abort();
  else if (message.type === "watch-ready") handleWatchReady(message);
  else if (message.type === "watch-start-error") handleWatchStartError(message);
  else if (message.type === "watch-event") handleWatchEvent(message);
  else void dispose();
});
process.once("disconnect", () => void dispose());
process.once("SIGTERM", () => void dispose());

const artifactPath = process.argv[2];
const pluginId = process.argv[3];
const generation = process.argv[4];
if (!artifactPath) {
  throw new Error("host worker requires an artifact path");
}
if (!pluginId || !generation) {
  throw new Error("host worker requires plugin identity arguments");
}
try {
  const imported: unknown = await import(pathToFileURL(artifactPath).href);
  if (!isRecord(imported) || !("default" in imported)) {
    throw new Error("host artifact has no default export");
  }
  entry = parseEntry(imported.default);
  send({
    type: "ready",
    protocolVersion: HOST_WORKER_PROTOCOL_VERSION,
    pluginId,
    generation,
  });
} catch (error) {
  send({ type: "startup-error", error: errorMessage(error) });
  process.exitCode = 1;
  process.disconnect?.();
}
