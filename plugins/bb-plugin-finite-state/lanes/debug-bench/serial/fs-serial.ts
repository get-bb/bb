import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";
import {
  MAX_PAGE_SIZE,
  normalizePageSize,
  SOFT_RESPONSE_BYTES,
} from "../../../lib/agentic/budget.js";
import type { BenchContext } from "../registry/enumerate.js";
import {
  registeredSerialRuntime,
  type SerialReadResult,
  type SerialRuntime,
} from "./session.js";

declare const sendConfirmation: unique symbol;
export interface SendConfirmation {
  readonly [sendConfirmation]: true;
}

export interface SerialServiceContext extends BenchContext {
  validateSendConfirmation(value: unknown): boolean;
}

export class SerialSendError extends Error {
  readonly code = "SEND_CONFIRMATION_REQUIRED" as const;

  constructor() {
    super("SEND_CONFIRMATION_REQUIRED: serial send requires explicit confirmation");
    this.name = "SerialSendError";
  }
}

const scopeFields = {
  projectId: z.string().min(1).max(512),
  projectVersionId: z.string().min(1).max(512).nullable(),
} as const;
const stateSchema = z.enum(["connected", "reconnecting", "closed", "unconfigured"]);
const sessionSchema = z.object({
  ...scopeFields,
  sessionId: z.string().min(1).max(512),
  deviceId: z.string().min(1).max(512),
  state: stateSchema,
  baud: z.number().int().positive(),
  latestCursor: z.number().int().nonnegative(),
  droppedLines: z.number().int().nonnegative(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  message: z.string().max(1000).nullable(),
}).strict();
const readResultSchema = z.object({
  lines: z.array(z.object({
    cursor: z.number().int().nonnegative(),
    at: z.iso.datetime(),
    dir: z.enum(["rx", "tx"]),
    text: z.string().max(100_000),
  }).strict()).max(MAX_PAGE_SIZE),
  nextCursor: z.number().int().nonnegative(),
  gaps: z.array(z.object({
    afterCursor: z.number().int().nonnegative(),
    dropped: z.number().int().positive(),
  }).strict()).max(10),
  state: stateSchema,
}).strict();

export const serialRpcContract = defineRpcContract({
  benchDevSerialSessionCurrent: {
    input: z.object({ ...scopeFields, deviceId: z.string().min(1).max(512) }).strict(),
    output: sessionSchema.nullable(),
  },
  benchDevSerialSessionOpen: {
    input: z.object({
      ...scopeFields,
      deviceId: z.string().min(1).max(512),
      baud: z.number().int().positive().max(4_000_000).default(115_200),
    }).strict(),
    output: sessionSchema,
  },
  benchDevSerialSessionClose: {
    input: z.object({ ...scopeFields, deviceId: z.string().min(1).max(512) }).strict(),
    output: sessionSchema,
  },
  benchDevSerialLinesRead: {
    input: z.object({
      ...scopeFields,
      device: z.string().min(1).max(512),
      cursor: z.number().int().nonnegative().optional(),
      filter: z.string().max(1000).optional(),
      maxLines: z.number().int().positive().max(10_000).default(50),
    }).strict(),
    output: readResultSchema,
  },
  benchDevSerialSend: {
    input: z.object({
      ...scopeFields,
      device: z.string().min(1).max(512),
      data: z.string().min(1).max(64 * 1024),
      confirmed: z.literal(true),
    }).strict(),
    output: z.object({ bytes: z.number().int().nonnegative() }).strict(),
  },
  benchDevSerialAutoConnectStatus: {
    input: z.object(scopeFields).strict(),
    output: z.object({
      state: stateSchema,
      flashedDeviceId: z.string().min(1).max(2000),
      serialDeviceId: z.string().min(1).max(512).nullable(),
      message: z.string().max(1000).nullable(),
      updatedAt: z.iso.datetime(),
    }).strict().nullable(),
  },
} as const);

export const SERIAL_RPC_METHOD_CLASSIFICATIONS = {
  benchDevSerialSessionCurrent: "read",
  benchDevSerialSessionOpen: "local-write",
  benchDevSerialSessionClose: "local-write",
  benchDevSerialLinesRead: "read",
  benchDevSerialSend: "local-write",
  benchDevSerialAutoConnectStatus: "read",
} as const satisfies Record<
  keyof typeof serialRpcContract,
  "read" | "local-write"
>;

function boundedLineText(text: string): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= 2048) return text;
  let end = Math.min(text.length, 2048);
  while (Buffer.byteLength(text.slice(0, end), "utf8") > 2048 && end > 0) end -= 1;
  return `${text.slice(0, end)}… [truncated for response budget]`;
}

function enforceSerialReadBudget(result: SerialReadResult): SerialReadResult {
  const lines: SerialReadResult["lines"] = [];
  let truncated = false;
  for (const line of result.lines) {
    const candidate = { ...line, text: boundedLineText(line.text) };
    const next = { ...result, lines: [...lines, candidate] };
    if (lines.length > 0 && Buffer.byteLength(JSON.stringify(next), "utf8") > SOFT_RESPONSE_BYTES) {
      truncated = true;
      break;
    }
    lines.push(candidate);
  }
  return {
    ...result,
    lines,
    nextCursor: truncated ? (lines.at(-1)?.cursor ?? result.nextCursor) : result.nextCursor,
  };
}

export function readSerial(
  ctx: BenchContext,
  request: { device: string; cursor?: number; filter?: string; maxLines?: number },
): Promise<SerialReadResult> {
  const result = registeredSerialRuntime(ctx).read(ctx, {
    ...request,
    maxLines: normalizePageSize(request.maxLines),
  });
  return Promise.resolve(enforceSerialReadBudget(result));
}

export async function sendSerial(
  ctx: SerialServiceContext,
  request: { device: string; data: string; confirmation: SendConfirmation },
): Promise<{ bytes: number }> {
  if (!ctx.validateSendConfirmation(request.confirmation)) throw new SerialSendError();
  return registeredSerialRuntime(ctx).send(ctx, request.device, request.data);
}

export function registerSerialRpc(
  bb: BbPluginApi,
  runtime: SerialRuntime,
): void {
  bb.rpc.register(serialRpcContract, {
    benchDevSerialSessionCurrent(input) {
      runtime.observeScope(input);
      return runtime.current(input, input.deviceId);
    },
    async benchDevSerialSessionOpen(input) {
      return (await runtime.open(input, input.deviceId, input.baud)).record();
    },
    benchDevSerialSessionClose(input) {
      return runtime.close(input, input.deviceId);
    },
    benchDevSerialLinesRead(input) {
      return enforceSerialReadBudget(runtime.read(input, {
        device: input.device,
        cursor: input.cursor,
        filter: input.filter,
        maxLines: normalizePageSize(input.maxLines),
      }));
    },
    benchDevSerialSend(input) {
      // Zod's literal true is the explicit human UI confirmation boundary.
      return runtime.send(input, input.device, input.data);
    },
    benchDevSerialAutoConnectStatus(input) {
      runtime.observeScope(input);
      return runtime.autoConnectStatus(input);
    },
  });
}

export async function runFsSerial(
  ctx: SerialServiceContext,
  request:
    | { mode: "read"; device: string; cursor?: number; filter?: string; maxLines?: number }
    | { mode: "send"; device: string; data: string; confirmation: SendConfirmation },
): Promise<SerialReadResult | { bytes: number }> {
  if (request.mode === "read") return readSerial(ctx, request);
  return sendSerial(ctx, request);
}
