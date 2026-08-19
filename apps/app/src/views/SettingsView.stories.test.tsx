// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SettingsStoryChrome,
  useSettingsStoryRoute,
} from "../../.ladle/story-settings-chrome";

function NavigableSettingsStory() {
  const route = useSettingsStoryRoute();
  const label =
    route.kind === "machine"
      ? route.id
      : route.kind === "provider"
        ? route.id === "codex"
          ? "Codex"
          : "Claude Code"
        : route.id;

  return (
    <SettingsStoryChrome>
      <h2>{label}</h2>
    </SettingsStoryChrome>
  );
}

afterEach(cleanup);

describe("settings/Settings/Full Page story chrome", () => {
  it("navigates between Settings sections and provider pages", () => {
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

    fireEvent.click(screen.getByRole("link", { name: /Codex/ }));
    expect(screen.getByRole("heading", { name: "Codex" })).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Codex/ }).getAttribute("aria-current"),
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
});
