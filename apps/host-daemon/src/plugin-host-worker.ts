import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const HOST_WORKER_PROTOCOL_VERSION = 2;
const RESULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_DISPOSE_TIMEOUT_MS = 5_000;

interface HostRuntimeObject {}

interface HostRecord {}

interface HostFunction {
  (
    ...args: HostBoundaryValue[]
  ): HostBoundaryValue | Promise<HostBoundaryValue>;
}

type HostBoundaryValue =
  | HostRecord
  | HostFunction
  | HostRuntimeObject
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

interface StandardSchemaResult {
  readonly value?: HostBoundaryValue;
  readonly issues?: readonly { readonly message: string }[];
}

interface StandardSchema {
  readonly "~standard": {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult | Promise<StandardSchemaResult>;
  };
}

interface HostMethod {
  readonly input: StandardSchema;
  readonly output: StandardSchema;
}

interface HostSignal {
  readonly payload: StandardSchema;
}

interface ResolvedHostWatchOptions {
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

type HostWatchChangeType = "create" | "update" | "delete";

type HostWatchListener = (event: HostWatchEvent) => void | Promise<void>;

interface HostWatchSubscription {
  dispose(): Promise<void>;
}

interface HostWorkerLease {
  dispose(): Promise<void>;
}

interface WorkerWatchState {
  readonly listener: HostWatchListener;
  readonly subscription: HostWatchSubscription;
  resolve: (subscription: HostWatchSubscription) => void;
  reject: (error: Error) => void;
  ready: boolean;
  disposed: boolean;
}

interface HostContext {
  readonly signal: AbortSignal;
  readonly lifecycle: { readonly signal: AbortSignal };
  readonly experimental_paths: {
    readonly dataDir: string;
    readonly tempDir: string;
  };
  experimental_emitSignal(
    signal: string,
    payload: HostBoundaryValue,
  ): Promise<void>;
  experimental_watch(
    options: HostBoundaryValue,
    listener: HostBoundaryValue,
  ): Promise<HostWatchSubscription>;
  experimental_retainWorker(): HostWorkerLease;
}

interface HostEntry {
  readonly experimental_apiVersion: 1;
  readonly contract: Readonly<Record<string, HostMethod>>;
  readonly experimental_signals?: Readonly<Record<string, HostSignal>>;
  readonly handlers: Readonly<
    Record<
      string,
      (
        input: HostBoundaryValue,
        context: HostContext,
      ) => HostBoundaryValue | Promise<HostBoundaryValue>
    >
  >;
  readonly dispose?: () => void | Promise<void>;
}

type ParentMessage =
  | {
      readonly type: "call";
      readonly callId: string;
      readonly method: string;
      readonly input: HostBoundaryValue;
    }
  | { readonly type: "cancel"; readonly callId: string }
  | { readonly type: "dispose" }
  | { readonly type: "watch-ready"; readonly watchId: string }
  | {
      readonly type: "watch-start-error";
      readonly watchId: string;
      readonly error: string;
    }
  | {
      readonly type: "watch-event";
      readonly watchId: string;
      readonly sequence: number;
      readonly event: HostWatchEvent;
    };

const MAX_WATCH_IGNORE_ENTRIES = 4_096;
const MAX_WATCH_PATH_BYTES = 16 * 1024;
const MIN_WATCH_DEBOUNCE_MS = 10;
const MAX_WATCH_DEBOUNCE_MS = 5_000;
const MAX_WATCH_WAIT_MS = 30_000;

function isHostFunction(value: HostBoundaryValue): value is HostFunction {
  return value instanceof Function;
}

function isRecord(value: HostBoundaryValue): value is HostRecord {
  return (
    value instanceof Object && !Array.isArray(value) && !isHostFunction(value)
  );
}

function hasProperty(value: HostRecord, key: string): boolean {
  return Object.getOwnPropertyDescriptor(value, key) !== undefined;
}

function readProperty(
  value: HostRecord,
  key: string,
): HostBoundaryValue | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if ("value" in descriptor) return descriptor.value;
  return descriptor.get?.call(value);
}

function readEntries(
  value: HostRecord,
): readonly [string, HostBoundaryValue][] {
  return Object.entries(value);
}

function isString(value: HostBoundaryValue): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isNumber(value: HostBoundaryValue): value is number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

function isHostWatchChangeType(
  value: HostBoundaryValue,
): value is HostWatchChangeType {
  return value === "create" || value === "update" || value === "delete";
}

