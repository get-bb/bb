import type { HostDaemonDaemonWsMessage } from "@bb/host-daemon-contract";

export interface QueuedSessionPayload {
  bytes: number;
}

export function sessionSendStreamKey(
  message: HostDaemonDaemonWsMessage,
): string | null {
  switch (message.type) {
    case "terminal.output":
    case "terminal.opened":
    case "terminal.replay":
    case "terminal.error":
    case "terminal.exited":
      return `terminal\u0000${message.terminalId}`;
    case "host-rpc.response":
      return message.commandType === "host.read_file_chunk"
        ? `file-chunk\u0000${message.requestId}`
        : null;
    default:
      return null;
  }
}

export class SessionSendQueue<TPayload extends QueuedSessionPayload> {
  private readonly control: TPayload[] = [];
  private readonly streams = new Map<string, TPayload[]>();
  private queuedBytes = 0;

  get bytes(): number {
    return this.queuedBytes;
  }

  get hasControl(): boolean {
    return this.control.length > 0;
  }

  get hasStreams(): boolean {
    return this.streams.size > 0;
  }

  hasStream(key: string): boolean {
    return this.streams.has(key);
  }

  push(stream: string | null, payload: TPayload): void {
    this.queuedBytes += payload.bytes;
    if (stream === null) {
      this.control.push(payload);
      return;
    }
    const queue = this.streams.get(stream);
    if (queue) {
      queue.push(payload);
      return;
    }
    this.streams.set(stream, [payload]);
  }

  takeControl(): TPayload | undefined {
    const payload = this.control.shift();
    if (payload) {
      this.queuedBytes -= payload.bytes;
    }
    return payload;
  }

  takeNextStreamPayload(): TPayload | undefined {
    const next = this.streams.entries().next();
    if (next.done) {
      return undefined;
    }
    const [key, queue] = next.value;
    const payload = queue.shift();
    this.streams.delete(key);
    if (queue.length > 0) {
      this.streams.set(key, queue);
    }
    if (payload) {
      this.queuedBytes -= payload.bytes;
    }
    return payload;
  }

  clear(): void {
    this.control.length = 0;
    this.streams.clear();
    this.queuedBytes = 0;
  }
}
