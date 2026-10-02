import { describe, expect, it } from "vitest";
import { pickActiveTerminalId } from "./useThreadTerminalController";
import { makeTerminalSession as terminalSession } from "@/test/fixtures/terminal-sessions";

describe("pickActiveTerminalId", () => {
  it("does not replace an exact plugin tab with a sibling session", () => {
    const sibling = terminalSession({ id: "term_sibling" });

    expect(
      pickActiveTerminalId([sibling], "term_missing", "term_missing"),
    ).toBeNull();
    expect(
      pickActiveTerminalId([sibling], "term_sibling", "term_sibling"),
    ).toBe("term_sibling");
  });
});
