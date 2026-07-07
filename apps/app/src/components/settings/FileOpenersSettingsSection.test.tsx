// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { FileOpenersSettingsSection } from "./FileOpenersSettingsSection";

function NotesEditor() {
  return null;
}

function registerNotesOpener() {
  setPluginSlotRegistrations("notes", {
    homepageSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    fileOpeners: [
      {
        id: "editor",
        title: "Notes editor",
        extensions: ["md", "mdx"],
        component: NotesEditor,
      },
    ],
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("FileOpenersSettingsSection", () => {
  it("renders nothing while no plugin openers are registered", () => {
    const { container } = render(<FileOpenersSettingsSection />);
    expect(container.innerHTML).toBe("");
  });

  it("lists one row per extension and persists a picked default", async () => {
    registerNotesOpener();
    render(<FileOpenersSettingsSection />);

    expect(screen.getByText(".md files")).toBeDefined();
    expect(screen.getByText(".mdx files")).toBeDefined();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Default opener for .md files" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Notes editor/ }),
    );

    expect(
      JSON.parse(window.localStorage.getItem("bb.fileOpenerByExtension") ?? "{}"),
    ).toEqual({ md: "notes:editor" });

    // Switching back to the built-in preview clears the entry.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Default opener for .md files" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Built-in preview/ }),
    );
    expect(
      JSON.parse(window.localStorage.getItem("bb.fileOpenerByExtension") ?? "{}"),
    ).toEqual({});
  });
});
