import { describe, expect, it } from "vitest";
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
});
