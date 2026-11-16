import { afterEach, expect, it, vi } from "vitest";
import { CodexVoiceSession, requireNativeVoiceVersion } from "./voice.js";
import type { CodexAppServerConnection } from "./app-server-connection.js";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.useRealTimers());

function setup() {
  const request = vi.fn(
    async (_args: { method: string; params?: unknown }) => ({}),
  );
  const publish = vi.fn();
  const voice = new CodexVoiceSession(
    {
      request: async (args) => args.resultSchema.parse(await request(args)),
      kill: async () => {},
      exited: false,
    },
    "native-thread",
    publish,
  );
  return { voice, request, publish };
}

it("negotiates native WebRTC on the existing thread, including an answer before start completes", async () => {
  const { voice, request, publish } = setup();
  const result = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "other-thread",
    sdp: "wrong",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await expect(result).resolves.toEqual({ sdp: "answer" });
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "thread/realtime/start",
      params: {
        threadId: "native-thread",
        transport: { type: "webrtc", sdp: "offer" },
        version: "v3",
        outputModality: "audio",
      },
    }),
  );
  expect(publish).toHaveBeenLastCalledWith({
    sessionId: first,
    status: "active",
    message: null,
  });
  await expect(
    voice.command({ action: "start", sessionId: second, sdp: "offer" }),
  ).rejects.toThrow("already open");
  await voice.command({ action: "stop", sessionId: second });
  expect(request).toHaveBeenCalledTimes(1);
  await voice.command({ action: "stop", sessionId: first });
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "thread/realtime/stop",
      params: { threadId: "native-thread" },
    }),
  );
  expect(publish).toHaveBeenLastCalledWith({
    sessionId: first,
    status: "closed",
    message: null,
  });
});

it("releases upstream voice after a missing SDP answer and allows retry", async () => {
  vi.useFakeTimers();
  const { voice, request, publish } = setup();
  const result = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
  });
  const rejected = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(30000);
  await rejected;
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({ method: "thread/realtime/stop" }),
  );
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "error" }),
  );
  const retry = voice.command({
    action: "start",
    sessionId: second,
    sdp: "retry",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await expect(retry).resolves.toEqual({ sdp: "answer" });
});

it("fails pending negotiation when Codex exits or reports a realtime error", async () => {
  const { voice, publish } = setup();
  const result = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
  });
  voice.notification("thread/realtime/error", {
    threadId: "native-thread",
    message: "Voice is unavailable for this account",
  });
  await expect(result).rejects.toThrow("unavailable for this account");
  expect(publish).toHaveBeenCalledWith({
    sessionId: first,
    status: "error",
    message: "Voice is unavailable for this account",
  });
});

it("expires abandoned clients while a healthy client can renew the call", async () => {
  vi.useFakeTimers();
  const { voice, request, publish } = setup();
  const result = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await result;
  await vi.advanceTimersByTimeAsync(45000);
  await voice.command({ action: "keepAlive", sessionId: first });
  await vi.advanceTimersByTimeAsync(45000);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15000);
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({ method: "thread/realtime/stop" }),
  );
  expect(publish).toHaveBeenLastCalledWith({
    sessionId: first,
    status: "closed",
    message: "The voice lease expired",
  });
  await expect(
    voice.command({ action: "keepAlive", sessionId: first }),
  ).rejects.toThrow("no longer active");
});

it("supplies caller context and handoff instructions only at startup without core policy", async () => {
  const { voice, request } = setup();
  const started = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
    voice: "juniper",
    initialContext: "Caller-selected historical reference",
    instructions: "Caller-selected handoff guidance",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await started;
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "thread/realtime/start",
      params: expect.objectContaining({
        voice: "juniper",
        includeStartupContext: false,
        initialItems: [
          { role: "developer", text: "Caller-selected historical reference" },
        ],
        realtimeStartInstructions: "Caller-selected handoff guidance",
      }),
    }),
  );
  await voice.command({ action: "keepAlive", sessionId: first });
  expect(request).toHaveBeenCalledTimes(1);
  await voice.command({ action: "stop", sessionId: first });
});

