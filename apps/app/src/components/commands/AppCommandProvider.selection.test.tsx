// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  defaultAppSettings,
  pluginCommandId,
  type KeyboardCommandId,
} from "@bb/domain";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { TimelineSelectionMenu } from "../thread/timeline/TimelineSelectionMenu";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings, showKeyboardHints: false },
      keybindings: [
        {
          command: "thread.new",
          desktopOnly: false,
          shortcut: {
            key: "o",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
          when: { all: ["mainSurface"], none: ["modalOpen"] },
        },
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({ getBbDesktopInfo: () => null }));

function Command({
  command,
  run,
}: {
  command: KeyboardCommandId;
  run: () => boolean;
}) {
  useAppCommandHandler(command, run);
  return null;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  act(() => resetPluginSlotStoreForTest());
});

describe("selection actions and app shortcuts", () => {
  it.each([
    { command: "thread.new" as const, key: "o", shiftKey: true },
    {
      command: pluginCommandId("selection-regression", "open"),
      key: "d",
      shiftKey: false,
    },
  ])(
    "keeps $command available with selected text but not a modal",
    ({ command, key, shiftKey }) => {
      setPluginSlotRegistrations(
        "selection-regression",
        makePluginRegistrationSet({
          commandPaletteActions: [
            {
              target: "app",
              id: "open",
              title: "Open regression panel",
              defaultShortcut: {
                key: "d",
                mod: true,
                meta: false,
                control: false,
                alt: false,
                shift: false,
              },
              run: () => {},
            },
          ],
        }),
      );
      const run = vi.fn(() => true);
      const onDismiss = vi.fn();
      const tree = (selected: boolean, modal: boolean) => (
        <MemoryRouter>
          <AppCommandProvider>
            <Command command={command} run={run} />
            <p>Selection regression fixture</p>
            <TimelineSelectionMenu
              selection={
                selected
                  ? {
                      text: "Selection regression fixture",
                      rect: new DOMRect(20, 80, 180, 20),
                      sourceSeqEnd: 1,
                    }
                  : null
              }
              onAddToChat={() => {}}
              onDismiss={onDismiss}
            />
            {modal ? (
              <div role="dialog" aria-modal="true" data-state="open">
                Modal fixture
              </div>
            ) : null}
          </AppCommandProvider>
        </MemoryRouter>
      );
      const dispatch = () => {
        const event = new KeyboardEvent("keydown", {
          key,
          shiftKey,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const view = render(tree(false, false));
      expect(dispatch()).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      run.mockClear();

      const range = document.createRange();
      range.selectNodeContents(
        screen.getByText("Selection regression fixture"),
      );
      window.getSelection()?.addRange(range);
      view.rerender(tree(true, false));
      expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
      expect(dispatch()).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
      expect(window.getSelection()?.toString()).toBe(
        "Selection regression fixture",
      );
      expect(onDismiss).not.toHaveBeenCalled();
      run.mockClear();

      view.rerender(tree(true, true));
      expect(dispatch()).toBe(false);
      expect(run).not.toHaveBeenCalled();
    },
  );
});