function isSchema(value: HostBoundaryValue): value is StandardSchema {
  if (!isRecord(value)) return false;
  const standard = readProperty(value, "~standard");
  return (
    isRecord(standard) && isHostFunction(readProperty(standard, "validate"))
  );
}

async function resolveHostValue(
  value: HostBoundaryValue | Promise<HostBoundaryValue>,
): Promise<HostBoundaryValue> {
  return value instanceof Promise ? value : value;
}

function parseSchemaResult(value: HostBoundaryValue): StandardSchemaResult {
  if (!isRecord(value))
    throw new Error("host schema returned an invalid result");
  const issues = readProperty(value, "issues");
  if (issues !== undefined) {
    if (!Array.isArray(issues)) {
      throw new Error("host schema returned invalid issues");
    }
    const parsedIssues: Array<{ readonly message: string }> = [];
    for (const issue of issues) {
      const message = isRecord(issue)
        ? readProperty(issue, "message")
        : undefined;
      if (!isString(message)) {
        throw new Error("host schema returned invalid issues");
      }
      parsedIssues.push({ message });
    }
    return { issues: parsedIssues };
  }
  if (!hasProperty(value, "value")) {
    throw new Error("host schema returned no value");
  }
  return { value: readProperty(value, "value") };
}

function parseSchema(value: HostBoundaryValue): StandardSchema {
  if (!isSchema(value)) throw new Error("host artifact has an invalid schema");
  const standard = readProperty(value, "~standard");
  if (!isRecord(standard))
    throw new Error("host artifact has an invalid schema");
  const validate = readProperty(standard, "validate");
  if (!isHostFunction(validate)) {
    throw new Error("host artifact has an invalid schema");
  }
  return {
    "~standard": {
      async validate(input) {
        const boundaryInput =
          /* SAFETY: HostBoundaryValue includes every JavaScript value that can cross the worker boundary. */ input as HostBoundaryValue;
        return parseSchemaResult(
          await resolveHostValue(validate(boundaryInput)),
        );
      },
    },
  };
}

function parseEntry(value: HostBoundaryValue): HostEntry {
  const apiVersion = isRecord(value)
    ? readProperty(value, "experimental_apiVersion")
    : undefined;
  const contractValue = isRecord(value)
    ? readProperty(value, "contract")
    : undefined;
  const handlersValue = isRecord(value)
    ? readProperty(value, "handlers")
    : undefined;
  const disposeValue = isRecord(value)
    ? readProperty(value, "dispose")
    : undefined;
  if (
    !isRecord(value) ||
    apiVersion !== 1 ||
    !isRecord(contractValue) ||
    !isRecord(handlersValue) ||
    (disposeValue !== undefined && !isHostFunction(disposeValue))
  ) {
    throw new Error("host artifact does not export a valid host entry");
  }
  const contract: Record<string, HostMethod> = {};
  const handlers: Record<
    string,
    (
      input: HostBoundaryValue,
      context: HostContext,
    ) => HostBoundaryValue | Promise<HostBoundaryValue>
  > = {};
  for (const [name, method] of readEntries(contractValue)) {
    const handlerValue = readProperty(handlersValue, name);
    if (
      !isRecord(method) ||
      !isSchema(readProperty(method, "input")) ||
      !isSchema(readProperty(method, "output")) ||
      !isHostFunction(handlerValue)
    ) {
      throw new Error(`host artifact has an invalid method "${name}"`);
    }
    contract[name] = {
      input: parseSchema(readProperty(method, "input")),
      output: parseSchema(readProperty(method, "output")),
    };
    const handler = handlerValue;
    handlers[name] = async (input, context) =>
      resolveHostValue(handler(input, context));
  }
  let signals: Readonly<Record<string, HostSignal>> | undefined;
  const signalsValue = readProperty(value, "experimental_signals");
  if (signalsValue !== undefined) {
    if (!isRecord(signalsValue)) {
      throw new Error("host artifact signals must be an object");
    }
    const parsedSignals: Record<string, HostSignal> = {};
    for (const [name, signal] of readEntries(signalsValue)) {
      if (!isRecord(signal) || !isSchema(readProperty(signal, "payload"))) {
        throw new Error(`host artifact has an invalid signal "${name}"`);
      }
      parsedSignals[name] = {
        payload: parseSchema(readProperty(signal, "payload")),
      };
    }
    signals = parsedSignals;
  }
  return {
    experimental_apiVersion: 1,
    contract,
    experimental_signals: signals,
    handlers,
    dispose:
      disposeValue === undefined
        ? undefined
        : async () => {
            if (!isHostFunction(disposeValue)) return;
            await resolveHostValue(disposeValue());
          },
  };
}

