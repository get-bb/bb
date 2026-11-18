import { getSessionById, setExperiments } from "@bb/db";
import {
  buildHostDaemonWebSocketProtocols,
  HOST_DAEMON_PROTOCOL_VERSION,
  HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE,
  type HostDaemonOnlineRpcRequestMessage,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { HOST_RECONNECT_GRACE_MS } from "../../src/constants.js";
import {
  createDaemonSocketEvents,
  startDaemonLivenessChecks,
  validateDaemonWebSocket,
} from "../../src/ws/daemon-protocol.js";
import {
  createTestDaemonHostKey,
  startTestServer,
  withTestHarness,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

const HOST_ID = "host-1";
const AUTHORIZATION = `Bearer ${createTestDaemonHostKey({ hostId: HOST_ID })}`;

const sockets = new Set<WebSocket>();
let server: RunningTestServer | null = null;

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

const frameSchema = z.object({
  ack: z.number(),
  seq: z.number().optional(),
  message: z.object({ type: z.string() }).passthrough().optional(),
});
type Frame = z.infer<typeof frameSchema>;

interface DaemonClient {
  closed: Promise<{ code: number; reason: string }>;
  frames: Frame[];
  socket: WebSocket;
}

async function openSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/internal/session/open`, {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      hostId: HOST_ID,
      instanceId: "instance-1",
      hostName: "Host",
      hasMachineCredential: false,
      platform: "darwin",
      dataDir: "/tmp/host-data",
      localApiPort: null,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads: [],
      openThreadWork: [],
    }),
  });
  expect(response.status).toBe(201);
  return z.object({ sessionId: z.string() }).parse(await response.json())
    .sessionId;
}

function connect(
  baseUrl: string,
  sessionId: string,
  resumeFrom: number | null,
): Promise<DaemonClient> {
  const url = new URL("/internal/ws", baseUrl);
  url.protocol = "ws:";
  url.searchParams.set("sessionId", sessionId);
  if (resumeFrom !== null) {
    url.searchParams.set("resumeFrom", String(resumeFrom));
  }
  const socket = new WebSocket(url, buildHostDaemonWebSocketProtocols(), {
    headers: { authorization: AUTHORIZATION },
  });
  sockets.add(socket);
  const frames: Frame[] = [];
  socket.on("message", (data: Buffer) => {
    frames.push(frameSchema.parse(JSON.parse(data.toString("utf8"))));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString("utf8") }),
    );
  });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ closed, frames, socket }));
    socket.once("error", reject);
  });
}

function sendFrame(
  client: DaemonClient,
  seq: number,
  ack: number,
  message: object,
): void {
  client.socket.send(JSON.stringify({ seq, ack, message }));
}

function listFilesRequest(
  requestId: string,
): HostDaemonOnlineRpcRequestMessage {
  return {
    type: "host-rpc.request",
    requestId,
    command: {
      type: "host.list_files",
      followRootSymlink: false,
      path: "/tmp/resume-test",
      limit: 10,
      includeHidden: false,
      respectGitIgnore: false,
      excludeNames: [],
    },
  };
}

describe("daemon session resume", () => {
  it("keeps the session and in-flight host RPCs across a dropped socket and replays what the server sent meanwhile", async () => {
    server = await startTestServer();
    const running = server;
    setExperiments(running.db, { resumeDaemonSessions: true });
    const sessionId = await openSession(running.baseUrl);
    const first = await connect(running.baseUrl, sessionId, null);
    await vi.waitFor(() =>
      expect(running.hub.hasDaemonForHost(HOST_ID)).toBe(true),
    );

    sendFrame(first, 1, 0, { type: "heartbeat" });
    await vi.waitFor(() =>
      expect(first.frames.map((frame) => frame.message?.type)).toContain(
        "heartbeat-ack",
      ),
    );
    const receivedSeq = Math.max(
      ...first.frames.map((frame) => frame.seq ?? 0),
    );

    first.socket.terminate();
    await first.closed;
    const rpc = running.hub.requestHostOnlineRpc({
      hostId: HOST_ID,
      message: listFilesRequest("rpc-across-drop"),
      timeoutMs: 10_000,
    });
    expect(running.hub.hasDaemonForHost(HOST_ID)).toBe(true);

    const resumed = await connect(running.baseUrl, sessionId, receivedSeq);
    await vi.waitFor(() =>
      expect(resumed.frames.map((frame) => frame.message?.type)).toContain(
        "host-rpc.request",
      ),
    );
    expect(resumed.frames[0]).toEqual({ ack: 1 });
    const replayed = resumed.frames.filter(
      (frame) => frame.message !== undefined,
    );
    expect(replayed.every((frame) => (frame.seq ?? 0) > receivedSeq)).toBe(
      true,
    );
    expect(
      replayed.filter((frame) => frame.message?.type === "host-rpc.request"),
    ).toHaveLength(1);
    const request = resumed.frames.find(
      (frame) => frame.message?.type === "host-rpc.request",
    );

    sendFrame(resumed, 1, receivedSeq, { type: "heartbeat" });
    sendFrame(resumed, 2, request?.seq ?? 0, {
      type: "host-rpc.response",
      requestId: "rpc-across-drop",
      commandType: "host.list_files",
      ok: true,
      result: { files: [], truncated: false },
    });
    await expect(rpc).resolves.toMatchObject({
      requestId: "rpc-across-drop",
      ok: true,
    });
    expect(getSessionById(running.db, { sessionId })).toMatchObject({
      status: "active",
    });
    expect(running.hub.getDaemonSessionIdForHost(HOST_ID)).toBe(sessionId);
  });

  it("refuses to resume from a sequence the server never sent so the daemon opens a new session", async () => {
    server = await startTestServer();
    setExperiments(server.db, { resumeDaemonSessions: true });
    const sessionId = await openSession(server.baseUrl);
    const first = await connect(server.baseUrl, sessionId, null);
    first.socket.terminate();
    await first.closed;

    const resumed = await connect(server.baseUrl, sessionId, 50);
    await expect(resumed.closed).resolves.toEqual({
      code: HOST_DAEMON_WS_RESUME_REJECTED_CLOSE_CODE,
      reason: "resume-rejected",
    });
  });
});

function mockRawSocket() {
  return {
    close: vi.fn<(code?: number, reason?: string) => void>(),
    send: vi.fn<(data: string) => void>(),
  };
}

async function openMockDaemon(harness: TestAppHarness) {
  const response = await harness.app.request("/internal/session/open", {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      hostId: HOST_ID,
      instanceId: "instance-1",
      hostName: "Host",
      hasMachineCredential: false,
      platform: "darwin",
      dataDir: "/tmp/host-data",
      localApiPort: null,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads: [],
      openThreadWork: [],
    }),
  });
  const { reconnectGraceMs, sessionId } = z
    .object({ reconnectGraceMs: z.number(), sessionId: z.string() })
    .parse(await response.json());
  const target = await validateDaemonWebSocket(harness.deps, {
    authorizationHeader: AUTHORIZATION,
    protocolHeader: buildHostDaemonWebSocketProtocols().join(","),
    resumeFrom: null,
    sessionId,
  });
  const events = createDaemonSocketEvents(harness.deps, target);
  const socket = mockRawSocket();
  events.onOpen(socket);
  return { events, reconnectGraceMs, sessionId, socket };
}

describe("detached daemon sessions", () => {
  it("ends a detached session as expired once the reconnect grace passes, without the liveness check ending it first", async () => {
    await withTestHarness(async (harness) => {
      setExperiments(harness.db, { resumeDaemonSessions: true });
      const daemon = await openMockDaemon(harness);
      expect(daemon.reconnectGraceMs).toBe(HOST_RECONNECT_GRACE_MS);
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
      const stopLiveness = startDaemonLivenessChecks(harness.deps);
      try {
        await vi.advanceTimersByTimeAsync(20_000);
        daemon.events.onClose(daemon.socket, "");
        await vi.advanceTimersByTimeAsync(HOST_RECONNECT_GRACE_MS - 1);
        expect(harness.hub.hasDaemonForHost(HOST_ID)).toBe(true);
        expect(
          getSessionById(harness.db, { sessionId: daemon.sessionId }),
        ).toMatchObject({ status: "active" });

        await vi.advanceTimersByTimeAsync(1);
        expect(harness.hub.hasDaemonForHost(HOST_ID)).toBe(false);
        expect(
          getSessionById(harness.db, { sessionId: daemon.sessionId }),
        ).toMatchObject({ status: "closed", closeReason: "expired" });
      } finally {
        stopLiveness();
      }
    });
  });

  it("ends the session at once and offers no reconnect grace while the resumeDaemonSessions experiment is off", async () => {
    await withTestHarness(async (harness) => {
      const daemon = await openMockDaemon(harness);
      expect(daemon.reconnectGraceMs).toBe(0);
      daemon.events.onClose(daemon.socket, "");
      expect(harness.hub.hasDaemonForHost(HOST_ID)).toBe(false);
      expect(
        getSessionById(harness.db, { sessionId: daemon.sessionId }),
      ).toMatchObject({ status: "closed", closeReason: "daemon-disconnect" });
    });
  });

  it("ends the session at once when the daemon closes for shutdown", async () => {
    await withTestHarness(async (harness) => {
      setExperiments(harness.db, { resumeDaemonSessions: true });
      const daemon = await openMockDaemon(harness);
      daemon.events.onClose(daemon.socket, "daemon-shutdown");
      expect(harness.hub.hasDaemonForHost(HOST_ID)).toBe(false);
      expect(
        getSessionById(harness.db, { sessionId: daemon.sessionId }),
      ).toMatchObject({ status: "closed", closeReason: "daemon-disconnect" });
    });
  });
});
