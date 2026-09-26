import { describe, expect, it } from "vitest";
import { pickActiveTerminalId } from "./useThreadTerminalController";
import { isVisibleTerminalSession } from "@/lib/terminal-session-visibility";
import { makeTerminalSession as terminalSession } from "@/test/fixtures/terminal-sessions";

describe("terminal visibility", () => {
  it("does not replace an exact plugin tab with a sibling session", () => {
    const sibling = terminalSession({ id: "term_sibling" });

    expect(
      pickActiveTerminalId([sibling], "term_missing", "term_missing"),
    ).toBeNull();
    expect(
      pickActiveTerminalId([sibling], "term_sibling", "term_sibling"),
    ).toBe("term_sibling");
  });

  it("keeps disconnected sessions visible so they can reattach, and hides exited ones", () => {
    expect(
      isVisibleTerminalSession(terminalSession({ status: "disconnected" })),
    ).toBe(true);
    expect(
      isVisibleTerminalSession(terminalSession({ status: "running" })),
    ).toBe(true);
    expect(
      isVisibleTerminalSession(terminalSession({ status: "exited" })),
    ).toBe(false);
  });
});
