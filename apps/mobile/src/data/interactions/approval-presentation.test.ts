import { buildPendingInteractionApprovalResolution } from "@bb/core-ui";
import { describe, expect, it } from "vitest";
import { approvalInteraction } from "../test/fixtures";
import {
  approvalResolutionDecision,
  describeApprovalSubject,
  labelForApprovalDecision,
} from "./approval-presentation";

describe("describeApprovalSubject", () => {
  it("shows the shell command without the Cwd/Command prefixes", () => {
    const interaction = approvalInteraction({
      id: "i1",
      subject: {
        kind: "command",
        itemId: "item",
        command: "echo hi",
        cwd: "/repo",
        actions: [{ type: "read", command: "cat", name: "x", path: "a.txt" }],
        sessionGrant: null,
      },
    });
    if (interaction.payload.kind !== "approval") throw new Error("unexpected");
    const subject = describeApprovalSubject(interaction, interaction.payload);
    expect(subject.title).toBe("Do you want to run this command?");
    expect(subject.command).toBe("echo hi");
    expect(subject.detailLines).toEqual(["/repo", "Action: Read a.txt"]);
  });

  it("keeps the plan markdown and file path for plan approvals", () => {
    const interaction = approvalInteraction({
      id: "i2",
      reason: "Plan ready",
      availableDecisions: ["allow_once", "deny"],
      subject: {
        kind: "plan",
        itemId: "item",
        plan: "# Plan\n- step",
        planFilePath: "/repo/plan.md",
      },
    });
    if (interaction.payload.kind !== "approval") throw new Error("unexpected");
    const subject = describeApprovalSubject(interaction, interaction.payload);
    expect(subject).toEqual({
      title: "Plan ready",
      command: null,
      plan: "# Plan\n- step",
      toolUse: null,
      detailLines: ["/repo/plan.md"],
    });
    expect(labelForApprovalDecision("allow_once", "plan")).toBe("Approve plan");
    expect(labelForApprovalDecision("deny", "plan")).toBe("Keep planning");
    expect(labelForApprovalDecision("allow_for_session", "command")).toBe(
      "Allow for session",
    );
  });
});

describe("describeApprovalSubject tool_use", () => {
  it("describes the ask from the presentation alone, with no detail lines", () => {
    const interaction = approvalInteraction({
      id: "i3",
      subject: {
        kind: "tool_use",
        itemId: "call_1",
        tool: "mcp__github__create_issue",
        presentation: {
          label: { pending: "Creating issue", completed: "Created issue" },
          icon: { glyph: "Globe" },
          title: "get-bb/bb#42",
          tint: { light: "#123456", dark: "#abcdef" },
        },
      },
    });
    if (interaction.payload.kind !== "approval") throw new Error("unexpected");
    const subject = describeApprovalSubject(interaction, interaction.payload);
    expect(subject).toEqual({
      title: "Creating issue",
      command: null,
      plan: null,
      toolUse: {
        title: "Creating issue",
        tool: "mcp__github__create_issue",
        headline: "get-bb/bb#42",
        detail: null,
        icon: { glyph: "Globe" },
        tint: { light: "#123456", dark: "#abcdef" },
      },
      detailLines: [],
    });
  });
});

describe("approval decision mapping", () => {
  it("carries the session grant only for allow_for_session", () => {
    const grant = { network: { enabled: true }, fileSystem: null };
    const interaction = approvalInteraction({
      id: "i3",
      subject: {
        kind: "command",
        itemId: "item",
        command: "npm test",
        cwd: null,
        actions: [],
        sessionGrant: grant,
      },
    });
    expect(
      buildPendingInteractionApprovalResolution(interaction, "allow_once"),
    ).toEqual({ decision: "allow_once", grantedPermissions: null });
    expect(
      buildPendingInteractionApprovalResolution(
        interaction,
        "allow_for_session",
      ),
    ).toEqual({ decision: "allow_for_session", grantedPermissions: grant });
    expect(
      buildPendingInteractionApprovalResolution(interaction, "deny"),
    ).toEqual({ decision: "deny" });
  });

  it("reads the submitted decision back off a resolving interaction", () => {
    expect(approvalResolutionDecision(null)).toBeNull();
    expect(
      approvalResolutionDecision({ kind: "user_answer", answers: {} }),
    ).toBeNull();
    expect(
      approvalResolutionDecision({
        decision: "allow_once",
        grantedPermissions: null,
      }),
    ).toBe("allow_once");
  });
});
