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
import {
  MarkdownRendererChoicesSection,
  FileOpenerChoicesSection,
  PluginSlotChoiceRows,
} from "./PluginChoiceSettings";

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
      <PluginSlotChoiceRows />
      <FileOpenerChoicesSection />
      <MarkdownRendererChoicesSection />
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

describe("plugin choice settings", () => {
  it("shows nothing when no slot or key has a choice to make", () => {
    renderChoices();
    expect(screen.queryByText("File openers")).toBeNull();
    expect(screen.queryByText("Markdown")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
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

  it("offers a row for a code block or directive only one plugin draws, so the user can switch it back to bb's own", async () => {
    setPluginSlotRegistrations(
      "bang-shell",
      makePluginRegistrationSet({
        codeFenceRenderers: [
          { id: "run", languages: ["bash"], component: () => null },
        ],
        messageDirectives: [{ id: "run", component: () => null }],
      }),
    );
    const store = renderChoices();
    expect(screen.getByText("Markdown")).toBeTruthy();
    const fence = screen.getByRole("button", {
      name: "Plugin for bash code blocks",
    });
    const directive = screen.getByRole("button", {
      name: "Plugin for ::run directives",
    });
    expect(fence.textContent).toContain("Automatic");
    expect(directive.textContent).toContain("Automatic");

    await choose(fence, /^bb \(built-in\)/u);
    await choose(directive, /^Show as text/u);

    expect(store.get(codeFencePicksAtom)).toEqual({ bash: "__builtin__" });
    expect(store.get(messageDirectivePicksAtom)).toEqual({
      run: "__builtin__",
    });
  });
});
