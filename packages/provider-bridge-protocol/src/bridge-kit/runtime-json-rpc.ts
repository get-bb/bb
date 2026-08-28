import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";
import { z } from "zod";
import { bridgeErrorDataSchema, type ProviderRecoveryHint } from "../errors.js";
import type { ProviderRequestCommandPlan } from "./contracts.js";

export interface JsonRpcMessage extends JsonRpcObject {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: JsonRpcValue;
}

export interface ProviderInboundRequest {
  id?: string | number;
  method: string;
  params?: unknown;
}

export type ProviderRuntimeEvent = JsonRpcObject;

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export type JsonRpcValue = JsonValue | undefined;

export type JsonRpcObject = Record<string, JsonRpcValue>;

const jsonRpcValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonRpcValueSchema),
    z.record(z.string(), jsonRpcValueSchema),
  ]),
);
const jsonRpcObjectSchema: z.ZodType<JsonRpcObject> = z.record(
  z.string(),
  jsonRpcValueSchema,
);
const jsonRpcIdSchema = z.union([z.string(), z.number()]);

export const JSON_RPC_INVALID_PARAMS_CODE = -32602;

export class ProviderRequestDecodeError extends Error {
  readonly code = JSON_RPC_INVALID_PARAMS_CODE;

  constructor(message: string) {
    super(message);
    this.name = "ProviderRequestDecodeError";
  }
}

export class ProviderResponseEncodeError extends Error {
  readonly code = JSON_RPC_INVALID_PARAMS_CODE;

  constructor(message: string) {
    super(message);
    this.name = "ProviderResponseEncodeError";
  }
}

export class JsonRpcResponseError extends Error {
  readonly code: number;
  readonly recovery: ProviderRecoveryHint | null;

  constructor(
    code: number,
    message: string,
    recovery: ProviderRecoveryHint | null = null,
  ) {
    super(message);
    this.name = "JsonRpcResponseError";
    this.code = code;
    this.recovery = recovery;
  }
}

export interface PendingJsonRpcRequest {
  resolve: (result: JsonRpcValue) => void;
  reject: (error: Error) => void;
}

export const ignoredJsonRpcResultSchema: z.ZodType<JsonRpcValue> =
  jsonRpcValueSchema.optional();

export interface ParsedJsonRpcNonJsonLine {
  kind: "non_json";
}

export interface ParsedJsonRpcInvalidLine {
  kind: "invalid_json_rpc";
}

export interface ParsedJsonRpcResponseLine {
  kind: "response";
  parsed: JsonRpcObject;
  parsedId: string | number;
}

export interface ParsedJsonRpcRequestLine {
  kind: "request";
  parsedId: string | number;
  parsedMethod: string;
  rawRequest: JsonRpcMessage;
}

export interface ParsedJsonRpcNotificationLine {
  kind: "notification";
  notificationMethod: string;
  parsed: JsonRpcObject;
}

export type ParsedJsonRpcLine =
  | ParsedJsonRpcNonJsonLine
  | ParsedJsonRpcInvalidLine
  | ParsedJsonRpcResponseLine
  | ParsedJsonRpcRequestLine
  | ParsedJsonRpcNotificationLine;

export interface SendJsonRpcRequestArgs<TResult> {
  child: ChildProcess;
  getNextId: () => number;
  message: JsonRpcMessage | ProviderRequestCommandPlan;
  pending: Map<string | number, PendingJsonRpcRequest>;
  resultSchema: z.ZodType<TResult>;
  timeoutMs?: number;
}

interface SendJsonRpcResultArgs {
  child: ChildProcess;
  id: string | number;
  result: JsonRpcValue;
}

interface SendJsonRpcErrorArgs {
  child: ChildProcess;
  code?: number;
  id: string | number;
  message: string;
}

interface SendProviderRequestDecodeErrorArgs<TError> {
  child: ChildProcess;
  error: TError;
  id: string | number;
}

interface SendProviderResponseEncodeErrorArgs<TError> {
  child: ChildProcess;
  error: TError;
  id: string | number;
}

