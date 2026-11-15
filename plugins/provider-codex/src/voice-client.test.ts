import { afterEach, expect, it, vi } from "vitest";
import { VoiceClient, type VoiceRequest } from "./voice-client.js";

afterEach(() => vi.useRealTimers());

function setup() {
  const track = { stop: vi.fn(), enabled: true, onended: null };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const channel = {
    readyState: "open",
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    send: vi.fn(),
    close: vi.fn(),
  };
  const peer = {
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer" })),
    setLocalDescription: vi.fn(async () => {}),
    localDescription: { sdp: "offer" },
    setRemoteDescription: vi.fn(async () => {}),
    close: vi.fn(),
    ontrack: null,
    onconnectionstatechange: null,
  };
  const request = vi.fn(
    async (command: VoiceRequest): Promise<{ sdp: string | null }> => ({
      sdp: command.action === "start" ? "answer" : null,
    }),
  );
  const state = vi.fn();
  const audio = { pause: vi.fn(), srcObject: null };
  const mediaDevices = { getUserMedia: vi.fn(async () => stream) };
  const client = new VoiceClient({
    audio: audio as unknown as HTMLAudioElement,
    request,
    state,
    audioBlocked: vi.fn(),
    mediaDevices,
    createPeer: () => peer as unknown as RTCPeerConnection,
  });
  return {
    client,
    track,
    stream,
    peer,
    channel,
    request,
    state,
    audio,
    mediaDevices,
  };
}

it("uses native two-way WebRTC, mutes capture, and releases all local resources", async () => {
  const { client, track, peer, request, state, audio } = setup();
  await client.start();
  expect(peer.createDataChannel).toHaveBeenCalledWith("oai-events");
  expect(request).toHaveBeenCalledWith({
    action: "start",
    sessionId: client.sessionId,
    sdp: "offer",
  });
  expect(peer.setRemoteDescription).toHaveBeenCalledWith({
    type: "answer",
    sdp: "answer",
  });
  client.mute(true);
  expect(track.enabled).toBe(false);
  client.mute(false);
  expect(track.enabled).toBe(true);
  client.stop();
  client.stop();
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(peer.close).toHaveBeenCalledTimes(1);
  expect(audio.pause).toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith("closed", null);
  expect(request).toHaveBeenLastCalledWith({
    action: "stop",
    sessionId: client.sessionId,
  });
});

it("releases a microphone granted after the user has canceled", async () => {
  const { client, stream, mediaDevices, track, request } = setup();
  let grant!: (stream: MediaStream) => void;
  mediaDevices.getUserMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const start = client.start();
  client.stop();
  grant(stream);
  await start;
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
});

it("ignores a late answer after leaving a thread and stops the same remote session", async () => {
  const { client, request, peer } = setup();
  let answer!: (result: { sdp: string }) => void;
  request.mockImplementation((command) =>
    command.action === "stop"
      ? Promise.resolve({ sdp: null })
      : new Promise((resolve) => {
          answer = resolve;
        }),
  );
  const start = client.start();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  client.stop();
  answer({ sdp: "late answer" });
  await start;
  expect(peer.setRemoteDescription).not.toHaveBeenCalled();
  expect(request).toHaveBeenLastCalledWith({
    action: "stop",
    sessionId: client.sessionId,
  });
});

it("does not open a remote call if microphone permission is denied", async () => {
  const { client, mediaDevices, request, state } = setup();
  mediaDevices.getUserMedia.mockRejectedValue(
    new Error("Microphone permission denied"),
  );
  await client.start();
  expect(request).not.toHaveBeenCalled();
  expect(state).toHaveBeenLastCalledWith(
    "closed",
    "Microphone permission denied",
  );
});

it("sends background reference only on the developer channel in bounded Unicode-safe frames", async () => {
  const { client, channel } = setup();
  await client.start();
  const text = "Source facts 🌿你好\n".repeat(250);
  client.addBackgroundContext(text);
  expect(channel.send).toHaveBeenCalledOnce();
  client.addBackgroundContext(text);
  for (let index = 0; index < 20; index++)
    channel.onmessage?.({
      data: JSON.stringify({ type: "session.context.appended" }),
    });
  const frames = channel.send.mock.calls.map((call) => JSON.parse(call[0]));
  expect(frames.length).toBeGreaterThan(1);
  expect(
    frames.every(
      (frame) =>
        frame.type === "session.context.append" &&
        frame.channel === "developer",
    ),
  ).toBe(true);
  expect(frames.map((frame) => frame.content[0].text).join("")).toBe(text);
  expect(
    frames.every(
      (frame) => new TextEncoder().encode(frame.content[0].text).length <= 500,
    ),
  ).toBe(true);
  const count = channel.send.mock.calls.length;
  client.addBackgroundContext(text);
  expect(channel.send).toHaveBeenCalledTimes(count);
  client.stop();
});

it("waits for the data channel and discards queued background after cancellation", async () => {
  const { client, channel } = setup();
  channel.readyState = "connecting";
  await client.start();
  client.addBackgroundContext("Reference facts");
  expect(channel.send).not.toHaveBeenCalled();
  channel.readyState = "open";
  channel.onopen?.();
  expect(channel.send).toHaveBeenCalledOnce();
  client.stop();
  client.addBackgroundContext("Late old context");
  expect(channel.send).toHaveBeenCalledOnce();
  expect(channel.onopen).toBeNull();
  expect(channel.close).toHaveBeenCalledOnce();
});

it("does not deliver queued context if voice ends before the channel opens", async () => {
  const { client, channel } = setup();
  channel.readyState = "connecting";
  await client.start();
  client.addBackgroundContext("Reference facts");
  const lateOpen = channel.onopen;
  client.stop();
  channel.readyState = "open";
  lateOpen?.();
  expect(channel.send).not.toHaveBeenCalled();
});

it("pauses background delivery during speech and resumes after the reply completes", async () => {
  const { client, channel } = setup();
  await client.start();
  const text = "reference fact\n".repeat(200);
  client.addBackgroundContext(text);
  expect(channel.send).toHaveBeenCalledOnce();
  channel.onmessage?.({
    data: JSON.stringify({
      type: "input_transcript.added",
      item: { text: "My next question" },
    }),
  });
  channel.onmessage?.({
    data: JSON.stringify({ type: "session.context.appended" }),
  });
  expect(channel.send).toHaveBeenCalledOnce();
  channel.onmessage?.({
    data: JSON.stringify({ type: "turn.done", turn: { role: "user" } }),
  });
  channel.onmessage?.({
    data: JSON.stringify({ type: "turn.created", turn: { role: "assistant" } }),
  });
  expect(channel.send).toHaveBeenCalledOnce();
  channel.onmessage?.({
    data: JSON.stringify({ type: "turn.done", turn: { role: "assistant" } }),
  });
  expect(channel.send).toHaveBeenCalledTimes(2);
  channel.onmessage?.({
    data: JSON.stringify({ type: "session.context.appended" }),
  });
  expect(channel.send).toHaveBeenCalledTimes(3);
  client.stop();
});
