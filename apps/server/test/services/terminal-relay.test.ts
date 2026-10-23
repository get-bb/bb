import { Buffer } from "node:buffer";
import {
  hostDaemonTerminalDataServerMessageSchema,
  type HostDaemonTerminalDataServerMessage,
} from "@bb/host-daemon-contract";
import type { TerminalServerMessage } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TerminalRelay,
  type TerminalRelaySocket,
  type TerminalRelayTerminal,
  type TerminalUpgradeGrant,
} from "../../src/services/terminals/terminal-relay.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

const DAEMON_SESSION_ID = "daemon-1";
const TERMINAL_ID = "term-1";

function runningTerminal(): TerminalRelayTerminal {
  return {
    daemonSessionId: DAEMON_SESSION_ID,
    session: {
      id: TERMINAL_ID,
      threadId: null,
      environmentId: null,
      hostId: "host-1",
      title: "Terminal 1",
      initialCwd: "/tmp",
      cols: 80,
      rows: 24,
      status: "running",
      exitCode: null,
      closeReason: null,
      createdAt: 0,
      updatedAt: 0,
      lastUserInputAt: null,
    },
  };
}

function browserGrant(): TerminalUpgradeGrant {
  return {
    kind: "browser",
    outputAcks: false,
    sinceSeq: 0,
    terminal: runningTerminal(),
    terminalId: TERMINAL_ID,
  };
}

function createRelayFixture() {
  const relay = new TerminalRelay();
  const controlMessages: HostDaemonTerminalDataServerMessage[] = [];
  const recordedInputs: string[] = [];
  const recordedExits: string[] = [];
  const warnings: { message: string; fields: object }[] = [];
  relay.bindHost({
    warn: (message, fields) => warnings.push({ message, fields }),
    recordExit: ({ message }) => recordedExits.push(message.terminalId),
    recordInput: ({ terminalId }) => recordedInputs.push(terminalId),
    recordResize: () => undefined,
    sendDaemonControlMessage: ({ message }) => controlMessages.push(message),
  });
  const attach = (socket: TerminalRelaySocket): void => {
    relay.open(browserGrant(), socket);
    const attachMessage = controlMessages.at(-1);
    if (attachMessage?.type !== "terminal.attach") {
      throw new Error("Expected terminal.attach");
    }
    relay.handleDaemonControlMessage({
      daemonSessionId: DAEMON_SESSION_ID,
      message: {
        type: "terminal.replay",
        requestId: attachMessage.requestId,
        terminalId: TERMINAL_ID,
        chunks: [],
        replayStartSeq: 0,
        nextSeq: 0,
      },
    });
  };
  const output = (seq: number, dataBase64 = "YQ=="): void => {
    relay.handleDaemonControlMessage({
      daemonSessionId: DAEMON_SESSION_ID,
      message: {
        type: "terminal.output",
        terminalId: TERMINAL_ID,
        chunk: { seq, dataBase64 },
      },
    });
  };
  const resize = (socket: TerminalRelaySocket, cols: number): void => {
    relay.message(
      browserGrant(),
      socket,
      JSON.stringify({ type: "resize", cols, rows: 24 }),
    );
  };
  return {
    attach,
    controlMessages,
    output,
    recordedExits,
    recordedInputs,
    relay,
    resize,
    warnings,
  };
}

function outputSeqs(messages: string[]): number[] {
  return messages.flatMap((raw) => {
    const message: TerminalServerMessage = JSON.parse(raw);
    return message.type === "output" ? [message.chunk.seq] : [];
  });
}

