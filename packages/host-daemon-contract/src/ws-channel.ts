import { z } from "zod";

export const HOST_DAEMON_WS_RESUME_FROM_QUERY_PARAM = "resumeFrom";

export const HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE = 4409;

export const HOST_DAEMON_WS_SHUTDOWN_CLOSE_REASON = "daemon-shutdown";

const HOST_DAEMON_WS_MAX_RETAINED_CHARS = 16 * 1024 * 1024;

const ACK_AFTER_MESSAGES = 64;
const ACK_AFTER_CHARS = 32 * 1024;

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

export type HostDaemonWsFrame = string | Uint8Array<ArrayBuffer>;

type HostDaemonWsReceiveResult =
  | { kind: "message"; message: unknown; attachment: Uint8Array | null }
  | { kind: "ignored" }
  | { kind: "invalid" }
  | { kind: "gap" };

interface RetainedFrame {
  frame: HostDaemonWsFrame;
  seq: number;
}

const BINARY_FRAME_HEADER_LENGTH_BYTES = 4;

function frameSize(frame: string | Uint8Array): number {
  return typeof frame === "string" ? frame.length : frame.byteLength;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeBinaryFrame(
  header: string,
  attachment: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const headerBytes = textEncoder.encode(header);
  const frame = new Uint8Array(
    BINARY_FRAME_HEADER_LENGTH_BYTES +
      headerBytes.byteLength +
      attachment.byteLength,
  );
  new DataView(frame.buffer).setUint32(0, headerBytes.byteLength);
  frame.set(headerBytes, BINARY_FRAME_HEADER_LENGTH_BYTES);
  frame.set(
    attachment,
    BINARY_FRAME_HEADER_LENGTH_BYTES + headerBytes.byteLength,
  );
  return frame;
}

function decodeFrame(
  frame: string | Uint8Array,
): { text: string; attachment: Uint8Array | null } | null {
  if (typeof frame === "string") {
    return { text: frame, attachment: null };
  }
  if (frame.byteLength < BINARY_FRAME_HEADER_LENGTH_BYTES) {
    return null;
  }
  const headerEnd =
    BINARY_FRAME_HEADER_LENGTH_BYTES +
    new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0);
  if (headerEnd > frame.byteLength) {
    return null;
  }
  return {
    text: textDecoder.decode(
      frame.subarray(BINARY_FRAME_HEADER_LENGTH_BYTES, headerEnd),
    ),
    attachment: frame.subarray(headerEnd),
  };
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

  encode(messageJson: string): string;
  encode(messageJson: string, attachment: Uint8Array | null): HostDaemonWsFrame;
  encode(
    messageJson: string,
    attachment: Uint8Array | null = null,
  ): HostDaemonWsFrame {
    this.lastSentSeq += 1;
    const seq = this.lastSentSeq;
    const header = `{"seq":${seq},"ack":${this.takeAck()},"message":${messageJson}}`;
    const frame =
      attachment === null ? header : encodeBinaryFrame(header, attachment);
    this.retained.push({ frame, seq });
    this.retainedChars += frameSize(frame);
    while (this.retainedChars > this.maxRetainedChars) {
      const dropped = this.retained.shift();
      if (!dropped) break;
      this.retainedChars -= frameSize(dropped.frame);
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

  replayFrom(peerReceivedSeq: number): HostDaemonWsFrame[] {
    this.acknowledge(peerReceivedSeq);
    return this.retained.map((retained) => retained.frame);
  }

  receive(data: string | Uint8Array): HostDaemonWsReceiveResult {
    const frameParts = decodeFrame(data);
    if (frameParts === null) {
      return { kind: "invalid" };
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(frameParts.text);
    } catch {
      return { kind: "invalid" };
    }
    const parsed = hostDaemonWsFrameSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.ack > this.lastSentSeq) {
      return { kind: "invalid" };
    }
    const frame = parsed.data;
    this.acknowledge(frame.ack);
    if (!("seq" in frame)) {
      return frameParts.attachment === null
        ? { kind: "ignored" }
        : { kind: "invalid" };
    }
    if (frame.seq <= this.lastReceivedSeq) {
      return { kind: "ignored" };
    }
    if (frame.seq !== this.lastReceivedSeq + 1) {
      return { kind: "gap" };
    }
    this.lastReceivedSeq = frame.seq;
    this.receivedSinceAck += 1;
    this.receivedCharsSinceAck += frameSize(data);
    return {
      kind: "message",
      message: frame.message,
      attachment: frameParts.attachment,
    };
  }

  private acknowledge(ack: number): void {
    if (ack <= this.acknowledgedByPeer) {
      return;
    }
    this.acknowledgedByPeer = ack;
    while (this.retained[0] !== undefined && this.retained[0].seq <= ack) {
      const acknowledged = this.retained.shift();
      if (acknowledged) this.retainedChars -= frameSize(acknowledged.frame);
    }
  }

  private takeAck(): number {
    this.receivedSinceAck = 0;
    this.receivedCharsSinceAck = 0;
    return this.lastReceivedSeq;
  }
}
