// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginSettingsSections } from "./PluginSettingsSections";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

function Section({
  internal_DO_NOT_USE_onSetupStarted: onSetupStarted,
}: PluginSettingsSectionProps) {
  return (
    <button type="button" onClick={onSetupStarted}>
      {onSetupStarted === undefined ? "settings" : "setup guide"}
    </button>
  );
}

describe("PluginSettingsSections", () => {
  it("passes the setup guide's start callback only when the guide renders the section", () => {
    setPluginSlotRegistrations(
      "connect",
      registrationSet({
        settingsSections: [{ id: "remote-access", component: Section }],
      }),
    );
    const onSetupStarted = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <PluginSettingsSections pluginId="connect" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "settings" })).toBeDefined();
    unmount();

    render(
      <MemoryRouter>
        <PluginSettingsSections
          pluginId="connect"
          onSetupStarted={onSetupStarted}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "setup guide" }));
    expect(onSetupStarted).toHaveBeenCalledOnce();
  });
});
