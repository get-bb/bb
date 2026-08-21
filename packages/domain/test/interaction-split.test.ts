import { describe, expect, it } from "vitest";
import {
  interactionRequestPayloadSchema,
  pendingInteractionPayloadSchema,
} from "../src/index.js";

const presentation = {
  label: { pending: "Creating issue", completed: "Created issue" },
  icon: { glyph: "Ticket" },
  title: "Linear: create issue",
};

/** An approval payload around one subject, parsed through the public union. */
function approvalOf(subject: Record<string, unknown>) {
  return pendingInteractionPayloadSchema.safeParse({
    kind: "approval",
    subject,
    reason: null,
    availableDecisions: ["allow_once", "deny"],
  });
}

describe("tool_use approval subject", () => {
  it("parses inside the existing approval payload", () => {
    const parsed = approvalOf({
      kind: "tool_use",
      itemId: "item_1",
      tool: "mcp__linear__create_issue",
      presentation,
    });
    expect(parsed.success).toBe(true);
    expect(
      parsed.data?.kind === "approval" ? parsed.data.subject.kind : undefined,
    ).toBe("tool_use");
  });

  it("requires the tool name and a complete presentation", () => {
    expect(
      approvalOf({ kind: "tool_use", itemId: "item_1", tool: "", presentation })
        .success,
    ).toBe(false);
    expect(
      approvalOf({ kind: "tool_use", itemId: "item_1", tool: "Read" }).success,
    ).toBe(false);
    expect(
      approvalOf({
        kind: "tool_use",
        itemId: "item_1",
        tool: "Read",
        presentation: { label: { pending: "Reading" }, icon: { glyph: "X" } },
      }).success,
    ).toBe(false);
  });
});

describe("interaction request payload family", () => {
  it("parses user questions, plan reviews, and namespaced plugin requests", () => {
    const question = interactionRequestPayloadSchema.parse({
      kind: "user_question",
      questions: [
        {
          id: "q1",
          prompt: "Which environment?",
          multiSelect: false,
          options: [{ value: "prod", label: "Production" }],
          allowFreeText: false,
        },
      ],
    });
    expect(question.kind).toBe("user_question");

    const planReview = interactionRequestPayloadSchema.parse({
      kind: "plan_review",
      itemId: "item_1",
      plan: "# Plan\n\n1. Do it",
      planFilePath: null,
    });
    expect(planReview.kind).toBe("plan_review");

    const plugin = interactionRequestPayloadSchema.parse({
      kind: "linear/pick-project",
      title: "Pick a project",
      data: { projects: ["a", "b"] },
    });
    expect(plugin.kind).toBe("linear/pick-project");
  });

  it("rejects malformed plugin namespaces and unknown core kinds", () => {
    for (const kind of [
      "pick-project",
      "Linear/pick-project",
      "linear/",
      "/pick",
      "linear/pick/project",
      "linear/Pick",
      "plan",
      "approval",
    ]) {
      expect(
        interactionRequestPayloadSchema.safeParse({
          kind,
          title: "Pick a project",
          data: {},
        }).success,
        `expected kind ${JSON.stringify(kind)} to be rejected`,
      ).toBe(false);
    }
    // A plan review needs a non-empty plan body.
    expect(
      interactionRequestPayloadSchema.safeParse({
        kind: "plan_review",
        itemId: "item_1",
        plan: "",
        planFilePath: null,
      }).success,
    ).toBe(false);
    // Plugin request data must be JSON.
    expect(
      interactionRequestPayloadSchema.safeParse({
        kind: "linear/pick-project",
        title: "Pick",
        data: { when: new Date() },
      }).success,
    ).toBe(false);
  });

  it("leaves the legacy payload union without the new request kinds", () => {
    expect(
      pendingInteractionPayloadSchema.safeParse({
        kind: "plan_review",
        itemId: "item_1",
        plan: "# Plan",
        planFilePath: null,
      }).success,
    ).toBe(false);
    expect(
      pendingInteractionPayloadSchema.safeParse({
        kind: "linear/pick-project",
        title: "Pick",
        data: {},
      }).success,
    ).toBe(false);
  });
});
