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

describe("TerminalOutputFlowControl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("paces output by the fastest visible client", () => {
    const { flow, sent } = createFlowControl();
    const fast = {};
    const slow = {};
    flow.addClient("term-1", fast, 0, true);
    flow.addClient("term-1", slow, 0, true);
    flow.addClient("term-1", {}, 0, false);

    for (let seq = 0; seq < 10; seq += 1) {
      flow.recordOutput("term-1", "session-1", seq);
    }
    flow.acknowledge("term-1", slow, 4);
    flow.acknowledge("term-1", fast, 10);
    flow.setVisible("term-1", fast, false);
    flow.setVisible("term-1", slow, false);

    expect(sent.map((entry) => entry.message)).toEqual([
      { type: "terminal.flow-control", terminalId: "term-1", enabled: true },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 4 },
      { type: "terminal.ack", terminalId: "term-1", nextSeq: 10 },
      { type: "terminal.flow-control", terminalId: "term-1", enabled: false },
    ]);
  });

  it("leaves output unpaced while every client is hidden", () => {
    const { flow, sent } = createFlowControl();
    flow.addClient("term-1", {}, 0, false);

    flow.recordOutput("term-1", "session-1", 0);

    expect(sent).toEqual([]);
  });

  it("stops pacing for a client that stops acknowledging and resumes once it catches up", () => {
    vi.useFakeTimers();
    const { flow, sent } = createFlowControl();
    const client = {};
    flow.addClient("term-1", client, 0, true);
    flow.recordOutput("term-1", "session-1", 0);
    flow.recordOutput("term-1", "session-1", 1);

    vi.advanceTimersByTime(999);
    expect(sent.map((entry) => entry.message)).toEqual([
      { type: "terminal.flow-control", terminalId: "term-1", enabled: true },
    ]);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)?.message).toEqual({
      type: "terminal.flow-control",
      terminalId: "term-1",
      enabled: false,
    });

    flow.recordOutput("term-1", "session-1", 2);
    flow.acknowledge("term-1", client, 3);
    flow.recordOutput("term-1", "session-1", 3);

    expect(sent.at(-1)?.message).toEqual({
      type: "terminal.flow-control",
      terminalId: "term-1",
      enabled: true,
    });
  });

  it("re-enables pacing on the daemon session that delivers output after a reconnect", () => {
    const { flow, sent } = createFlowControl();
    flow.addClient("term-1", {}, 0, true);

    flow.recordOutput("term-1", "session-1", 0);
    flow.recordOutput("term-1", "session-2", 1);

    expect(sent).toEqual([
      {
        daemonSessionId: "session-1",
        message: {
          type: "terminal.flow-control",
          terminalId: "term-1",
          enabled: true,
        },
      },
      {
        daemonSessionId: "session-2",
        message: {
          type: "terminal.flow-control",
          terminalId: "term-1",
          enabled: true,
        },
      },
    ]);
  });
});
