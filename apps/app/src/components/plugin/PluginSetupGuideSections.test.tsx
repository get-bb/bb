// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InternalDoNotUseSetupGuideSectionProps } from "@get-bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginSetupGuideSections } from "./PluginSetupGuideSections";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

function Section({
  onPhone,
  onSetupStarted,
}: InternalDoNotUseSetupGuideSectionProps) {
  return (
    <li>
      <span>{onPhone ? "phone row" : "desktop row"}</span>
      <button type="button" onClick={onSetupStarted}>
        Set up
      </button>
    </li>
  );
}

function renderSections(onSetupStarted = vi.fn()) {
  render(
    <MemoryRouter>
      <ul>
        <PluginSetupGuideSections
          pluginId="connect"
          onPhone
          onSetupStarted={onSetupStarted}
          fallback={<li>core fallback</li>}
        />
      </ul>
    </MemoryRouter>,
  );
  return onSetupStarted;
}

describe("PluginSetupGuideSections", () => {
  it("renders the plugin's section with the guide's props", () => {
    setPluginSlotRegistrations(
      "connect",
      registrationSet({
        setupGuideSections: [{ id: "remote-access", component: Section }],
      }),
    );
    const onSetupStarted = renderSections();

    expect(screen.getByText("phone row")).toBeDefined();
    expect(screen.queryByText("core fallback")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(onSetupStarted).toHaveBeenCalledOnce();
  });

  it("renders the fallback when the plugin registers no section", () => {
    setPluginSlotRegistrations(
      "other",
      registrationSet({
        setupGuideSections: [{ id: "remote-access", component: Section }],
      }),
    );
    renderSections();

    expect(screen.getByText("core fallback")).toBeDefined();
    expect(screen.queryByText("phone row")).toBeNull();
  });

  it("renders the fallback when the section crashes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("section crashed");
    }
    setPluginSlotRegistrations(
      "connect",
      registrationSet({
        setupGuideSections: [{ id: "remote-access", component: Crashes }],
      }),
    );
    renderSections();

    expect(screen.getByText("core fallback")).toBeDefined();
  });
});