type ParsedProviderError = Error | JsonRpcValue;

interface SettleJsonRpcResponseArgs {
  id: string | number;
  pending: Map<string | number, PendingJsonRpcRequest>;
  response: JsonRpcObject;
}

const closedJsonRpcStdinErrorCodes = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);
const jsonRpcStdinErrorHandledStreams = new WeakSet<Writable>();

function parseJsonRpcObject(value: JsonRpcValue): JsonRpcObject | undefined {
  const parsed = jsonRpcObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isJsonRpcId(value: JsonRpcValue): value is string | number {
  return jsonRpcIdSchema.safeParse(value).success;
}

function formatJsonRpcErrorMessage(error: JsonRpcValue): string {
  const parsed = parseJsonRpcObject(error);
  const message =
    parsed === undefined ? undefined : z.string().safeParse(parsed.message);
  if (message?.success) {
    return message.data;
  }
  return JSON.stringify(error);
}

function jsonRpcResponseError(error: JsonRpcValue): Error {
  const parsed = parseJsonRpcObject(error);
  const code =
    parsed === undefined ? undefined : z.number().safeParse(parsed.code);
  const message =
    parsed === undefined ? undefined : z.string().safeParse(parsed.message);
  if (code?.success && message?.success) {
    return new JsonRpcResponseError(
      code.data,
      message.data,
      decodeRecoveryHint(parsed?.data),
    );
  }
  return new Error(formatJsonRpcErrorMessage(error));
}

function decodeRecoveryHint(data: JsonRpcValue): ProviderRecoveryHint | null {
  if (data === undefined) {
    return null;
  }
  const parsed = bridgeErrorDataSchema.safeParse(data);
  return parsed.success ? (parsed.data.recovery ?? null) : null;
}

function parseProviderThrownValue<TError>(value: TError): ParsedProviderError {
  if (value instanceof Error) {
    return value;
  }
  const parsed = jsonRpcValueSchema.safeParse(value);
  return parsed.success ? parsed.data : new Error("Provider operation failed");
}

function isClosedJsonRpcStdinError(error: Error): boolean {
  if (!("code" in error)) return false;
  const code = z.string().safeParse(error.code);
  return code.success && closedJsonRpcStdinErrorCodes.has(code.data);
}

function handleJsonRpcStdinError(error: Error): void {
  if (isClosedJsonRpcStdinError(error)) {
    return;
  }
  throw error;
}

function ensureJsonRpcStdinErrorHandler(stdin: Writable): void {
  if (jsonRpcStdinErrorHandledStreams.has(stdin)) {
    return;
  }
  jsonRpcStdinErrorHandledStreams.add(stdin);
  stdin.on("error", handleJsonRpcStdinError);
}

function writeJsonRpcLine(child: ChildProcess, line: string): void {
  const stdin = child.stdin;
  if (!stdin || stdin.destroyed || !stdin.writable) {
    return;
  }
  ensureJsonRpcStdinErrorHandler(stdin);
  stdin.write(line + "\n");
}

export function parseJsonRpcLine(line: string): ParsedJsonRpcLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "non_json" };
  }

  const parsedValue = jsonRpcValueSchema.safeParse(parsed);
  if (!parsedValue.success) {
    return { kind: "invalid_json_rpc" };
  }

  const parsedObject = parseJsonRpcObject(parsedValue.data);
  if (parsedObject === undefined) {
    return { kind: "invalid_json_rpc" };
  }

  const parsedId = parsedObject.id;
  const parsedMethod = parsedObject.method;
  if (isJsonRpcId(parsedId) && !parsedMethod) {
    return {
      kind: "response",
      parsed: parsedObject,
      parsedId,
    };
  }

  const parsedMethodResult = z.string().safeParse(parsedMethod);
  if (isJsonRpcId(parsedId) && parsedMethodResult.success) {
    const rawRequest: JsonRpcMessage = {
      jsonrpc: "2.0",
      id: parsedId,
      method: parsedMethodResult.data,
    };
    if (Object.hasOwn(parsedObject, "params")) {
      rawRequest.params = parsedObject.params;
    }
    return {
      kind: "request",
      parsedId,
      parsedMethod: parsedMethodResult.data,
      rawRequest,
    };
  }

  if (parsedMethodResult.success) {
    return {
      kind: "notification",
      notificationMethod: parsedMethodResult.data,
      parsed: parsedObject,
    };
  }

  return { kind: "invalid_json_rpc" };
}

