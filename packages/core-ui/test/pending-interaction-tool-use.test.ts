import type { PendingInteraction } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  describePendingInteractionToolUse,
  formatPendingInteractionSubjectDetailLines,
  formatPendingInteractionSummary,
} from "../src/index.js";

function toolUseInteraction(args: {
  reason: string | null;
  title?: string;
  detail?: string;
  tint?: { light: string; dark: string };
}): PendingInteraction {
  return {
    id: "pint_tool",
    threadId: "thr_1",
    turnId: "turn_1",
    providerId: "acp",
    providerThreadId: "pt_1",
    providerRequestId: "req_1",
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    resolution: null,
    payload: {
      kind: "approval",
      reason: args.reason,
      availableDecisions: ["allow_once", "deny"],
      subject: {
        kind: "tool_use",
        itemId: "call_1",
        tool: "mcp__github__create_issue",
        presentation: {
          label: { pending: "Creating issue", completed: "Created issue" },
          icon: { glyph: "Globe" },
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.detail === undefined ? {} : { detail: args.detail }),
          ...(args.tint === undefined ? {} : { tint: args.tint }),
        },
      },
    },
  };
}

describe("describePendingInteractionToolUse", () => {
  it("reads the whole ask from the presentation, preferring the bridge's reason as the heading", () => {
    const interaction = toolUseInteraction({
      reason: "Not in allowlist: github",
      title: "get-bb/bb#42",
      detail: "Opens a **bug** issue",
      tint: { light: "#123456", dark: "#abcdef" },
    });
    if (interaction.payload.kind !== "approval") throw new Error("unexpected");
    if (interaction.payload.subject.kind !== "tool_use") {
      throw new Error("unexpected");
    }
    expect(
      describePendingInteractionToolUse({
        ...interaction.payload,
        subject: interaction.payload.subject,
      }),
    ).toEqual({
      title: "Not in allowlist: github",
      tool: "mcp__github__create_issue",
      headline: "get-bb/bb#42",
      detail: "Opens a **bug** issue",
      icon: { glyph: "Globe" },
      tint: { light: "#123456", dark: "#abcdef" },
    });
  });

  it("falls back to the present-tense label and omits the optional lines", () => {
    const interaction = toolUseInteraction({ reason: null });
    expect(
      formatPendingInteractionSummary({ interaction, surface: "cli" }),
    ).toBe("Creating issue");
    expect(formatPendingInteractionSubjectDetailLines(interaction)).toEqual([
      "Tool: mcp__github__create_issue",
    ]);
  });

  it("treats an empty headline or detail as absent, as the rows do", () => {
    const interaction = toolUseInteraction({
      reason: null,
      title: "",
      detail: "  ",
    });
    expect(formatPendingInteractionSubjectDetailLines(interaction)).toEqual([
      "Tool: mcp__github__create_issue",
    ]);
  });

  it("prints the headline and detail under the tool name on text surfaces", () => {
    const interaction = toolUseInteraction({
      reason: null,
      title: "get-bb/bb#42",
      detail: "Opens a bug issue",
    });
    expect(formatPendingInteractionSubjectDetailLines(interaction)).toEqual([
      "Tool: mcp__github__create_issue",
      "get-bb/bb#42",
      "Opens a bug issue",
    ]);
  });
});
