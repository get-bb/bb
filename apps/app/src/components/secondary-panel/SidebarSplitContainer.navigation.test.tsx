// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppKeybindings } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandHandler,
} from "@/components/commands/AppCommandProvider";
import { SidebarSplitContainer } from "./SidebarSplitContainer";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { showKeyboardHints: false } },
  }),
}));
vi.mock("@/hooks/usePluginCommandBindings", () => ({
  usePluginCommandBindings: () => {
    const keybindings: AppKeybindings = (
      [
        ["panel.previousTab", "ArrowLeft", false, true],
        ["panel.nextTab", "ArrowRight", false, true],
        ["pane.focus.previous", "ArrowLeft", true, false],
        ["pane.focus.next", "ArrowRight", true, false],
      ] as const
    ).map(([command, key, control, shift]) => ({
      command,
      desktopOnly: false,
      shortcut: { key, mod: true, meta: false, control, alt: false, shift },
      when: { all: ["mainSurface"], none: ["modalOpen"] },
    }));
    return { keybindings, defaults: keybindings };
  },
}));

function NextPaneHandler({ onNextPane }: { onNextPane: () => void }) {
  useAppCommandHandler("pane.focus.next", () => {
    onNextPane();
    return true;
  });
  return null;
}

function ChatPanel({ name, enabled }: { name: string; enabled: boolean }) {
  const [activeTabId, setActiveTabId] = useState("a");
  return (
    <SidebarSplitContainer
      activeTabId={activeTabId}
      canNavigateTabs={enabled}
      isFullScreen={false}
      onActivateTab={setActiveTabId}
      onGlobalTabReorder={() => {}}
      onToggleFullScreen={() => {}}
      panelStateId={name}
      tabs={[
        { id: "a", label: "A", restoresPlacementAfterRemoval: true },
        { id: "b", label: "B", restoresPlacementAfterRemoval: true },
      ]}
      renderPane={({ group }) => (
        <div>
          <output data-testid={name}>{group.activeTabId}</output>
          <input
            aria-label={`${name} draft`}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
      )}
    />
  );
}

function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? window, {
    key,
    shiftKey: true,
    metaKey: /Mac|iPhone|iPad|iPod/u.test(navigator.platform),
    ctrlKey: !/Mac|iPhone|iPad|iPod/u.test(navigator.platform),
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("panel tab commands", () => {
  it("routes a rebound chat-split command before an editor consumes it", () => {
    const onNextPane = vi.fn();
    render(
      <AppCommandProvider>
        <NextPaneHandler onNextPane={onNextPane} />
        <input
          aria-label="editor"
          onKeyDown={(event) => event.stopPropagation()}
        />
      </AppCommandProvider>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "editor" }), {
      key: "ArrowRight",
      ctrlKey: true,
      metaKey: /Mac|iPhone|iPad|iPod/u.test(navigator.platform),
    });
    expect(onNextPane).toHaveBeenCalledOnce();
  });

  it("cycles only the active chat panel, even with a later registered inactive panel and focused editor", () => {
    const view = (active: string) => (
      <AppCommandProvider>
        <ChatPanel name="first" enabled={active === "first"} />
        <ChatPanel name="second" enabled={active === "second"} />
      </AppCommandProvider>
    );
    const { rerender } = render(view("first"));
    const editor = screen.getByRole("textbox", { name: "first draft" });
    fireEvent.change(editor, { target: { value: "unsaved content" } });
    act(() => editor.focus());
    press("ArrowRight");
    expect(screen.getByTestId("first").textContent).toBe("b");
    expect(screen.getByTestId("second").textContent).toBe("a");
    press("ArrowRight");
    expect(screen.getByTestId("first").textContent).toBe("a");
    press("ArrowLeft");
    expect(screen.getByTestId("first").textContent).toBe("b");
    expect(screen.getByRole("textbox", { name: "first draft" })).toBe(editor);
    expect(screen.getByDisplayValue("unsaved content")).toBe(editor);
    rerender(view("second"));
    press("ArrowRight");
    expect(screen.getByTestId("first").textContent).toBe("b");
    expect(screen.getByTestId("second").textContent).toBe("b");
    rerender(view("none"));
    press("ArrowLeft");
    expect(screen.getByTestId("first").textContent).toBe("b");
    expect(screen.getByTestId("second").textContent).toBe("b");
  });
});
