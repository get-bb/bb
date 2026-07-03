// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { MentionMenu } from "./MentionMenu";
import type { ComposerCommandSuggestion, TypeaheadMenuState } from "./types";

/**
 * The plugin rows of the command typeahead show the plugin's logo when the
 * server serves one, and the generic bolt otherwise (the composer's
 * "logos everywhere" rule — same treatment as sidebar rows and thread
 * actions).
 */

function commandMenuState(
  suggestions: ComposerCommandSuggestion[],
): TypeaheadMenuState {
  return {
    trigger: "command",
    state: { kind: "results", suggestions },
  };
}

const PLUGIN_COMMAND: ComposerCommandSuggestion = {
  kind: "plugin-command",
  pluginId: "linear",
  name: "standup",
  description: "Draft a standup update",
};

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
});

describe("MentionMenu plugin command rows", () => {
  it("renders the plugin's logo when one is served", () => {
    setPluginLogoUrls(
      new Map([
        ["linear", { logoUrl: "/api/v1/plugins/linear/assets/logo?h=beef", logoDarkUrl: null }],
      ]),
    );
    render(
      <MentionMenu
        state={commandMenuState([PLUGIN_COMMAND])}
        selectedIndex={0}
        onApply={() => {}}
      />,
    );
    expect(screen.getByText("Plugin commands")).toBeDefined();
    const logo = screen.getByTestId("plugin-logo-linear");
    expect(logo.getAttribute("src")).toBe(
      "/api/v1/plugins/linear/assets/logo?h=beef",
    );
  });

  it("falls back to the bolt icon without a logo", () => {
    render(
      <MentionMenu
        state={commandMenuState([PLUGIN_COMMAND])}
        selectedIndex={0}
        onApply={() => {}}
      />,
    );
    expect(screen.queryByTestId("plugin-logo-linear")).toBeNull();
    const row = screen.getByText("standup").closest("button");
    expect(row?.querySelector("svg")).not.toBeNull();
  });
});
