import { describe, expect, it, vi } from "vitest";
import { collectPluginAppRegistrations } from "../internal/plugin-app-collector.js";
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
  it("isolates malformed and duplicate popups across customizations while retaining valid contributions", () => {
    const component = () => null;
    const saved = { id: "saved", label: "Saved prompts", component };
    const recent = { id: "recent", label: "Recent files", component };
    const run = vi.fn();
    const rejected = vi.fn();
    const collected = collectPluginAppRegistrations(
      {
        __bbPluginApp: true,
        setup(app) {
          app.composer.customize({
            id: "library",
            experimental_popups: [
              // @ts-expect-error Invalid runtime registration
              { id: "broken", label: "Broken", component: "invalid" },
              saved,
              saved,
              recent,
            ],
            plusMenu: [{ id: "open", label: "Saved prompts", run }],
          });
          app.composer.customize({
            id: "other",
            experimental_popups: [
              recent,
              { id: "broken", label: "Repaired", component },
            ],
          });
        },
      },
      rejected,
    );
    expect(collected.composerCustomizations[0]?.experimental_popups).toEqual([
      saved,
      recent,
    ]);
    expect(collected.composerCustomizations[0]?.plusMenu?.[0]?.run).toBe(run);
    expect(collected.composerCustomizations[1]?.experimental_popups).toEqual([
      { id: "broken", label: "Repaired", component },
    ]);
    expect(rejected.mock.calls.flat()).toEqual([
      expect.stringContaining("must be a React component function"),
      expect.stringContaining('duplicate id "saved"'),
      expect.stringContaining('duplicate id "recent"'),
    ]);
  });
});
