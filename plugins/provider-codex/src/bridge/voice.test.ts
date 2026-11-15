import { afterEach, expect, it, vi } from "vitest";
import { CodexVoiceSession, VOICE_STYLE_INSTRUCTIONS } from "./voice.js";
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
        includeStartupContext: false,
        initialItems: [{ role: "developer", text: VOICE_STYLE_INSTRUCTIONS }],
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
    message: null,
  });
  await expect(
    voice.command({ action: "keepAlive", sessionId: first }),
  ).rejects.toThrow("no longer active");
});

const replyComplete = {
  threadId: "native-thread",
  item: {
    type: "transcriptSegment",
    role: "assistant",
    text: "Yep, I'm here.",
  },
};

it("starts with only voice style and quietly adds history after the first assistant reply", async () => {
  const { voice, request, publish } = setup();
  const context = [
    { role: "user" as const, text: "Historical request with tool evidence" },
  ];
  const start = voice.command(
    { action: "start", sessionId: first, sdp: "offer" },
    context,
  );
  expect(request.mock.calls[0]?.[0].params).toMatchObject({
    includeStartupContext: false,
    initialItems: [{ role: "developer", text: VOICE_STYLE_INSTRUCTIONS }],
  });
  expect(JSON.stringify(request.mock.calls)).not.toContain(
    "Historical request",
  );
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await start;
  voice.notification("thread/realtime/item/completed", {
    ...replyComplete,
    threadId: "other-thread",
  });
  voice.notification("thread/realtime/item/completed", {
    threadId: "native-thread",
    item: { type: "transcriptSegment", role: "user", text: "Hey" },
  });
  expect(request).toHaveBeenCalledTimes(1);
  voice.notification("thread/realtime/item/completed", replyComplete);
  expect(request).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenLastCalledWith({
    sessionId: first,
    status: "active",
    message: null,
    backgroundContext: expect.stringContaining(
      "Historical request with tool evidence",
    ),
  });
  const count = publish.mock.calls.length;
  voice.notification("thread/realtime/item/completed", replyComplete);
  expect(publish).toHaveBeenCalledTimes(count);
  expect(
    request.mock.calls.some(
      (call) => call[0].method === "thread/realtime/appendText",
    ),
  ).toBe(false);
});

it("never appends deferred history after a session has ended", async () => {
  const { voice, request } = setup();
  const start = voice.command(
    { action: "start", sessionId: first, sdp: "offer" },
    [{ role: "user", text: "Old context" }],
  );
  voice.notification("thread/realtime/sdp", {
    threadId: "native-thread",
    sdp: "answer",
  });
  await start;
  await voice.command({ action: "stop", sessionId: first });
  voice.notification("thread/realtime/item/completed", replyComplete);
  expect(request.mock.calls.map((call) => call[0].method)).toEqual([
    "thread/realtime/start",
    "thread/realtime/stop",
  ]);
});