function parseHostWatchEvent(value: HostBoundaryValue): HostWatchEvent | null {
  if (!isRecord(value)) return null;
  const kind = readProperty(value, "kind");
  if (!isString(kind)) return null;
  if (kind === "rescan-required") return { kind };
  const message = readProperty(value, "message");
  if (kind === "watch-error" && isString(message)) {
    return { kind, message };
  }
  const changesValue = readProperty(value, "changes");
  if (kind !== "changed" || !Array.isArray(changesValue)) return null;
  const changes: Array<{
    path: string;
    type: HostWatchChangeType;
  }> = [];
  for (const change of changesValue) {
    if (!isRecord(change)) return null;
    const path = readProperty(change, "path");
    const type = readProperty(change, "type");
    if (!isString(path)) return null;
    if (!isHostWatchChangeType(type)) return null;
    changes.push({ path, type });
  }
  return { kind, changes };
}

function parseParentMessage(value: HostBoundaryValue): ParentMessage | null {
  if (!isRecord(value)) return null;
  const type = readProperty(value, "type");
  if (!isString(type)) return null;
  if (type === "dispose") return { type };
  const watchId = readProperty(value, "watchId");
  if (type === "watch-ready" && isString(watchId)) {
    return { type, watchId };
  }
  const error = readProperty(value, "error");
  if (type === "watch-start-error" && isString(watchId) && isString(error)) {
    return {
      type,
      watchId,
      error,
    };
  }
  const sequence = readProperty(value, "sequence");
  if (
    type === "watch-event" &&
    isString(watchId) &&
    isNumber(sequence) &&
    Number.isSafeInteger(sequence)
  ) {
    const event = parseHostWatchEvent(readProperty(value, "event"));
    if (event !== null) {
      return {
        type,
        watchId,
        sequence,
        event,
      };
    }
  }
  const callId = readProperty(value, "callId");
  if (type === "cancel" && isString(callId)) {
    return { type, callId };
  }
  const method = readProperty(value, "method");
  if (type === "call" && isString(callId) && isString(method)) {
    return {
      type,
      callId,
      method,
      input: readProperty(value, "input"),
    };
  }
  return null;
}

function parseStringArray(value: HostBoundaryValue): readonly string[] {
  if (!Array.isArray(value)) throw new Error("invalid host watch options");
  const parsed: string[] = [];
  for (const entry of value) {
    if (!isString(entry)) throw new Error("invalid host watch options");
    parsed.push(entry);
  }
  return parsed;
}

function validateWatchOptions(
  value: HostBoundaryValue,
): ResolvedHostWatchOptions {
  if (!isRecord(value)) throw new Error("invalid host watch options");
  const rootPath = readProperty(value, "rootPath");
  const ignoredPathsValue = readProperty(value, "ignoredPaths");
  const debounceValue = readProperty(value, "debounceMs");
  const maxWaitValue = readProperty(value, "maxWaitMs");
  const ignoredPaths =
    ignoredPathsValue === undefined ? [] : parseStringArray(ignoredPathsValue);
  const debounceMs = debounceValue === undefined ? 75 : debounceValue;
  const maxWaitMs = maxWaitValue === undefined ? 500 : maxWaitValue;
  if (
    !isString(rootPath) ||
    !isAbsolute(rootPath) ||
    Buffer.byteLength(rootPath) > MAX_WATCH_PATH_BYTES ||
    ignoredPaths.length > MAX_WATCH_IGNORE_ENTRIES ||
    ignoredPaths.some(
      (entry) => Buffer.byteLength(entry) > MAX_WATCH_PATH_BYTES,
    ) ||
    !isNumber(debounceMs) ||
    !Number.isInteger(debounceMs) ||
    debounceMs < MIN_WATCH_DEBOUNCE_MS ||
    debounceMs > MAX_WATCH_DEBOUNCE_MS ||
    !isNumber(maxWaitMs) ||
    !Number.isInteger(maxWaitMs) ||
    maxWaitMs < debounceMs ||
    maxWaitMs > MAX_WATCH_WAIT_MS
  ) {
    throw new Error("invalid host watch options");
  }
  return { rootPath, ignoredPaths, debounceMs, maxWaitMs };
}

