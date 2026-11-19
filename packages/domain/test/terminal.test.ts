import { describe, expect, it } from "vitest";
import {
  isActiveTerminalSessionStatus,
  type TerminalSessionStatus,
} from "../src/index.js";

interface TerminalSessionStatusExpectation {
  active: boolean;
  status: TerminalSessionStatus;
}

const TERMINAL_SESSION_STATUS_EXPECTATIONS: TerminalSessionStatusExpectation[] =
  [
    { active: true, status: "starting" },
    { active: true, status: "running" },
    { active: false, status: "disconnected" },
    { active: false, status: "exited" },
  ];

describe("terminal session status helpers", () => {
  it("treats only starting and running terminals as active", () => {
    for (const expectation of TERMINAL_SESSION_STATUS_EXPECTATIONS) {
      expect(isActiveTerminalSessionStatus(expectation.status)).toBe(
        expectation.active,
      );
    }
  });
});
