// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { SETTINGS_SEARCH_ANCHOR_STATE_KEY } from "./settings-search";
import { useRevealSettingsSearchTarget } from "./useRevealSettingsSearchTarget";

const FLASH_CLASS = "bb-search-flash";

const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

function SettingsPage() {
  const navigate = useNavigate();
  const [lateRowVisible, setLateRowVisible] = useState(false);
  useRevealSettingsSearchTarget();
  const openSearchResult = (anchor: string) =>
    navigate("/settings", {
      state: { [SETTINGS_SEARCH_ANCHOR_STATE_KEY]: anchor },
    });

  return (
    <>
      <button onClick={() => void openSearchResult("Theme")}>
        Open Theme result
      </button>
      <button onClick={() => void openSearchResult("Microphone")}>
        Open Microphone result
      </button>
      <button onClick={() => void navigate("/settings/appearance")}>
        Leave
      </button>
      <button onClick={() => void navigate(-1)}>Back</button>
      <button onClick={() => setLateRowVisible(true)}>Load microphones</button>
      <SettingsWithControl label="Theme">theme control</SettingsWithControl>
      {lateRowVisible ? (
        <SettingsWithControl label="Microphone">
          mic control
        </SettingsWithControl>
      ) : null}
    </>
  );
}

function row(label: string): HTMLElement {
  const element = screen
    .getByText(label)
    .closest<HTMLElement>("[data-settings-anchor]");
  if (element === null) throw new Error(`No settings row for ${label}`);
  return element;
}

function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
    </MemoryRouter>,
  );
});

afterEach(() => {
  cleanup();
  scrollIntoView.mockReset();
  if (originalScrollIntoView === undefined) {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  } else {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  }
});

describe("useRevealSettingsSearchTarget", () => {
  it("scrolls to the setting a search result names and flashes it", () => {
    click("Open Theme result");

    expect(scrollIntoView.mock.contexts).toEqual([row("Theme")]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(row("Theme").classList.contains(FLASH_CLASS)).toBe(true);
  });

  it("waits for a setting that renders after its data loads", async () => {
    click("Open Microphone result");
    expect(scrollIntoView).not.toHaveBeenCalled();

    click("Load microphones");
    await vi.waitFor(() => {
      expect(scrollIntoView.mock.contexts).toEqual([row("Microphone")]);
    });
    expect(row("Microphone").classList.contains(FLASH_CLASS)).toBe(true);
    expect(row("Theme").classList.contains(FLASH_CLASS)).toBe(false);
  });

  it("leaves the page alone when going back to a search result", () => {
    click("Open Theme result");
    click("Leave");
    scrollIntoView.mockClear();
    row("Theme").classList.remove(FLASH_CLASS);

    click("Back");

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(row("Theme").classList.contains(FLASH_CLASS)).toBe(false);
  });
});
