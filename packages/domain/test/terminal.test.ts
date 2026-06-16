import { describe, expect, it } from "vitest";
import {
  createTerminalOutputLineReader,
  isActiveTerminalSessionStatus,
  isVisibleTerminalSessionStatus,
  readTerminalOutputLines,
  type TerminalSessionStatus,
} from "../src/index.js";

interface TerminalSessionStatusExpectation {
  active: boolean;
  status: TerminalSessionStatus;
  visible: boolean;
}

const TERMINAL_SESSION_STATUS_EXPECTATIONS: TerminalSessionStatusExpectation[] =
  [
    { active: true, status: "starting", visible: true },
    { active: true, status: "running", visible: true },
    { active: false, status: "disconnected", visible: true },
    { active: false, status: "exited", visible: false },
  ];

describe("terminal session status helpers", () => {
  it("treats only starting and running terminals as active", () => {
    for (const expectation of TERMINAL_SESSION_STATUS_EXPECTATIONS) {
      expect(isActiveTerminalSessionStatus(expectation.status)).toBe(
        expectation.active,
      );
    }
  });

  it("keeps disconnected terminals visible without counting them as active", () => {
    for (const expectation of TERMINAL_SESSION_STATUS_EXPECTATIONS) {
      expect(isVisibleTerminalSessionStatus(expectation.status)).toBe(
        expectation.visible,
      );
    }
  });
});

describe("terminal output line helpers", () => {
  it("compacts carriage-return progress updates to the final display line", () => {
    expect(
      readTerminalOutputLines(
        [
          "Preparing worktree\n",
          "Updating files:  44% (1017/2287)\r",
          "Updating files:  45% (1030/2287)\r",
          "Updating files: 100% (2287/2287), done.\n",
        ].join(""),
      ),
    ).toEqual([
      "Preparing worktree",
      "Updating files: 100% (2287/2287), done.",
    ]);
  });

  it("preserves regular CRLF line breaks", () => {
    expect(readTerminalOutputLines("first\r\nsecond\r\n")).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps partial lines buffered until complete or flushed", () => {
    const reader = createTerminalOutputLineReader();

    expect(reader.push("fir")).toEqual([]);
    expect(reader.push("st\nprogress 1\r")).toEqual(["first"]);
    expect(reader.push("progress done")).toEqual([]);
    expect(reader.flush()).toEqual(["progress done"]);
  });

  it("handles CRLF split across chunks", () => {
    const reader = createTerminalOutputLineReader();

    expect(reader.push("first\r")).toEqual([]);
    expect(reader.push("\nsecond\r")).toEqual(["first"]);
    expect(reader.push("\n")).toEqual(["second"]);
  });
});