async function validate(
  schema: StandardSchema,
  value: HostBoundaryValue,
): Promise<HostBoundaryValue> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.value;
}

function normalizeJson(
  value: HostBoundaryValue,
  label: string,
): HostBoundaryValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = undefined;
  }
  if (serialized === undefined) {
    throw new Error(`${label} is not JSON-serializable`);
  }
  if (Buffer.byteLength(serialized) > RESULT_MAX_BYTES) {
    throw new Error(`${label} exceeds ${RESULT_MAX_BYTES} bytes`);
  }
  return JSON.parse(serialized);
}

type WorkerMessage =
  | { readonly type: "watch-stop"; readonly watchId: string }
  | {
      readonly type: "watch-start";
      readonly watchId: string;
      readonly rootPath: string;
      readonly ignoredPaths: readonly string[];
      readonly debounceMs: number;
      readonly maxWaitMs: number;
    }
  | {
      readonly type: "watch-ack";
      readonly watchId: string;
      readonly sequence: number;
    }
  | {
      readonly type: "result";
      readonly callId: string;
      readonly ok: true;
      readonly output: HostBoundaryValue;
    }
  | {
      readonly type: "result";
      readonly callId: string;
      readonly ok: false;
      readonly error: string;
    }
  | {
      readonly type: "signal";
      readonly signal: string;
      readonly payload: HostBoundaryValue;
    }
  | { readonly type: "lease-acquire"; readonly leaseId: string }
  | { readonly type: "lease-release"; readonly leaseId: string }
  | {
      readonly type: "ready";
      readonly protocolVersion: number;
      readonly pluginId: string;
      readonly generation: string;
    }
  | { readonly type: "startup-error"; readonly error: string };

function send(message: WorkerMessage): void {
  if (!process.connected) return;
  try {
    process.send?.(message);
  } catch {}
}

function errorMessage(error: Error): string {
  return error.message;
}

const [
  artifactPath,
  pluginId,
  generation,
  dataDir,
  tempDir,
  disposeTimeoutArg,
] = process.argv.slice(2);
const disposeTimeoutMs =
  disposeTimeoutArg === undefined
    ? DEFAULT_DISPOSE_TIMEOUT_MS
    : Number(disposeTimeoutArg);
if (
  artifactPath === undefined ||
  !isAbsolute(artifactPath) ||
  pluginId === undefined ||
  generation === undefined ||
  dataDir === undefined ||
  !isAbsolute(dataDir) ||
  tempDir === undefined ||
  !isAbsolute(tempDir) ||
  !Number.isSafeInteger(disposeTimeoutMs) ||
  disposeTimeoutMs <= 0
) {
  throw new Error("invalid host worker arguments");
}

const lifecycleController = new AbortController();
const activeCalls = new Map<string, AbortController>();
const watches = new Map<string, WorkerWatchState>();
let nextWatchId = 1;
let nextLeaseId = 1;
let entry: HostEntry | null = null;
let disposing = false;

function startWatch(
  options: HostBoundaryValue,
  listener: HostBoundaryValue,
  requestSignal: AbortSignal,
): Promise<HostWatchSubscription> {
  const validated = validateWatchOptions(options);
  if (!isHostFunction(listener)) {
    throw new Error("host watch listener must be a function");
  }
  const watchListener: HostWatchListener = async (event) => {
    await resolveHostValue(listener(event));
  };
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
    listener: watchListener,
    subscription,
    resolve,
    reject,
    ready: false,
    disposed: false,
  };
  watches.set(watchId, state);
  const abort = (): void => void subscription.dispose();
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

function handleWatchReady(watchId: string): void {
  const state = watches.get(watchId);
  if (state === undefined || state.disposed || state.ready) return;
  state.ready = true;
  state.resolve(state.subscription);
}

function handleWatchStartError(watchId: string, error: string): void {
  const state = watches.get(watchId);
  if (state === undefined || state.disposed || state.ready) return;
  state.disposed = true;
  watches.delete(watchId);
  state.reject(new Error(error));
}

