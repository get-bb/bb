// @vitest-environment jsdom
/// <reference types="vitest/jsdom" />

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { FullPage } from "@/views/SettingsView.stories";
import { SETTINGS_SEARCH_INDEX } from "./settings-search";
import {
  getSettingsSectionRoutePath,
  SETTINGS_NAV_SECTIONS,
  type SettingsNavSection,
} from "./settings-sections";

const LOCAL_URL = "http://localhost:3000/";
const REMOTE_URL = "http://192.168.1.20:3000/";

const sectionsWithSettings = SETTINGS_NAV_SECTIONS.filter(
  (section) => SETTINGS_SEARCH_INDEX[section.id].settings.length > 0,
);

function registerReplacementPlugin() {
  setPluginSlotRegistrations(
    "inkwell",
    makePluginRegistrationSet({
      threadLists: [{ id: "inbox", title: "Inbox", component: () => null }],
      sourceCodeRenderers: [
        { id: "source", title: "Inkwell source", component: () => null },
      ],
      diffRenderers: [
        { id: "diffs", title: "Inkwell diffs", component: () => null },
      ],
      fileOpeners: [
        {
          id: "editor",
          title: "Inkwell editor",
          extensions: ["md"],
          component: () => null,
        },
      ],
    }),
  );
}

function renderSection(section: SettingsNavSection) {
  render(
    <MemoryRouter initialEntries={[getSettingsSectionRoutePath(section.id)]}>
      <TooltipProvider>
        <FullPage />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function missingAnchors(titles: readonly string[]): string[] {
  const rendered = new Set(
    [...document.querySelectorAll<HTMLElement>("[data-settings-anchor]")].map(
      (element) => element.dataset.settingsAnchor,
    ),
  );
  return titles.filter((title) => !rendered.has(title));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
  jsdom.reconfigure({ url: LOCAL_URL });
});

describe("settings search index", () => {
  it.each(sectionsWithSettings)(
    "renders every unconditional $label setting without plugins on localhost",
    async (section) => {
      jsdom.reconfigure({ url: LOCAL_URL });
      renderSection(section);

      const titles = SETTINGS_SEARCH_INDEX[section.id].settings
        .filter((setting) => setting.when === undefined)
        .map((setting) => setting.title);
      await waitFor(() => {
        expect(missingAnchors(titles)).toEqual([]);
      });
    },
  );

  it.each(sectionsWithSettings)(
    "renders every $label setting once each condition is met",
    async (section) => {
      jsdom.reconfigure({ url: REMOTE_URL });
      registerReplacementPlugin();
      renderSection(section);

      const titles = SETTINGS_SEARCH_INDEX[section.id].settings.map(
        (setting) => setting.title,
      );
      await waitFor(() => {
        expect(missingAnchors(titles)).toEqual([]);
      });
    },
  );
});