export function getJsonRpcStringParam(
  message: JsonRpcObject,
  key: string,
): string | undefined {
  const params = jsonRpcObjectSchema.safeParse(message.params);
  if (!params.success) {
    return undefined;
  }

  const value = z.string().safeParse(params.data[key]);
  return value.success ? value.data : undefined;
}

export function settleJsonRpcResponse(args: SettleJsonRpcResponseArgs): void {
  const pending = args.pending.get(args.id);
  if (!pending) {
    return;
  }

  args.pending.delete(args.id);
  if (args.response.error) {
    pending.reject(jsonRpcResponseError(args.response.error));
    return;
  }

  pending.resolve(args.response.result);
}

export function sendJsonRpc(
  child: ChildProcess,
  message: JsonRpcMessage | ProviderRequestCommandPlan,
): void {
  const line = JSON.stringify(toJsonRpcMessage(message));
  writeJsonRpcLine(child, line);
}

export function toJsonRpcMessage(
  message: JsonRpcMessage | ProviderRequestCommandPlan,
): JsonRpcMessage {
  if ("jsonrpc" in message) {
    return message;
  }
  const result: JsonRpcMessage = {
    jsonrpc: "2.0",
    method: message.method,
  };
  if (message.params !== undefined) {
    result.params = jsonRpcValueSchema.parse(message.params);
  }
  return result;
}

export function sendJsonRpcRequest<TResult>(
  args: SendJsonRpcRequestArgs<TResult>,
): Promise<TResult> {
  const id = args.getNextId();
  const message = toJsonRpcMessage(args.message);
  const withId: JsonRpcMessage = { ...message, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      args.pending.delete(id);
      reject(new Error(`JSON-RPC request timed out: ${message.method}`));
    }, args.timeoutMs ?? 30_000);
    args.pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        const parsedResult = args.resultSchema.safeParse(result);
        if (!parsedResult.success) {
          const issues = parsedResult.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ");
          reject(
            new Error(
              `Invalid JSON-RPC result for ${message.method}: ${issues}`,
            ),
          );
          return;
        }
        resolve(parsedResult.data);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    sendJsonRpc(args.child, withId);
  });
}

export function sendJsonRpcResult(args: SendJsonRpcResultArgs): void {
  writeJsonRpcLine(
    args.child,
    JSON.stringify({
      jsonrpc: "2.0",
      id: args.id,
      result: args.result,
    }),
  );
}

export function sendJsonRpcError(args: SendJsonRpcErrorArgs): void {
  writeJsonRpcLine(
    args.child,
    JSON.stringify({
      jsonrpc: "2.0",
      id: args.id,
      error: {
        code: args.code ?? -32000,
        message: args.message,
      },
    }),
  );
}

export function sendProviderRequestDecodeErrorIfKnown<TError>(
  args: SendProviderRequestDecodeErrorArgs<TError>,
): boolean {
  const error = parseProviderThrownValue(args.error);
  if (!(error instanceof ProviderRequestDecodeError)) {
    return false;
  }

  sendJsonRpcError({
    child: args.child,
    id: args.id,
    message: error.message,
    code: error.code,
  });
  return true;
}

export function sendProviderResponseEncodeErrorIfKnown<TError>(
  args: SendProviderResponseEncodeErrorArgs<TError>,
): boolean {
  const error = parseProviderThrownValue(args.error);
  if (!(error instanceof ProviderResponseEncodeError)) {
    return false;
  }

  sendJsonRpcError({
    child: args.child,
    id: args.id,
    message: error.message,
    code: error.code,
  });
  return true;
}