function handleWatchEvent(
  watchId: string,
  sequence: number,
  event: HostWatchEvent,
): void {
  const state = watches.get(watchId);
  if (state === undefined || state.disposed) {
    send({ type: "watch-ack", watchId, sequence });
    return;
  }
  void Promise.resolve()
    .then(() => state.listener(event))
    .catch((error) => {
      const message =
        error instanceof Error ? errorMessage(error) : String(error);
      process.stderr.write(`Host watch listener failed: ${message}\n`);
    })
    .finally(() => send({ type: "watch-ack", watchId, sequence }));
}

async function dispose(): Promise<void> {
  if (disposing) return;
  disposing = true;
  setTimeout(() => process.exit(1), disposeTimeoutMs);
  lifecycleController.abort();
  for (const controller of activeCalls.values()) controller.abort();
  activeCalls.clear();
  try {
    await Promise.all(
      [...watches.values()].map((watch) => watch.subscription.dispose()),
    );
    await entry?.dispose?.();
  } finally {
    if (process.connected) process.disconnect?.();
    process.exit(0);
  }
}

async function handleCall(
  message: Extract<ParentMessage, { type: "call" }>,
): Promise<void> {
  if (disposing) return;
  const currentEntry = entry;
  if (currentEntry === null) return;
  if (activeCalls.has(message.callId)) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: `duplicate host plugin call ${message.callId}`,
    });
    return;
  }
  const method = currentEntry.contract[message.method];
  const handler = currentEntry.handlers[message.method];
  if (method === undefined || handler === undefined) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: `unknown host method "${message.method}"`,
    });
    return;
  }
  const controller = new AbortController();
  activeCalls.set(message.callId, controller);
  let contextOpen = true;
  try {
    const input = await validate(method.input, message.input);
    const result = await handler(input, {
      signal: controller.signal,
      lifecycle: { signal: lifecycleController.signal },
      experimental_paths: { dataDir, tempDir },
      async experimental_emitSignal(signalName, payload) {
        if (!isString(signalName)) {
          throw new Error("host signal name must be a string");
        }
        const signal = currentEntry.experimental_signals?.[signalName];
        if (signal === undefined) {
          throw new Error(`unknown host signal "${signalName}"`);
        }
        const validated = await validate(signal.payload, payload);
        send({
          type: "signal",
          signal: signalName,
          payload: normalizeJson(validated, `host signal ${signalName}`),
        });
      },
      experimental_watch: (options, listener) =>
        startWatch(options, listener, controller.signal),
      experimental_retainWorker() {
        if (
          !contextOpen ||
          disposing ||
          controller.signal.aborted ||
          lifecycleController.signal.aborted
        ) {
          throw new Error("host call context is no longer active");
        }
        const leaseId = String(nextLeaseId++);
        let released = false;
        send({ type: "lease-acquire", leaseId });
        return {
          async dispose() {
            if (released) return;
            released = true;
            send({ type: "lease-release", leaseId });
          },
        };
      },
    });
    const output = normalizeJson(
      await validate(method.output, result),
      `host output for ${message.method}`,
    );
    send({ type: "result", callId: message.callId, ok: true, output });
  } catch (error) {
    const errorText =
      error instanceof Error ? errorMessage(error) : String(error);
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: errorText,
    });
  } finally {
    contextOpen = false;
    activeCalls.delete(message.callId);
  }
}

process.once("disconnect", () => void dispose());
if (!process.connected) void dispose();

try {
  const imported = await import(pathToFileURL(artifactPath).href);
  if (disposing) process.exit(0);
  entry = parseEntry(imported.default);
  process.on("message", (raw: HostBoundaryValue) => {
    const message = parseParentMessage(raw);
    if (message === null) return;
    if (message.type === "call") {
      void handleCall(message);
    } else if (message.type === "cancel") {
      activeCalls.get(message.callId)?.abort();
    } else if (message.type === "watch-ready") {
      handleWatchReady(message.watchId);
    } else if (message.type === "watch-start-error") {
      handleWatchStartError(message.watchId, message.error);
    } else if (message.type === "watch-event") {
      handleWatchEvent(message.watchId, message.sequence, message.event);
    } else {
      void dispose();
    }
  });
  send({
    type: "ready",
    protocolVersion: HOST_WORKER_PROTOCOL_VERSION,
    pluginId,
    generation,
  });
} catch (error) {
  if (disposing) process.exit(1);
  const message = error instanceof Error ? errorMessage(error) : String(error);
  send({ type: "startup-error", error: message });
  process.exit(1);
}
