import { describe, expect, it } from "vitest";
import {
  permissionDisplayForActivePromptMode,
  permissionDisplayForPromptMode,
} from "./effective-prompt-mode";

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

describe("permissionDisplayForActivePromptMode", () => {
  it("shows Plan Mode while Claude Code is actively planning", () => {
    expect(
      permissionDisplayForActivePromptMode({
        mode: "plan",
        providerId: "claude-code",
        prompt: "inspect the failing test",
      }),
    ).toMatchObject({ label: "Plan Mode", compactLabel: "Plan" });
  });

  it("does not relabel Codex plan mode as a permission mode", () => {
    expect(
      permissionDisplayForActivePromptMode({
        mode: "plan",
        providerId: "codex",
        prompt: "inspect the failing test",
      }),
    ).toBeUndefined();
  });
});
