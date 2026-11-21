// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  codeFencePicksAtom,
  messageDirectivePicksAtom,
} from "@/lib/plugin-choice-picks";
import {
  resetPluginSlotStoreForTest,
  setBuiltinPluginIds,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginChoicesSection } from "./PluginChoicesSection";

const SHELLS = ["bash", "sh", "shell", "zsh", "console", "terminal"];

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

function renderChoices() {
  const store = createStore();
  render(
    <JotaiProvider store={store}>
      <PluginChoicesSection />
    </JotaiProvider>,
  );
  return store;
}

async function choose(trigger: HTMLElement, option: RegExp) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  const item = await screen.findByRole("menuitem", { name: option });
  act(() => {
    fireEvent.click(item);
  });
}

describe("PluginChoicesSection", () => {
  it("shows nothing when no slot or key has a choice to make", () => {
    renderChoices();
    expect(screen.queryByText("Plugin choices")).toBeNull();
  });

  it("switches every language two shell renderers share from one row", async () => {
    for (const pluginId of ["bang-shell", "inline-terminal"]) {
      setPluginSlotRegistrations(
        pluginId,
        makePluginRegistrationSet({
          codeFenceRenderers: [
            { id: "run", languages: SHELLS, component: () => null },
          ],
        }),
      );
    }
    const store = renderChoices();
    const rows = screen.getAllByRole("button", { name: /code blocks$/u });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (row === undefined) throw new Error("no shell row");
    expect(row.getAttribute("aria-label")).toBe(
      "Plugin for bash, console, sh, shell, terminal, zsh code blocks",
    );
    expect(row.textContent).toContain("Automatic");

    await choose(row, /^inline-terminal/u);

    expect(store.get(codeFencePicksAtom)).toEqual(
      Object.fromEntries(
        SHELLS.map((language) => [language, "inline-terminal/run"]),
      ),
    );
  });

  it("lists a directive several plugins claim as not chosen until the user picks one", async () => {
    setBuiltinPluginIds(["tasks"]);
    for (const pluginId of ["tasks", "tasks-plus"]) {
      setPluginSlotRegistrations(
        pluginId,
        makePluginRegistrationSet({
          messageDirectives: [{ id: "task", component: () => null }],
        }),
      );
    }
    const store = renderChoices();
    const row = screen.getByRole("button", {
      name: "Plugin for ::task directives",
    });
    expect(row.textContent).toContain("Not chosen");

    await choose(row, /^tasks \(from bb\)/u);

    expect(store.get(messageDirectivePicksAtom)).toEqual({
      task: "tasks/task",
    });
  });
});
