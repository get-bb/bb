// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAppTheme } from "@bb/domain";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { AppearanceSettingsSection } from "./SettingsView";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

it("keeps appearance choices first and groups sidebar controls in Interface", () => {
  setPluginSlotRegistrations(
    "fixture",
    makePluginRegistrationSet({
      experimentalSidebarHeaders: [
        { id: "header", title: "Fixture header", component: () => null },
      ],
      sourceCodeRenderers: [
        { id: "source", title: "Fixture source", component: () => null },
      ],
      diffRenderers: [
        { id: "diff", title: "Fixture diff", component: () => null },
      ],
      threadLists: [
        { id: "threads", title: "Fixture threads", component: () => null },
      ],
      experimentalSidebarNavigations: [
        {
          id: "navigation",
          title: "Fixture navigation",
          component: () => null,
        },
      ],
    }),
  );

  render(
    <AppearanceSettingsSection
      appearance={defaultAppTheme}
      appearanceDisabled={false}
      customThemes={[]}
      pluginThemes={[]}
      faviconColor="default"
      onAppearanceThemeChange={vi.fn()}
      onAppearanceThemePrefetch={vi.fn()}
      onAppearanceThemePreview={vi.fn()}
      onCreatePalette={vi.fn()}
      onFaviconColorChange={vi.fn()}
      onThemePreferenceChange={vi.fn()}
      themePreference="system"
    />,
  );

  const labels = (section: HTMLElement) =>
    Array.from(
      section.querySelectorAll("[data-control-placement]"),
      (row) => row.querySelector("p")?.textContent,
    );
  const appearance = screen
    .getByRole("heading", { name: "Appearance" })
    .closest("section");
  const interfaceSection = screen
    .getByRole("heading", { name: "Interface" })
    .closest("section");

  expect(appearance).not.toBeNull();
  expect(interfaceSection).not.toBeNull();
  expect(labels(appearance!)).toEqual([
    "Theme",
    "Palette",
    "Header",
    "Source code",
    "Diffs",
    "Favicon color",
    "Fade inactive splits",
  ]);
  expect(labels(interfaceSection!)).toEqual([
    "Sidebar",
    "Navigation",
    "Sidebar footer",
  ]);
});
