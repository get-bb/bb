import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TerminalOutputFlowControl,
  type TerminalOutputFlowDaemonMessage,
} from "../../src/services/terminals/terminal-output-flow-control.js";

interface SentDaemonMessage {
  daemonSessionId: string;
  message: TerminalOutputFlowDaemonMessage;
}

function createFlowControl(): {
  flow: TerminalOutputFlowControl;
  sent: SentDaemonMessage[];
} {
  const sent: SentDaemonMessage[] = [];
  const flow = new TerminalOutputFlowControl({
    now: () => Date.now(),
    sendDaemonMessage: (daemonSessionId, message) => {
      sent.push({ daemonSessionId, message });
    },
    stallMs: 1_000,
  });
  return { flow, sent };
}

function attachClient(
  flow: TerminalOutputFlowControl,
  client: object,
  visible: boolean,
): void {
  flow.subscribe("term-1", client, "session-1");
  flow.setClientState("term-1", client, {
    acknowledgesOutput: true,
    nextSeq: 0,
    visible,
  });
}

describe("TerminalOutputFlowControl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the daemon for live output only while a client is subscribed", () => {
    const { flow, sent } = createFlowControl();
    const first = {};
    const second = {};

    flow.recordOutput("term-1", "session-1", 0);
    flow.subscribe("term-1", first, "session-1");
    flow.subscribe("term-1", second, "session-1");
    flow.removeClient("term-1", first);
    flow.removeClient("term-1", second);
    flow.recordOutput("term-1", "session-1", 1);

    expect(sent.map((entry) => entry.message)).toEqual([
      { type: "terminal.stream", terminalId: "term-1", enabled: true },
      { type: "terminal.stream", terminalId: "term-1", enabled: false },
    ]);
  });

  it("paces output by the fastest visible client", () => {
    const { flow, sent } = createFlowControl();
    const fast = {};
    const slow = {};
    attachClient(flow, fast, true);
    attachClient(flow, slow, true);
    attachClient(flow, {}, false);

    for (let seq = 0; seq < 10; seq += 1) {
      flow.recordOutput("term-1", "session-1", seq);
    }
    flow.acknowledge("term-1", slow, 4);
    flow.acknowledge("term-1", fast, 10);

    expect(sent.map((entry) => entry.message)).toEqual([
      { type: "terminal.stream", terminalId: "term-1", enabled: true },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 4 },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 10 },
    ]);
  });

  it("acknowledges received output itself while no visible client paces it", () => {
    const { flow, sent } = createFlowControl();
    const hidden = {};
    attachClient(flow, hidden, false);
    flow.subscribe("term-1", {}, "session-1");

    flow.recordOutput("term-1", "session-1", 0);
    flow.recordOutput("term-1", "session-1", 1);
    flow.setVisible("term-1", hidden, true);
    flow.recordOutput("term-1", "session-1", 2);
    flow.setVisible("term-1", hidden, false);

    expect(sent.map((entry) => entry.message)).toEqual([
      { type: "terminal.stream", terminalId: "term-1", enabled: true },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 1 },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 2 },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 3 },
    ]);
  });

  it("acknowledges output for a client that stops acknowledging and paces again once it catches up", () => {
    vi.useFakeTimers();
    const { flow, sent } = createFlowControl();
    const client = {};
    attachClient(flow, client, true);
    flow.recordOutput("term-1", "session-1", 0);
    flow.recordOutput("term-1", "session-1", 1);

    vi.advanceTimersByTime(999);
    expect(sent.map((entry) => entry.message)).toEqual([
      { type: "terminal.stream", terminalId: "term-1", enabled: true },
    ]);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)?.message).toEqual({
      type: "terminal.ack",
      terminalId: "term-1",
      nextSeq: 2,
    });

    flow.acknowledge("term-1", client, 2);
    flow.recordOutput("term-1", "session-1", 2);
    flow.recordOutput("term-1", "session-1", 3);
    flow.acknowledge("term-1", client, 4);

    expect(sent.slice(2).map((entry) => entry.message)).toEqual([
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 4 },
    ]);
  });

  it("streams from a reconnected daemon session and ignores output from the old one", () => {
    const { flow, sent } = createFlowControl();
    flow.subscribe("term-1", {}, null);

    flow.bindDaemonSession("term-1", "session-1");
    flow.bindDaemonSession("term-1", "session-2");
    flow.recordOutput("term-1", "session-1", 0);
    flow.recordOutput("term-1", "session-2", 1);

    expect(sent).toEqual([
      {
        daemonSessionId: "session-1",
        message: {
          type: "terminal.stream",
          terminalId: "term-1",
          enabled: true,
        },
      },
      {
        daemonSessionId: "session-2",
        message: {
          type: "terminal.stream",
          terminalId: "term-1",
          enabled: true,
        },
      },
      {
        daemonSessionId: "session-2",
        message: { type: "terminal.ack", terminalId: "term-1", nextSeq: 2 },
      },
    ]);
  });
});
