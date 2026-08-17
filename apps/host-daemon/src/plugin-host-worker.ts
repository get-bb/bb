import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const HOST_WORKER_PROTOCOL_VERSION = 1;
const RESULT_MAX_BYTES = 8 * 1024 * 1024;

interface StandardSchema {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly value: unknown; readonly issues?: undefined }
      | { readonly issues: readonly { readonly message: string }[] }
      | Promise<
          | { readonly value: unknown; readonly issues?: undefined }
          | { readonly issues: readonly { readonly message: string }[] }
        >;
  };
}

interface HostMethod {
  readonly input: StandardSchema;
  readonly output: StandardSchema;
}

interface HostContext {
  readonly signal: AbortSignal;
  readonly lifecycle: { readonly signal: AbortSignal };
}

interface HostEntry {
  readonly experimental_apiVersion: 1;
  readonly contract: Readonly<Record<string, HostMethod>>;
  readonly handlers: Readonly<
    Record<string, (input: unknown, context: HostContext) => unknown>
  >;
  readonly dispose?: () => void | Promise<void>;
}

type ParentMessage =
  | {
      readonly type: "call";
      readonly callId: string;
      readonly method: string;
      readonly input: unknown;
    }
  | { readonly type: "cancel"; readonly callId: string }
  | { readonly type: "dispose" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchema(value: unknown): value is StandardSchema {
  return (
    isRecord(value) &&
    isRecord(value["~standard"]) &&
    typeof value["~standard"].validate === "function"
  );
}

function parseEntry(value: unknown): HostEntry {
  if (
    !isRecord(value) ||
    value.experimental_apiVersion !== 1 ||
    !isRecord(value.contract) ||
    !isRecord(value.handlers) ||
    (value.dispose !== undefined && typeof value.dispose !== "function")
  ) {
    throw new Error("host artifact does not export a valid host entry");
  }
  for (const [name, method] of Object.entries(value.contract)) {
    if (
      !isRecord(method) ||
      !isSchema(method.input) ||
      !isSchema(method.output) ||
      typeof value.handlers[name] !== "function"
    ) {
      throw new Error(`host artifact has an invalid method "${name}"`);
    }
  }
  return value as unknown as HostEntry;
}

function parseParentMessage(value: unknown): ParentMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "dispose") return { type: "dispose" };
  if (value.type === "cancel" && typeof value.callId === "string") {
    return { type: "cancel", callId: value.callId };
  }
  if (
    value.type === "call" &&
    typeof value.callId === "string" &&
    typeof value.method === "string"
  ) {
    return {
      type: "call",
      callId: value.callId,
      method: value.method,
      input: value.input,
    };
  }
  return null;
}

async function validate(schema: StandardSchema, value: unknown): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
  return result.value;
}

function normalizeJson(value: unknown, label: string): unknown {
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

function send(message: object): void {
  if (!process.connected) return;
  try {
    process.send?.(message);
  } catch {
    // The daemon has already disconnected.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const [artifactPath, pluginId, generation] = process.argv.slice(2);
if (
  artifactPath === undefined ||
  !isAbsolute(artifactPath) ||
  pluginId === undefined ||
  generation === undefined
) {
  throw new Error("invalid host worker arguments");
}

const lifecycleController = new AbortController();
const activeCalls = new Map<string, AbortController>();
let entry: HostEntry;
let disposing = false;

async function dispose(): Promise<void> {
  if (disposing) return;
  disposing = true;
  lifecycleController.abort();
  for (const controller of activeCalls.values()) controller.abort();
  activeCalls.clear();
  try {
    await entry.dispose?.();
  } finally {
    process.disconnect?.();
    process.exit(0);
  }
}

async function handleCall(
  message: Extract<ParentMessage, { type: "call" }>,
): Promise<void> {
  if (disposing) return;
  if (activeCalls.has(message.callId)) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: `duplicate host plugin call ${message.callId}`,
    });
    return;
  }
  const method = entry.contract[message.method];
  const handler = entry.handlers[message.method];
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
  try {
    const input = await validate(method.input, message.input);
    const result = await handler(input, {
      signal: controller.signal,
      lifecycle: { signal: lifecycleController.signal },
    });
    const output = normalizeJson(
      await validate(method.output, result),
      `host output for ${message.method}`,
    );
    send({ type: "result", callId: message.callId, ok: true, output });
  } catch (error) {
    send({
      type: "result",
      callId: message.callId,
      ok: false,
      error: errorMessage(error),
    });
  } finally {
    activeCalls.delete(message.callId);
  }
}

try {
  const imported = await import(pathToFileURL(artifactPath).href);
  entry = parseEntry(imported.default);
  process.on("message", (raw: unknown) => {
    const message = parseParentMessage(raw);
    if (message === null) return;
    if (message.type === "call") {
      void handleCall(message);
    } else if (message.type === "cancel") {
      activeCalls.get(message.callId)?.abort();
    } else {
      void dispose();
    }
  });
  process.once("disconnect", () => void dispose());
  send({
    type: "ready",
    protocolVersion: HOST_WORKER_PROTOCOL_VERSION,
    pluginId,
    generation,
  });
} catch (error) {
  send({ type: "startup-error", error: errorMessage(error) });
  process.exit(1);
}
