import { describe, expect, it } from "vitest";
import { permissionDisplayForPromptMode } from "./effective-prompt-mode";

describe("permissionDisplayForPromptMode", () => {
  it("shows plan mode for a Claude Code plan command pill", () => {
    expect(
      permissionDisplayForPromptMode({
        providerId: "claude-code",
        value: "/plan inspect the failing test",
        mentionRanges: [
          {
            start: 0,
            end: 5,
            resource: {
              kind: "command",
              trigger: "/",
              name: "plan",
              source: "command",
              origin: "user",
              label: "plan",
              argumentHint: null,
            },
          },
        ],
      }),
    ).toMatchObject({ label: "Plan Mode", compactLabel: "Plan" });
  });

  it("does not show plan mode for plain text or other providers", () => {
    expect(
      permissionDisplayForPromptMode({
        providerId: "claude-code",
        value: "/plan inspect the failing test",
        mentionRanges: [],
      }),
    ).toBeUndefined();
    expect(
      permissionDisplayForPromptMode({
        providerId: "codex",
        value: "/plan inspect the failing test",
        mentionRanges: [
          {
            start: 0,
            end: 5,
            resource: {
              kind: "command",
              trigger: "/",
              name: "plan",
              source: "command",
              origin: "user",
              label: "plan",
              argumentHint: null,
            },
          },
        ],
      }),
    ).toBeUndefined();
  });
});
