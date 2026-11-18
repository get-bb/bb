import { z } from "zod";

export const HOST_DAEMON_WS_RESUME_FROM_QUERY_PARAM = "resumeFrom";

export const HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE = 4409;

export const HOST_DAEMON_WS_SHUTDOWN_CLOSE_REASON = "daemon-shutdown";

const HOST_DAEMON_WS_MAX_RETAINED_CHARS = 16 * 1024 * 1024;

const ACK_AFTER_MESSAGES = 64;
const ACK_AFTER_CHARS = 256 * 1024;

const sequenceNumberSchema = z.number().int().nonnegative();

const hostDaemonWsFrameSchema = z.union([
  z
    .object({
      seq: z.number().int().positive(),
      ack: sequenceNumberSchema,
      message: z.unknown(),
    })
    .strict(),
  z.object({ ack: sequenceNumberSchema }).strict(),
]);

export const hostDaemonWsResumeFromSchema = z.coerce
  .number()
  .int()
  .nonnegative();

type HostDaemonWsReceiveResult =
  | { kind: "message"; message: unknown }
  | { kind: "ignored" }
  | { kind: "invalid" }
  | { kind: "gap" };

interface RetainedFrame {
  frame: string;
  seq: number;
}

export class HostDaemonWsSequencer {
  private lastSentSeq = 0;
  private lastReceivedSeq = 0;
  private acknowledgedByPeer = 0;
  private receivedSinceAck = 0;
  private receivedCharsSinceAck = 0;
  private readonly retained: RetainedFrame[] = [];
  private retainedChars = 0;
  private droppedThroughSeq = 0;

  constructor(
    private readonly maxRetainedChars: number = HOST_DAEMON_WS_MAX_RETAINED_CHARS,
  ) {}

  get receivedSeq(): number {
    return this.lastReceivedSeq;
  }

  get sentSeq(): number {
    return this.lastSentSeq;
  }

  get acknowledgedSeq(): number {
    return this.acknowledgedByPeer;
  }

  get ackDue(): boolean {
    return (
      this.receivedSinceAck >= ACK_AFTER_MESSAGES ||
      this.receivedCharsSinceAck >= ACK_AFTER_CHARS
    );
  }

  get replayable(): boolean {
    return this.droppedThroughSeq <= this.acknowledgedByPeer;
  }

  encode(messageJson: string): string {
    this.lastSentSeq += 1;
    const seq = this.lastSentSeq;
    const frame = `{"seq":${seq},"ack":${this.takeAck()},"message":${messageJson}}`;
    this.retained.push({ frame, seq });
    this.retainedChars += frame.length;
    while (this.retainedChars > this.maxRetainedChars) {
      const dropped = this.retained.shift();
      if (!dropped) break;
      this.retainedChars -= dropped.frame.length;
      this.droppedThroughSeq = dropped.seq;
    }
    return frame;
  }

  encodeAck(): string {
    return `{"ack":${this.takeAck()}}`;
  }

  canResumeFrom(peerReceivedSeq: number): boolean {
    return (
      peerReceivedSeq >= this.droppedThroughSeq &&
      peerReceivedSeq <= this.lastSentSeq
    );
  }

  replayFrom(peerReceivedSeq: number): string[] {
    this.acknowledge(peerReceivedSeq);
    return this.retained.map((retained) => retained.frame);
  }

  receive(text: string): HostDaemonWsReceiveResult {
    let decoded: unknown;
    try {
      decoded = JSON.parse(text);
    } catch {
      return { kind: "invalid" };
    }
    const parsed = hostDaemonWsFrameSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.ack > this.lastSentSeq) {
      return { kind: "invalid" };
    }
    const frame = parsed.data;
    this.acknowledge(frame.ack);
    if (!("seq" in frame) || frame.seq <= this.lastReceivedSeq) {
      return { kind: "ignored" };
    }
    if (frame.seq !== this.lastReceivedSeq + 1) {
      return { kind: "gap" };
    }
    this.lastReceivedSeq = frame.seq;
    this.receivedSinceAck += 1;
    this.receivedCharsSinceAck += text.length;
    return { kind: "message", message: frame.message };
  }

  private acknowledge(ack: number): void {
    if (ack <= this.acknowledgedByPeer) {
      return;
    }
    this.acknowledgedByPeer = ack;
    while (this.retained[0] !== undefined && this.retained[0].seq <= ack) {
      const acknowledged = this.retained.shift();
      if (acknowledged) this.retainedChars -= acknowledged.frame.length;
    }
  }

  private takeAck(): number {
    this.receivedSinceAck = 0;
    this.receivedCharsSinceAck = 0;
    return this.lastReceivedSeq;
  }
}
