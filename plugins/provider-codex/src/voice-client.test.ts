import { afterEach, expect, it, vi } from "vitest";
import { VoiceClient, type VoiceRequest } from "./voice-client.js";

afterEach(() => vi.useRealTimers());

function setup() {
  const track = { stop: vi.fn(), enabled: true, onended: null };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const peer = {
    addTrack: vi.fn(),
    createDataChannel: vi.fn(),
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
  return { client, track, stream, peer, request, state, audio, mediaDevices };
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
