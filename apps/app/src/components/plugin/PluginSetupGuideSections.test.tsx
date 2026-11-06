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
  onSetupFailed,
}: InternalDoNotUseSetupGuideSectionProps) {
  return (
    <li>
      <span>{onPhone ? "phone row" : "desktop row"}</span>
      <button type="button" onClick={onSetupStarted}>
        Set up
      </button>
      <button type="button" onClick={() => onSetupFailed("turn_on")}>
        Fail
      </button>
    </li>
  );
}

function renderSections() {
  const onSetupStarted = vi.fn();
  const onSetupFailed = vi.fn();
  const view = render(
    <MemoryRouter>
      <ul>
        <PluginSetupGuideSections
          pluginId="connect"
          onPhone
          onSetupStarted={onSetupStarted}
          onSetupFailed={onSetupFailed}
        />
      </ul>
    </MemoryRouter>,
  );
  return { ...view, onSetupStarted, onSetupFailed };
}

describe("PluginSetupGuideSections", () => {
  it("renders the plugin's section with the guide's props", () => {
    setPluginSlotRegistrations(
      "connect",
      registrationSet({
        setupGuideSections: [{ id: "remote-access", component: Section }],
      }),
    );
    const { onSetupStarted, onSetupFailed } = renderSections();

    expect(screen.getByText("phone row")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(onSetupStarted).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(onSetupFailed).toHaveBeenCalledExactlyOnceWith("turn_on");
  });

  it("renders nothing when the plugin registers no section", () => {
    setPluginSlotRegistrations(
      "other",
      registrationSet({
        setupGuideSections: [{ id: "remote-access", component: Section }],
      }),
    );
    const { container } = renderSections();

    expect(container.querySelector("ul")?.childElementCount).toBe(0);
  });

  it("shows the standard crashed-plugin chip when the section crashes", () => {
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

    expect(screen.getByText("plugin connect crashed")).toBeDefined();
  });
});
