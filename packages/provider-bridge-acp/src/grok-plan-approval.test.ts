import { describe, expect, it } from "vitest";
import {
  decodeGrokPlanApprovalParams,
  grokPlanApprovalCancellation,
  grokPlanApprovalResponse,
  grokPlanApprovalSubject,
} from "./grok-plan-approval.js";

const params = {
  sessionId: "grok-session",
  toolCallId: "grok-plan-call",
  planContent: "# Plan\n\n1. Add hello.\n2. Add a test.",
};

describe("Grok plan approval adapter", () => {
  it("decodes planContent and maps a provider-neutral plan subject", () => {
    const request = decodeGrokPlanApprovalParams(params);
    expect(request.planContent).toBe(params.planContent);
    expect(grokPlanApprovalSubject(request)).toEqual({
      kind: "plan",
      itemId: "grok-plan-call",
      plan: params.planContent,
      planFilePath: null,
    });
  });

  it("accepts plan and input.plan fallbacks with unknown future fields", () => {
    expect(
      decodeGrokPlanApprovalParams({
        sessionId: "s",
        toolCallId: "t",
        plan: "# Fallback",
        future: true,
      }).planContent,
    ).toBe("# Fallback");
    expect(
      decodeGrokPlanApprovalParams({
        sessionId: "s",
        toolCallId: "t",
        input: { plan: "# Nested" },
      }).planContent,
    ).toBe("# Nested");
  });

  it("preserves Markdown and Unicode plan content", () => {
    const planContent = "# План 😀\n\n1. 詳細な実装\n2. مراجعة";
    expect(
      decodeGrokPlanApprovalParams({ ...params, planContent }).planContent,
    ).toBe(planContent);
  });

  it("rejects empty and oversized plans", () => {
    expect(() =>
      decodeGrokPlanApprovalParams({ ...params, planContent: "  " }),
    ).toThrow(/plan/i);
    expect(() =>
      decodeGrokPlanApprovalParams({
        ...params,
        planContent: "x".repeat(64_001),
      }),
    ).toThrow(/64_000|64000|plan/i);
  });

  it("maps allow decisions to approved", () => {
    expect(
      grokPlanApprovalResponse({
        decision: "allow_once",
        grantedPermissions: null,
      }),
    ).toEqual({
      outcome: "approved",
    });
    expect(
      grokPlanApprovalResponse({
        decision: "allow_for_session",
        grantedPermissions: null,
      }),
    ).toEqual({ outcome: "approved" });
  });

  it("maps deny with comments to cancelled with exact comments", () => {
    expect(
      grokPlanApprovalResponse({
        decision: "deny",
        comments: "Please include a focused test.",
      }),
    ).toEqual({
      outcome: "cancelled",
      comments: "Please include a focused test.",
    });
  });

  it("rejects oversized comments instead of truncating them", () => {
    expect(() =>
      grokPlanApprovalResponse({
        decision: "deny",
        comments: "x".repeat(4_097),
      }),
    ).toThrow(/4096|comment/i);
  });

  it("cancels without comments when no approval is given", () => {
    expect(grokPlanApprovalResponse({ decision: "deny" })).toEqual({
      outcome: "cancelled",
    });
    expect(grokPlanApprovalCancellation()).toEqual({ outcome: "cancelled" });
  });
});
