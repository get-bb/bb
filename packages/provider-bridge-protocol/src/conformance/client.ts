import type { BridgeConformanceTransport } from "./types.js";

export interface JsonRpcWireMessage {
  jsonrpc?: unknown;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function isWireMessage(value: unknown): value is JsonRpcWireMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A polling JSON-RPC client over a conformance transport. Accumulates every
 * message the bridge emits (responses, notifications, bridge-initiated
 * requests) into one ordered log so grammar checks can assert sequences.
 */
export class ConformanceClient {
  private nextId = 1;
  readonly log: JsonRpcWireMessage[] = [];

  constructor(
    private readonly transport: BridgeConformanceTransport,
    private readonly timeoutMs: number,
  ) {}

  drainIntoLog(): void {
    for (const raw of this.transport.takeMessages()) {
      if (isWireMessage(raw)) {
        this.log.push(raw);
      }
    }
  }

  sendRaw(line: string): void {
    this.transport.send(line);
  }

  notify(method: string, params?: unknown): void {
    this.transport.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    );
  }

  request(method: string, params?: unknown): number {
    const id = this.nextId;
    this.nextId += 1;
    this.transport.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      }),
    );
    return id;
  }

  /** Poll until `resolve` yields a value or the deadline passes (→ null). */
  async waitFor<T>(resolve: () => T | undefined): Promise<T | null> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      this.drainIntoLog();
      const value = resolve();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        return null;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  async waitForResponse(id: number): Promise<JsonRpcWireMessage | null> {
    return this.waitFor(() =>
      this.log.find(
        (message) => message.id === id && message.method === undefined,
      ),
    );
  }

  /** A settle window: drain for the given quiet period without expectations. */
  async settle(quietMs: number): Promise<void> {
    const deadline = Date.now() + quietMs;
    while (Date.now() < deadline) {
      this.drainIntoLog();
      await new Promise((r) => setTimeout(r, 15));
    }
    this.drainIntoLog();
  }

  responsesFor(id: number): JsonRpcWireMessage[] {
    return this.log.filter(
      (message) => message.id === id && message.method === undefined,
    );
  }

  notifications(method?: string): JsonRpcWireMessage[] {
    return this.log.filter(
      (message) =>
        message.id === undefined &&
        typeof message.method === "string" &&
        (method === undefined || message.method === method),
    );
  }
}

let clientRequestCounter = 0;

/**
 * Deterministic valid `creq_` ids for kit-driven turns (the id alphabet
 * excludes ambiguous characters; randomness is unnecessary here).
 */
export function nextConformanceClientRequestId(): string {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyz";
  clientRequestCounter += 1;
  let remaining = clientRequestCounter;
  let suffix = "";
  while (suffix.length < 10) {
    suffix = alphabet[remaining % alphabet.length] + suffix;
    remaining = Math.floor(remaining / alphabet.length);
  }
  return `creq_${suffix}`;
}
