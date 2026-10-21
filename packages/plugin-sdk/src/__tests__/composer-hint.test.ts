import { describe, expect, it, vi } from "vitest";
import { collectComposerCustomization } from "../internal/composer-customization-validation.js";

const component = () => null;

describe("composer Hint registration", () => {
  it.each([
    null,
    [],
    "hint",
    { id: "bad id", component },
    { id: "notifications", component: "invalid" },
  ])(
    "rejects malformed Hints without dropping other contributions: %j",
    (hint) => {
      const rejected = vi.fn();
      const action = { id: "action", component };
      const registration = collectComposerCustomization(
        { id: "guidance", actions: [action], experimental_hint: hint },
        new Set(),
        rejected,
      );
      expect(registration?.actions).toEqual([action]);
      expect(registration?.experimental_hint).toBeUndefined();
      expect(rejected).toHaveBeenCalledOnce();
    },
  );

  it("preserves the component and scope for valid Hints", () => {
    const rejected = vi.fn();
    const hint = { id: "notifications", component };
    const registration = collectComposerCustomization(
      { id: "guidance", scopes: ["thread"], experimental_hint: hint },
      new Set(),
      rejected,
    );
    expect(registration?.experimental_hint).toEqual(hint);
    expect(registration?.scopes).toEqual(["thread"]);
    expect(rejected).not.toHaveBeenCalled();
  });
});
