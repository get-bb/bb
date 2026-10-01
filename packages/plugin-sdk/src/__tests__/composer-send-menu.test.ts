import { describe, expect, it, vi } from "vitest";
import { collectComposerCustomization } from "../internal/composer-customization-validation.js";

describe("composer plus-menu upgrade from SDK 0.4.108", () => {
  it("retains legacy action callbacks in the plus menu after removing the send-menu API", () => {
    const legacy = { id: "legacy", label: "Legacy", run: vi.fn() };
    const scheduled = {
      id: "schedule",
      label: "Send later",
      experimental_sendMenu: true,
      run: vi.fn(),
    };
    const onRejected = vi.fn();
    const registration = collectComposerCustomization(
      { id: "actions", plusMenu: [legacy, scheduled] },
      new Set(),
      onRejected,
    );
    expect(registration?.plusMenu).toEqual([
      legacy,
      { id: scheduled.id, label: scheduled.label, run: scheduled.run },
    ]);
    expect(onRejected).not.toHaveBeenCalled();
  });
});

describe("composer popup registration", () => {
  it("isolates malformed popup content while retaining other composer contributions", () => {
    const run = vi.fn();
    const rejected = vi.fn();
    const registration = collectComposerCustomization(
      {
        id: "library",
        experimental_popup: { label: "Saved prompts", component: "invalid" },
        plusMenu: [{ id: "open", label: "Saved prompts", run }],
      },
      new Set(),
      rejected,
    );
    expect(registration?.experimental_popup).toBeUndefined();
    expect(registration?.plusMenu?.[0]?.run).toBe(run);
    expect(rejected).toHaveBeenCalledWith(
      expect.stringContaining("must be a React component function"),
    );
  });
});
