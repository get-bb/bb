import { describe, expect, it } from "vitest";
import {
  mainToTerminalRelayMessageSchema,
  terminalRelayToMainMessageSchema,
} from "../../src/terminal-relay/terminal-relay-ipc.js";

const session = {
  id: "terminal-1",
  threadId: null,
  environmentId: null,
  hostId: "host-1",
  title: "Shell",
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

describe("terminal relay IPC boundary", () => {
  it("preserves socket grants, attach decisions, and terminal snapshots across JSON IPC", () => {
    const messages = [
      {
        type: "accept-browser",
        grant: {
          kind: "browser",
          terminalId: session.id,
          sinceSeq: 3,
          outputAcks: true,
        },
        head: "AQID",
        headers: { origin: "http://localhost" },
        method: "GET",
        url: "/ws/terminals/terminal-1?sinceSeq=3",
      },
      {
        type: "attach-decision",
        socketId: "socket-1",
        decision: "running",
        session,
      },
      {
        type: "terminal-state",
        terminalId: session.id,
        state: {
          daemonSessionId: "daemon-1",
          hostId: session.hostId,
          session,
          status: "running",
        },
      },
      {
        type: "send-daemon-data",
        daemonSessionId: "daemon-1",
        message: {
          type: "terminal.input",
          terminalId: session.id,
          dataBase64: "YQ==",
        },
      },
    ];
    for (const message of messages) {
      expect(
        mainToTerminalRelayMessageSchema.parse(
          JSON.parse(JSON.stringify(message)),
        ),
      ).toEqual(message);
    }
    const reply = {
      type: "replay",
      daemonSessionId: "daemon-1",
      terminalId: session.id,
      requestId: "request-1",
      chunks: [{ seq: 3, dataBase64: "YQ==" }],
      replayStartSeq: 3,
      nextSeq: 4,
    };
    expect(
      terminalRelayToMainMessageSchema.parse(JSON.parse(JSON.stringify(reply))),
    ).toEqual(reply);
  });

  it("rejects unknown message types and fields at both process boundaries", () => {
    expect(
      mainToTerminalRelayMessageSchema.safeParse({
        type: "send-daemon-data",
        daemonSessionId: "daemon-1",
        message: { type: "terminal.close", terminalId: session.id },
      }).success,
    ).toBe(false);
    expect(
      mainToTerminalRelayMessageSchema.safeParse({
        type: "shutdown",
        surprise: true,
      }).success,
    ).toBe(false);
    expect(
      terminalRelayToMainMessageSchema.safeParse({
        type: "ready",
        pid: 1,
        token: "secret",
      }).success,
    ).toBe(false);
    expect(
      terminalRelayToMainMessageSchema.safeParse({ type: "terminal.output" })
        .success,
    ).toBe(false);
  });
});
