// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SettingsStoryChrome,
  useSettingsStoryRoute,
} from "../../.ladle/story-settings-chrome";
import { FullPage } from "./SettingsView.stories";

function NavigableSettingsStory() {
  const route = useSettingsStoryRoute();
  const label = route.id;

  return (
    <SettingsStoryChrome>
      <h2>{label}</h2>
    </SettingsStoryChrome>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("settings/Settings/Full Page story chrome", () => {
  it("navigates between Settings sections", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TooltipProvider>
          <NavigableSettingsStory />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "general" })).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "General" })
        .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("link", { name: "Appearance" }));
    expect(screen.getByRole("heading", { name: "appearance" })).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Appearance" })
        .getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("link", { name: "Providers" }));
    expect(screen.getByRole("heading", { name: "providers" })).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Providers" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Appearance" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("keeps Machines selected on a machine detail route", () => {
    render(
      <MemoryRouter initialEntries={["/settings/machines/host_local"]}>
        <TooltipProvider>
          <NavigableSettingsStory />
        </TooltipProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "host_local" })).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Machines" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("applies settingsPath once without resetting subsequent row navigation", async () => {
    window.history.replaceState(
      null,
      "",
      "/?settingsPath=%2Fsettings%2Fmachines",
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TooltipProvider>
          <FullPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("link", {
        name: "Open michael-build-box",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "michael-build-box" }),
      ).toBeDefined();
    });
    expect(screen.queryByRole("heading", { name: "Machines" })).toBeNull();
  });
});