it("distinguishes an explicit empty startup reference from provider defaults", async () => {
  const { voice, request } = setup();
  const started = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
    initialContext: "",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await started;
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: "thread/realtime/start",
      params: expect.objectContaining({
        includeStartupContext: false,
        initialItems: [],
      }),
    }),
  );
  await voice.command({ action: "stop", sessionId: first });
});

it.each([
  null,
  "unknown",
  "codex_cli_rs/0.136.0 (test)",
  "codex_cli_rs/0.146.0 (test)",
  "codex_cli_rs/0.147.0-alpha.1 (test)",
])(
  "rejects native voice before unsupported startup fields can be silently ignored (%s)",
  (userAgent) => {
    expect(() => requireNativeVoiceVersion(userAgent)).toThrow("0.147.0");
  },
);
it.each([
  "codex_cli_rs/0.147.0 (test)",
  "bb/0.160.1 (test; client 1.0.0)",
  "codex_cli_rs/1.0.0",
  "codex_cli_rs/0.161.0-alpha.2 (test)",
  "codex_cli_rs/0.147.0+build.1 (test)",
])(
  "accepts an app-server version supporting all native voice startup fields (%s)",
  (userAgent) => {
    expect(() => requireNativeVoiceVersion(userAgent)).not.toThrow();
  },
);

it("completes hang-up and reports an unconfirmed upstream stop in the closed state", async () => {
  const { voice, request, publish } = setup();
  const started = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await started;
  request.mockRejectedValueOnce(new Error("request timed out"));
  await expect(
    voice.command({ action: "stop", sessionId: first }),
  ).resolves.toEqual({ sdp: null });
  expect(publish).toHaveBeenLastCalledWith({
    sessionId: first,
    status: "closed",
    message: "Codex did not confirm the voice stop: request timed out",
  });
  await expect(
    voice.command({ action: "keepAlive", sessionId: first }),
  ).rejects.toThrow("no longer active");
});

it("publishes the provider's close reason and a teardown reason without marking them as errors", async () => {
  const { voice, publish } = setup();
  for (const [sessionId, end] of [
    [
      first,
      () =>
        voice.notification("thread/realtime/closed", {
          threadId: "native-thread",
          reason: "transport closed",
        }),
    ],
    [second, () => voice.close("The Codex session restarted", "closed")],
  ] as const) {
    const started = voice.command({ action: "start", sessionId, sdp: "offer" });
    voice.notification("thread/realtime/sdp", {
      threadId: "native-thread",
      sdp: "answer",
    });
    await started;
    end();
  }
  expect(publish.mock.calls.map(([state]) => state)).toEqual([
    { sessionId: first, status: "active", message: null },
    { sessionId: first, status: "closed", message: "transport closed" },
    { sessionId: second, status: "active", message: null },
    {
      sessionId: second,
      status: "closed",
      message: "The Codex session restarted",
    },
  ]);
});

it("keeps a newer call open when an expired lease's stop completes after Codex already closed the old call", async () => {
  vi.useFakeTimers();
  const { voice, request, publish } = setup();
  let finishStop: (error: Error) => void = () => {};
  request.mockImplementation(async ({ method }) => {
    if (method !== "thread/realtime/stop") return {};
    return new Promise((_, reject) => {
      finishStop = reject;
    });
  });
  const started = voice.command({
    action: "start",
    sessionId: first,
    sdp: "offer",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await started;
  await vi.advanceTimersByTimeAsync(60000);
  voice.notification("thread/realtime/closed", {
    threadId: "native-thread",
    reason: null,
  });
  const restarted = voice.command({
    action: "start",
    sessionId: second,
    sdp: "offer",
  });
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await expect(restarted).resolves.toEqual({ sdp: "answer" });
  finishStop(new Error("request timed out"));
  await vi.advanceTimersByTimeAsync(0);

  expect(publish.mock.calls.map(([state]) => state)).toEqual([
    { sessionId: first, status: "active", message: null },
    { sessionId: first, status: "closed", message: "The voice lease expired" },
    { sessionId: second, status: "active", message: null },
  ]);
  await expect(
    voice.command({ action: "keepAlive", sessionId: second }),
  ).resolves.toEqual({ sdp: null });
});
