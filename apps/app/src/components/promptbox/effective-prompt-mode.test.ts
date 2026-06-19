import { describe, expect, it } from "vitest";
import {
  permissionDisplayForActivePromptMode,
  permissionDisplayForPromptMode,
  shouldDisablePermissionPickerForActivePromptMode,
  shouldDisablePermissionPickerForPromptMode,
} from "./effective-prompt-mode";

const planCommandMention = {
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
} as const;

describe("permissionDisplayForPromptMode", () => {
  it("shows plan mode for a Claude Code plan command pill", () => {
    expect(
      permissionDisplayForPromptMode({
        providerId: "claude-code",
        value: "/plan inspect the failing test",
        mentionRanges: [planCommandMention],
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
        mentionRanges: [planCommandMention],
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

describe("shouldDisablePermissionPickerForPromptMode", () => {
  it("locks permissions for a Claude Code plan command pill", () => {
    expect(
      shouldDisablePermissionPickerForPromptMode({
        providerId: "claude-code",
        value: "/plan inspect the failing test",
        mentionRanges: [planCommandMention],
      }),
    ).toBe(true);
  });

  it("does not lock permissions for plain text or other providers before submit", () => {
    expect(
      shouldDisablePermissionPickerForPromptMode({
        providerId: "claude-code",
        value: "/plan inspect the failing test",
        mentionRanges: [],
      }),
    ).toBe(false);
    expect(
      shouldDisablePermissionPickerForPromptMode({
        providerId: "codex",
        value: "/plan inspect the failing test",
        mentionRanges: [planCommandMention],
      }),
    ).toBe(false);
  });
});

describe("shouldDisablePermissionPickerForActivePromptMode", () => {
  it("locks permissions for active plan mode across providers", () => {
    expect(
      shouldDisablePermissionPickerForActivePromptMode({
        mode: "plan",
        providerId: "claude-code",
        prompt: "inspect the failing test",
      }),
    ).toBe(true);
    expect(
      shouldDisablePermissionPickerForActivePromptMode({
        mode: "plan",
        providerId: "codex",
        prompt: "inspect the failing test",
      }),
    ).toBe(true);
  });

  it("does not lock permissions without an active prompt mode", () => {
    expect(shouldDisablePermissionPickerForActivePromptMode(null)).toBe(false);
  });
});