describe("TerminalRelay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends keystrokes over the daemon data socket without asking the main process to route them", () => {
    const fixture = createRelayFixture();
    const dataSocket = createMockHubSocket();
    fixture.relay.open(
      { kind: "daemon", daemonSessionId: DAEMON_SESSION_ID },
      dataSocket,
    );
    const browser = createMockHubSocket();
    fixture.relay.open(browserGrant(), browser);

    fixture.relay.message(
      browserGrant(),
      browser,
      JSON.stringify({ type: "input", dataBase64: "bHM=" }),
    );

    const sentToDaemon = dataSocket.messages.map((raw) =>
      hostDaemonTerminalDataServerMessageSchema.parse(JSON.parse(raw)),
    );
    expect(sentToDaemon.map((message) => message.type)).toEqual([
      "terminal.attach",
      "terminal.input",
    ]);
    expect(fixture.controlMessages).toEqual([]);
    expect(fixture.recordedInputs).toEqual([TERMINAL_ID]);
  });

  it("delivers a terminal's last output before handing its exit to the main process", () => {
    const fixture = createRelayFixture();
    const daemonGrant: TerminalUpgradeGrant = {
      kind: "daemon",
      daemonSessionId: DAEMON_SESSION_ID,
    };
    const dataSocket = createMockHubSocket();
    fixture.relay.open(daemonGrant, dataSocket);
    const browser = createMockHubSocket();
    fixture.relay.open(browserGrant(), browser);
    const attach = hostDaemonTerminalDataServerMessageSchema.parse(
      JSON.parse(dataSocket.messages[0] ?? "null"),
    );
    if (attach.type !== "terminal.attach") {
      throw new Error("Expected terminal.attach");
    }
    const fromDaemon = (message: object): void => {
      fixture.relay.message(daemonGrant, dataSocket, JSON.stringify(message));
    };
    fromDaemon({
      type: "terminal.replay",
      requestId: attach.requestId,
      terminalId: TERMINAL_ID,
      chunks: [],
      replayStartSeq: 0,
      nextSeq: 0,
    });

    fromDaemon({
      type: "terminal.output",
      terminalId: TERMINAL_ID,
      chunk: { seq: 0, dataBase64: "YQ==" },
    });
    fromDaemon({
      type: "terminal.exited",
      terminalId: TERMINAL_ID,
      exitCode: 1,
      closeReason: "process-exit",
    });
    expect(outputSeqs(browser.messages)).toEqual([0]);
    expect(fixture.recordedExits).toEqual([TERMINAL_ID]);
    expect(JSON.parse(dataSocket.messages.at(-1) ?? "null")).toEqual({
      type: "terminal.exited.ack",
      terminalId: TERMINAL_ID,
    });

    const exited = runningTerminal();
    fixture.relay.publishSession({
      kind: "exited",
      terminal: { ...exited, session: { ...exited.session, status: "exited" } },
    });
    const types = browser.messages.map(
      (raw) => (JSON.parse(raw) as TerminalServerMessage).type,
    );
    expect(types.slice(-2)).toEqual(["output", "exited"]);
  });

  it("stops forwarding output to a browser after its socket closes", () => {
    const fixture = createRelayFixture();
    const browser = createMockHubSocket();
    fixture.attach(browser);

    fixture.output(0);
    fixture.relay.close(browserGrant(), browser);
    fixture.output(1);

    expect(outputSeqs(browser.messages)).toEqual([0]);
  });

  it("gives resize ownership to the newest browser and returns it when that browser leaves", () => {
    const fixture = createRelayFixture();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    fixture.attach(first);
    fixture.attach(second);
    const resizes = () =>
      fixture.controlMessages.flatMap((message) =>
        message.type === "terminal.resize" ? [message.cols] : [],
      );

    fixture.resize(first, 100);
    fixture.resize(second, 110);
    fixture.relay.close(browserGrant(), second);
    fixture.resize(first, 120);

    expect(resizes()).toEqual([110, 120]);
  });

  it("queues output while a browser socket is above high water", () => {
    vi.useFakeTimers();
    const fixture = createRelayFixture();
    const browser = {
      ...createMockHubSocket(),
      raw: { bufferedAmount: 0 },
    };
    fixture.attach(browser);
    browser.raw.bufferedAmount = 2 * 1024 * 1024;

    fixture.output(0);
    fixture.output(1);
    expect(outputSeqs(browser.messages)).toEqual([]);

    browser.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(10);
    expect(outputSeqs(browser.messages)).toEqual([0, 1]);
  });

  it("isolates a throwing browser socket from healthy ones", () => {
    const fixture = createRelayFixture();
    const healthy = createMockHubSocket();
    const closed: Array<{ code?: number; reason?: string }> = [];
    let failing = false;
    const flaky = {
      close(code?: number, reason?: string) {
        closed.push({ code, reason });
      },
      send() {
        if (failing) {
          throw new Error("socket send failed");
        }
      },
    };
    fixture.attach(flaky);
    fixture.attach(healthy);
    failing = true;

    expect(() => fixture.output(0)).not.toThrow();
    fixture.output(1);

    expect(closed).toEqual([{ code: 1013, reason: "terminal-send-failed" }]);
    expect(outputSeqs(healthy.messages)).toEqual([0, 1]);
  });

  it("closes a browser whose bounded output queue overflows", () => {
    vi.useFakeTimers();
    const fixture = createRelayFixture();
    const browser = {
      ...createMockHubSocket(),
      raw: { bufferedAmount: 0 },
    };
    fixture.attach(browser);
    browser.raw.bufferedAmount = 2 * 1024 * 1024;
    const dataBase64 = Buffer.alloc(64 * 1024).toString("base64");

    for (let seq = 0; seq < 512; seq += 1) {
      fixture.output(seq, dataBase64);
    }

    expect(browser.closed).toContainEqual({
      code: 1013,
      reason: "terminal-backpressure",
    });
    expect(outputSeqs(browser.messages)).toEqual([]);
    expect(fixture.warnings).toContainEqual({
      message: "Closed terminal browser socket",
      fields: { reason: "terminal-backpressure", terminalId: TERMINAL_ID },
    });
  });
});
