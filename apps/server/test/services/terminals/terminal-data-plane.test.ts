import { describe, expect, it, vi } from "vitest";
import type { HostDaemonTerminalDataServerMessage } from "@bb/host-daemon-contract";
import type { TerminalSession } from "@bb/server-contract";
import { InProcessTerminalDataPlane } from "../../../src/services/terminals/terminal-data-plane.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";

const session: TerminalSession = {
  id: "term-1",
  threadId: null,
  environmentId: null,
  hostId: "host-1",
  title: "Terminal",
  initialCwd: "/tmp",
  cols: 80,
  rows: 24,
  status: "running",
  exitCode: null,
  closeReason: null,
  createdAt: 0,
  updatedAt: 0,
  lastUserInputAt: null,
};

function setup() {
  const host = {
    sendDaemonDataMessage: vi.fn(
      (
        _daemonSessionId: string,
        _message: HostDaemonTerminalDataServerMessage,
      ) => true,
    ),
    onBrowserInput: vi.fn(),
    onBrowserResize: vi.fn(),
    onTerminalExited: vi.fn(),
    onAttachError: vi.fn(),
    onReplay: vi.fn(),
    onDaemonSendFailed: vi.fn(),
  };
  const plane = new InProcessTerminalDataPlane(host);
  plane.setTerminalState(session.id, {
    daemonSessionId: "daemon-1",
    hostId: session.hostId,
    session,
    status: session.status,
  });
  return { host, plane };
}

function messages(socket: { messages: string[] }) {
  return socket.messages.map((message) => JSON.parse(message));
}

describe("InProcessTerminalDataPlane", () => {
  it("attaches with the requested replay boundary and delivers replay before live output", () => {
    const { host, plane } = setup();
    const socket = createMockHubSocket();
    plane.attachBrowserClient({
      terminalId: session.id,
      socket,
      sinceSeq: 4,
      outputAcks: false,
    });
    const attach = host.sendDaemonDataMessage.mock.calls[0]?.[1];
    expect(attach).toMatchObject({
      type: "terminal.attach",
      terminalId: session.id,
      sinceSeq: 4,
      tailBytes: 512 * 1024,
    });
    if (!attach || attach.type !== "terminal.attach")
      throw new Error("Missing attach request");
    plane.handleDaemonDataMessage({
      daemonSessionId: "daemon-1",
      message: {
        type: "terminal.replay",
        terminalId: session.id,
        requestId: attach.requestId,
        replayStartSeq: 4,
        nextSeq: 6,
        chunks: [
          { seq: 4, dataBase64: "YQ==" },
          { seq: 5, dataBase64: "Yg==" },
        ],
      },
    });
    plane.handleDaemonDataMessage({
      daemonSessionId: "daemon-1",
      message: {
        type: "terminal.output",
        terminalId: session.id,
        chunk: { seq: 6, dataBase64: "Yw==" },
      },
    });
    expect(
      messages(socket).map((message) =>
        message.type === "output" ? message.chunk.seq : message.type,
      ),
    ).toEqual(["attached", 4, 5, 6]);
    plane.detachBrowserClient(socket, session.id);
  });

  it("drops duplicate, catch-up, stale-daemon, and non-running output", () => {
    const { host, plane } = setup();
    const socket = createMockHubSocket();
    plane.holdForReattach(session.id, session, socket, 5);
    const send = (daemonSessionId: string, seq: number) =>
      plane.handleDaemonDataMessage({
        daemonSessionId,
        message: {
          type: "terminal.output",
          terminalId: session.id,
          chunk: { seq, dataBase64: "YQ==" },
        },
      });
    send("daemon-1", 4);
    send("daemon-old", 5);
    send("daemon-1", 5);
    plane.requestCatchUp({
      daemonSessionId: "daemon-1",
      terminalId: session.id,
    });
    send("daemon-1", 6);
    const attach = host.sendDaemonDataMessage.mock.calls[0]?.[1];
    if (!attach || attach.type !== "terminal.attach")
      throw new Error("Missing catch-up request");
    plane.handleDaemonDataMessage({
      daemonSessionId: "daemon-1",
      message: {
        type: "terminal.replay",
        terminalId: session.id,
        requestId: attach.requestId,
        replayStartSeq: 6,
        nextSeq: 7,
        chunks: [{ seq: 6, dataBase64: "Yg==" }],
      },
    });
    plane.setTerminalState(session.id, {
      daemonSessionId: "daemon-1",
      hostId: session.hostId,
      session: { ...session, status: "disconnected" },
      status: "disconnected",
    });
    send("daemon-1", 7);
    expect(
      messages(socket)
        .filter((message) => message.type === "output")
        .map((message) => message.chunk.seq),
    ).toEqual([5, 6]);
    plane.detachBrowserClient(socket, session.id);
  });

  it("transfers resize ownership when the latest client detaches", () => {
    const { host, plane } = setup();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    plane.attachBrowserClient({
      terminalId: session.id,
      socket: first,
      sinceSeq: 0,
      outputAcks: false,
    });
    plane.attachBrowserClient({
      terminalId: session.id,
      socket: second,
      sinceSeq: 0,
      outputAcks: false,
    });
    for (const call of host.sendDaemonDataMessage.mock.calls) {
      const attach = call[1];
      if (attach.type !== "terminal.attach")
        throw new Error("Missing attach request");
      plane.handleDaemonDataMessage({
        daemonSessionId: "daemon-1",
        message: {
          type: "terminal.replay",
          terminalId: session.id,
          requestId: attach.requestId,
          replayStartSeq: 0,
          nextSeq: 0,
          chunks: [],
        },
      });
    }
    plane.handleBrowserMessage({
      terminalId: session.id,
      socket: first,
      message: { type: "resize", cols: 90, rows: 30 },
    });
    expect(host.onBrowserResize).not.toHaveBeenCalled();
    plane.detachBrowserClient(second, session.id);
    plane.handleBrowserMessage({
      terminalId: session.id,
      socket: first,
      message: { type: "resize", cols: 90, rows: 30 },
    });
    expect(host.onBrowserResize).toHaveBeenCalledWith({
      terminalId: session.id,
      socket: first,
      cols: 90,
      rows: 30,
    });
    plane.detachBrowserClient(first, session.id);
  });

  it("forwards unmatched daemon errors and broadcasts exit before host persistence", () => {
    const { host, plane } = setup();
    const socket = createMockHubSocket();
    plane.holdForReattach(session.id, session, socket, 0);
    plane.handleDaemonDataMessage({
      daemonSessionId: "daemon-1",
      message: {
        type: "terminal.error",
        terminalId: session.id,
        requestId: "rest-1",
        code: "failure",
        message: "lost",
      },
    });
    expect(host.onAttachError).toHaveBeenCalledWith({
      daemonSessionId: "daemon-1",
      terminalId: session.id,
      requestId: "rest-1",
      code: "failure",
      message: "lost",
    });
    host.onTerminalExited.mockImplementation(() => {
      expect(messages(socket).at(-1)).toMatchObject({
        type: "exited",
        session: { status: "exited", exitCode: 0 },
      });
    });
    plane.handleDaemonDataMessage({
      daemonSessionId: "daemon-1",
      message: {
        type: "terminal.exited",
        terminalId: session.id,
        closeReason: "process-exit",
        exitCode: 0,
      },
    });
    expect(host.onTerminalExited).toHaveBeenCalledTimes(1);
    plane.detachBrowserClient(socket, session.id);
  });
});
