import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { isJsonObject } from "../session/decode.js";

export type AcpDiscardReason =
  | "not-json"
  | "not-a-message"
  | "unexpected-response";

export interface AcpMessageStreamOptions {
  input: Readable;
  output: Writable;
  closeOnInputEnd: boolean;
  onSessionUpdate(params: unknown): void;
  onNotification?(method: string, params: unknown): void;
  onDiscard(reason: AcpDiscardReason, line: string): void;
}

const SESSION_UPDATE_METHOD = "session/update";

type JsonRpcId = string | number;

function readId(message: Record<string, unknown>): JsonRpcId | undefined {
  const id = message["id"];
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

export function createAcpMessageStream(
  options: AcpMessageStreamOptions,
): Stream {
  const outstandingRequestIds = new Set<JsonRpcId>();

  let closed = false;
  let detach = () => {};

  function issuedRequestId(id: JsonRpcId): JsonRpcId | undefined {
    if (outstandingRequestIds.has(id)) {
      return id;
    }
    if (typeof id === "string" && id.trim() !== "") {
      const numericId = Number(id);
      if (outstandingRequestIds.has(numericId)) {
        return numericId;
      }
    }
    return undefined;
  }

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      const lines = createInterface({ input: options.input, terminal: false });
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };
      detach = () => lines.close();
      lines.on("line", (line) => {
        if (closed || line.trim() === "") {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          options.onDiscard("not-json", line);
          return;
        }
        if (!isJsonObject(parsed)) {
          options.onDiscard("not-a-message", line);
          return;
        }
        const method = parsed["method"];
        const id = readId(parsed);
        if (typeof method !== "string") {
          const issuedId = id === undefined ? undefined : issuedRequestId(id);
          if (issuedId === undefined) {
            options.onDiscard("unexpected-response", line);
            return;
          }
          outstandingRequestIds.delete(issuedId);
          parsed["id"] = issuedId;
        } else if (id === undefined) {
          options.onNotification?.(method, parsed["params"]);
          if (method === SESSION_UPDATE_METHOD) {
            options.onSessionUpdate(parsed["params"]);
            return;
          }
        }
        controller.enqueue(parsed as AnyMessage);
      });
      if (options.closeOnInputEnd) {
        lines.on("close", close);
        options.input.on("error", close);
      }
    },
    cancel() {
      closed = true;
      detach();
    },
  });

  const writable = new WritableStream<AnyMessage>({
    write(message) {
      if (options.output.destroyed || !options.output.writable) {
        throw new Error("ACP agent stdin is not writable");
      }
      if ("method" in message && "id" in message) {
        const id = message.id;
        if (typeof id === "string" || typeof id === "number") {
          outstandingRequestIds.add(id);
        }
      }
      options.output.write(`${JSON.stringify(message)}\n`);
    },
  });

  return { readable, writable };
}
