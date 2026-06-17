import type { TerminalSession } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  isVisibleTerminalSession,
  shouldCloseDisconnectedTerminalSession,
} from "./useThreadTerminalController";

function terminalSession(
  overrides: Partial<TerminalSession>,
): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "Terminal",
    initialCwd: "/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

describe("terminal visibility", () => {
  it("shows disconnected sessions only while retaining a mounted terminal view", () => {
    const disconnected = terminalSession({
      id: "term_disconnected",
      status: "disconnected",
    });

    expect(
      isVisibleTerminalSession({
        retainedTerminalViewId: null,
        session: disconnected,
      }),
    ).toBe(false);
    expect(
      isVisibleTerminalSession({
        retainedTerminalViewId: "term_disconnected",
        session: disconnected,
      }),
    ).toBe(true);
    expect(
      isVisibleTerminalSession({
        retainedTerminalViewId: null,
        session: terminalSession({ status: "running" }),
      }),
    ).toBe(true);
  });

  it("cleans up only disconnected sessions without a retained terminal view", () => {
    const disconnected = terminalSession({
      id: "term_disconnected",
      status: "disconnected",
    });

    expect(
      shouldCloseDisconnectedTerminalSession({
        retainedTerminalViewId: null,
        session: disconnected,
      }),
    ).toBe(true);
    expect(
      shouldCloseDisconnectedTerminalSession({
        retainedTerminalViewId: "term_disconnected",
        session: disconnected,
      }),
    ).toBe(false);
    expect(
      shouldCloseDisconnectedTerminalSession({
        retainedTerminalViewId: null,
        session: terminalSession({ status: "running" }),
      }),
    ).toBe(false);
  });
});
