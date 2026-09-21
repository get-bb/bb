import { describe, expect, it, vi } from "vitest";
import { collectComposerCustomization } from "../internal/composer-customization-validation.js";

describe("composer send-menu contributions", () => {
  it("preserves opted-in actions and existing plus-only registrations", () => {
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
    expect(registration?.plusMenu).toEqual([legacy, scheduled]);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("rejects an invalid send-menu flag without losing valid actions", () => {
    const onRejected = vi.fn();
    const valid = { id: "valid", label: "Valid", run: vi.fn() };
    const registration = collectComposerCustomization(
      {
        id: "actions",
        plusMenu: [
          { ...valid, id: "invalid", experimental_sendMenu: "true" },
          valid,
        ],
      },
      new Set(),
      onRejected,
    );
    expect(registration?.plusMenu).toEqual([valid]);
    expect(onRejected).toHaveBeenCalledWith(
      expect.stringContaining("experimental_sendMenu"),
    );
  });
});
