import { describe, expect, it } from "vitest";
import {
  decodeHostDaemonDaemonWsMessage,
  encodeHostDaemonDaemonWsMessage,
  hostDaemonDaemonWsMessageSchema,
} from "../src/session.js";
import { HostDaemonWsSequencer } from "../src/ws-channel.js";

function connectedPair(maxRetainedChars?: number) {
  return {
    receiver: new HostDaemonWsSequencer(),
    sender: new HostDaemonWsSequencer(maxRetainedChars),
  };
}

describe("HostDaemonWsSequencer", () => {
  it("delivers each message once across a replay and rejects a skipped sequence", () => {
    const { receiver, sender } = connectedPair();
    const first = sender.encode('{"type":"heartbeat"}');
    const second = sender.encode('{"type":"machine.shutdown-ack"}');
    const third = sender.encode('{"type":"heartbeat"}');

    expect(receiver.receive(first)).toEqual({
      kind: "message",
      message: { type: "heartbeat" },
      attachment: null,
    });
    const replay = sender.replayFrom(0);
    expect(replay).toEqual([first, second, third]);
    expect(replay.map((frame) => receiver.receive(frame).kind)).toEqual([
      "ignored",
      "message",
      "message",
    ]);

    const skipped = new HostDaemonWsSequencer();
    expect(skipped.receive(second)).toEqual({ kind: "gap" });
  });

  it("refuses to resume past frames it dropped until the peer acknowledges them", () => {
    const { sender } = connectedPair(80);
    const frames = Array.from({ length: 4 }, () =>
      sender.encode('{"type":"heartbeat"}'),
    );
    expect(sender.replayable).toBe(false);
    expect(sender.canResumeFrom(0)).toBe(false);
    expect(sender.canResumeFrom(5)).toBe(false);

    const dropped = frames.length - sender.replayFrom(0).length;
    expect(sender.canResumeFrom(dropped)).toBe(true);
    expect(sender.receive(`{"ack":${dropped}}`)).toEqual({ kind: "ignored" });
    expect(sender.replayable).toBe(true);
    expect(sender.receive('{"ack":99}')).toEqual({ kind: "invalid" });
  });

  it("carries file chunk bytes as a binary frame in sequence with text frames and across a replay", () => {
    const { receiver, sender } = connectedPair();
    const content = new Uint8Array([0, 1, 2, 250, 255]);
    const chunk = hostDaemonDaemonWsMessageSchema.parse({
      type: "host-rpc.response",
      requestId: "request-1",
      commandType: "host.read_file_chunk",
      ok: true,
      result: {
        path: "/tmp/clip.mp4",
        sizeBytes: 5,
        modifiedAtMs: 1,
        mimeType: "video/mp4",
        revision: "a".repeat(64),
        offset: 0,
        content,
      },
    });
    const encoded = encodeHostDaemonDaemonWsMessage(chunk);
    expect(encoded.json).not.toContain("content");
    const heartbeat = sender.encode('{"type":"heartbeat"}');
    const binary = sender.encode(encoded.json, encoded.attachment);
    expect(binary).toBeInstanceOf(Uint8Array);

    receiver.receive(heartbeat);
    const received = receiver.receive(binary);
    if (received.kind !== "message") {
      throw new Error(`Expected a message, got ${received.kind}`);
    }
    const decoded = decodeHostDaemonDaemonWsMessage(
      received.message,
      received.attachment,
    );
    if (!decoded.ok) {
      throw new Error("Expected the chunk to decode");
    }
    expect(hostDaemonDaemonWsMessageSchema.parse(decoded.message)).toEqual(
      chunk,
    );
    expect(sender.replayFrom(0)).toEqual([heartbeat, binary]);
    expect(
      new HostDaemonWsSequencer().receive(sender.replayFrom(0)[1]!).kind,
    ).toBe("gap");
  });

  it("rejects binary bytes on a frame or message that cannot carry them", () => {
    const sender = new HostDaemonWsSequencer();
    const frame = sender.encode('{"type":"heartbeat"}', new Uint8Array([1]));
    const received = new HostDaemonWsSequencer().receive(frame);
    if (received.kind !== "message") {
      throw new Error(`Expected a message, got ${received.kind}`);
    }
    expect(
      decodeHostDaemonDaemonWsMessage(received.message, received.attachment),
    ).toEqual({ ok: false });
    expect(new HostDaemonWsSequencer().receive(new Uint8Array([0, 0]))).toEqual(
      { kind: "invalid" },
    );
    expect(
      new HostDaemonWsSequencer().receive(new Uint8Array([0, 0, 0, 99, 123])),
    ).toEqual({ kind: "invalid" });
  });
});
