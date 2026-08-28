import { jsonValueSchema } from "@bb/domain";
import type { JsonValue } from "@bb/domain";
import type { BridgeErrorData, ProviderRecoveryHint } from "../errors.js";

export type BridgeJsonRpcId = string | number;

type BridgeJsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: BridgeJsonRpcId;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: BridgeJsonRpcId;
      error: { code: number; message: string; data?: BridgeErrorData };
    };

export type BridgeSendError = (
  id: BridgeJsonRpcId,
  code: number,
  message: string,
  data?: BridgeErrorData,
) => void;

export class BridgeRecoveryError extends Error {
  readonly code: number;
  readonly recovery: ProviderRecoveryHint;

  constructor(args: {
    code: number;
    message: string;
    recovery: ProviderRecoveryHint;
    cause?: unknown;
  }) {
    super(
      args.message,
      args.cause === undefined ? undefined : { cause: args.cause },
    );
    this.name = "BridgeRecoveryError";
    this.code = args.code;
    this.recovery = args.recovery;
  }
}

interface CreateBridgeIoArgs {
  write?: (line: string) => void;
}

interface BridgeResponseError {
  code: number;
  message: string;
  data?: BridgeErrorData;
}

interface BridgeIo<TMessage> {
  send: (message: TMessage | BridgeJsonRpcResponse) => void;
  sendError: BridgeSendError;
  sendResult: <TResult>(id: BridgeJsonRpcId, result: TResult) => void;
}

export function createBridgeIo<TMessage>({
  write = (line) => process.stdout.write(line),
}: CreateBridgeIoArgs = {}): BridgeIo<TMessage> {
  const send = (message: TMessage | BridgeJsonRpcResponse): void => {
    write(`${JSON.stringify(message)}\n`);
  };
  const sendError: BridgeSendError = (id, code, message, data) => {
    const error: BridgeResponseError = {
      code,
      message,
    };
    if (data !== undefined) {
      error.data = data;
    }
    send({ jsonrpc: "2.0", id, error });
  };
  const sendResult = <TResult>(id: BridgeJsonRpcId, result: TResult): void => {
    send({ jsonrpc: "2.0", id, result });
  };
  return {
    send,
    sendError,
    sendResult,
  };
}

export function createBridgeLineHandler(args: {
  handleParsedMessage: (message: JsonValue) => void;
}): (line: string) => void {
  return (line): void => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed: JsonValue;
    try {
      parsed = jsonValueSchema.parse(JSON.parse(trimmed));
    } catch {
      return;
    }
    args.handleParsedMessage(parsed);
  };
}

export function runBridgeRequest<
  TRequest extends { id: BridgeJsonRpcId },
>(args: {
  handleRequest: (request: TRequest) => Promise<void>;
  request: TRequest;
  sendError: BridgeSendError;
}): void {
  void args.handleRequest(args.request).catch((error) => {
    if (error instanceof BridgeRecoveryError) {
      args.sendError(args.request.id, error.code, error.message, {
        recovery: error.recovery,
      });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    args.sendError(args.request.id, -32000, message);
  });
}
