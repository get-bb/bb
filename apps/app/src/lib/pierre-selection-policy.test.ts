import { describe, expect, it } from "vitest";
import {
  applyPierreSelectionPolicy,
  PIERRE_SELECTION_POLICY_CSS,
} from "./pierre-selection-policy";

describe("Pierre selection policy", () => {
  it("keeps interactive shadow-root controls out of copied selections", () => {
    expect(PIERRE_SELECTION_POLICY_CSS).toContain("button");
    expect(PIERRE_SELECTION_POLICY_CSS).toContain('[role="button"]');
    expect(PIERRE_SELECTION_POLICY_CSS).toContain("[data-expand-button]");
    expect(PIERRE_SELECTION_POLICY_CSS).toContain("[data-utility-button]");
    expect(PIERRE_SELECTION_POLICY_CSS).toContain("user-select: none");
  });

  it("appends the policy to caller-provided Pierre CSS", () => {
    const customCss = ":host { color: red; }";

    const css = applyPierreSelectionPolicy(customCss);

    expect(css).toContain(customCss);
    expect(css).toContain(PIERRE_SELECTION_POLICY_CSS);
  });
});
