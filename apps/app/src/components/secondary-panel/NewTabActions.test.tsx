// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginPanelActionEntry } from "@/components/plugin/PluginPanelActions";
import { NewTabActions } from "./NewTabFileSearch";
import { newTabActionOrderAtom } from "./newTabActionsAtoms";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

const START_TERMINAL_ID = "file-search-result-start-terminal";

function pluginAction(id: string, title: string): PluginPanelActionEntry {
  return {
    id: `plugin-action:${id}`,
    pluginId: id,
    icon: null,
    title,
    onSelect: () => undefined,
  };
}

const sideChat = pluginAction("side-chat", "Start side chat");
const quickstart = pluginAction("quickstart", "Quickstart");

function renderActions(
  storedOrder: string[],
  pluginActions: PluginPanelActionEntry[],
) {
  const store = createStore();
  store.set(newTabActionOrderAtom, storedOrder);
  return render(
    <Provider store={store}>
      <NewTabActions
        onStartTerminal={() => undefined}
        pluginActions={pluginActions}
      />
    </Provider>,
  );
}

function actionLabels(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((label) => label.length > 0);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("NewTabActions", () => {
  it("keeps a trailing terminal control separate from the terminal action", () => {
    const onSelectHost = vi.fn();
    const onStartTerminal = vi.fn();
    const { container } = render(
      <NewTabActions
        onStartTerminal={onStartTerminal}
        startTerminalTrailing={
          <button type="button" onClick={onSelectHost}>
            Machine
          </button>
        }
      />,
    );

    expect(container.querySelector("button button")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Machine" }));
    expect(onSelectHost).toHaveBeenCalledOnce();
    expect(onStartTerminal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start terminal" }));
    expect(onStartTerminal).toHaveBeenCalledOnce();
  });

  it("renders built-in and plugin actions in the order the user saved", () => {
    renderActions([sideChat.id, START_TERMINAL_ID], [sideChat]);

    expect(actionLabels()).toEqual(["Start side chat", "Start terminal"]);
  });

  it("appends an action the saved order has never seen", () => {
    renderActions([sideChat.id, START_TERMINAL_ID], [sideChat, quickstart]);

    expect(actionLabels()).toEqual([
      "Start side chat",
      "Start terminal",
      "Quickstart",
    ]);
  });
});
