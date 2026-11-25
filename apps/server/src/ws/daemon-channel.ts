import {
  HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE,
  HostDaemonWsSequencer,
  decodeHostDaemonDaemonWsMessage,
  type HostDaemonWsFrame,
} from "@bb/host-daemon-contract";
import { COMPRESSED_SEND } from "./compression.js";
import { decodeSocketPayload } from "./decode-payload.js";

export interface RawDaemonSocket {
  close(code?: number, reason?: string): void;
  send(data: HostDaemonWsFrame, options?: { compress: boolean }): void;
}

function decodeDaemonFrame(raw: unknown): string | Uint8Array {
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return decodeSocketPayload(raw);
}

export type DaemonChannelDetachResult = "detached" | "ended" | "stale";

export class DaemonChannel {
  private socket: RawDaemonSocket | null;
  private ended = false;
  private readonly sequencer = new HostDaemonWsSequencer();

  constructor(socket: RawDaemonSocket) {
    this.socket = socket;
  }

  send(data: string): void {
    if (this.ended) {
      return;
    }
    const frame = this.sequencer.encode(data);
    this.socket?.send(frame, COMPRESSED_SEND);
  }

  close(code?: number, reason?: string): void {
    this.ended = true;
    const socket = this.socket;
    this.socket = null;
    socket?.close(code, reason);
  }

  receive(socket: RawDaemonSocket, raw: unknown): { message: unknown } | null {
    if (socket !== this.socket) {
      return null;
    }
    const result = this.sequencer.receive(decodeDaemonFrame(raw));
    switch (result.kind) {
      case "invalid":
        this.close(1008, "invalid-message");
        return null;
      case "gap":
        this.close(HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE, "sequence-gap");
        return null;
      case "ignored":
        return null;
      case "message": {
        if (this.sequencer.ackDue) {
          socket.send(this.sequencer.encodeAck());
        }
        const decoded = decodeHostDaemonDaemonWsMessage(
          result.message,
          result.attachment,
        );
        if (!decoded.ok) {
          this.close(1008, "invalid-message");
          return null;
        }
        return { message: decoded.message };
      }
    }
  }

  detach(socket: RawDaemonSocket): DaemonChannelDetachResult {
    if (this.ended) {
      return "ended";
    }
    if (socket !== this.socket) {
      return "stale";
    }
    this.socket = null;
    return "detached";
  }

  canResumeFrom(peerReceivedSeq: number): boolean {
    return !this.ended && this.sequencer.canResumeFrom(peerReceivedSeq);
  }

  resume(socket: RawDaemonSocket, peerReceivedSeq: number): void {
    const previous = this.socket;
    this.socket = socket;
    previous?.close(1000, "resumed");
    socket.send(this.sequencer.encodeAck());
    for (const frame of this.sequencer.replayFrom(peerReceivedSeq)) {
      socket.send(frame, COMPRESSED_SEND);
    }
  }
}
