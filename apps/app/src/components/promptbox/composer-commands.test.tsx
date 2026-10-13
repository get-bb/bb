// @vitest-environment jsdom

import { useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, pluginCommandId } from "@bb/domain";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@bb/client-core";
import {
  AppCommandProvider,
  useAppCommandContext,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  PromptBoxInternal,
} from "./PromptBoxInternal";

const SHORTCUT = {
  mod: false,
  meta: false,
  alt: false,
  shift: false,
  control: true,
};

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: [
        {
          command: "composer.focus",
          desktopOnly: false,
          shortcut: { ...SHORTCUT, key: "c" },
          when: {
            all: ["mainSurface", "promptAvailable"],
            none: ["modalOpen", "terminalFocus", "browserFocus"],
          },
        },
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

const PLUGIN_COMMAND = pluginCommandId("saved-prompts", "search");
const EMPTY_DRAFT = { text: "", mentions: [], attachments: [] };

function registerPluginCommand(runs: string[]) {
  setPluginSlotRegistrations(
    "saved-prompts",
    makePluginRegistrationSet({
      commandPaletteActions: [
        {
          target: "composer",
          id: "search",
          title: "Search saved prompts",
          defaultShortcut: { ...SHORTCUT, key: "r" },
          run: ({ composer }) => {
            runs.push(composer.key);
          },
        },
      ],
    }),
  );
}

function Composer({
  composerKey,
  role,
  onFocusCommand,
}: {
  composerKey: string;
  role: "primary" | "secondary";
  onFocusCommand(): void;
}) {
  const host: PluginComposerHost = {
    scope: { kind: "new-thread", projectId: null },
    textEffectKey: composerKey,
    getCurrent: () => EMPTY_DRAFT,
    subscribeDraft: () => () => {},
    setDraft: () => {},
    focus: () => {},
  };
  return (
    <PluginComposerHostProvider value={host}>
      <div
        data-testid={composerKey}
        data-app-composer=""
        data-app-composer-role={role}
      >
        <PromptBoxInternal
          value=""
          mentionRanges={[]}
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onFocusCommand={onFocusCommand}
          autoFocus={false}
          mentionMenuPlacement="bottom"
          typeahead={{
            mention: {
              results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
              isLoading: false,
              isError: false,
              onQueryChange: vi.fn(),
            },
            command: INERT_TYPEAHEAD_COMMAND_CONFIG,
          }}
        />
      </div>
    </PluginComposerHostProvider>
  );
}

function PromptAvailable() {
  useAppCommandContext("promptAvailable", true);
  return null;
}

function RunnerProbe({
  onRunner,
}: {
  onRunner(runner: AppCommandRunner): void;
}) {
  const runner = useAppCommandRunner();
  useEffect(() => onRunner(runner), [onRunner, runner]);
  return null;
}

function renderComposers() {
  const focused: string[] = [];
  const runner: { current: AppCommandRunner | null } = { current: null };
  const view = render(
    <MemoryRouter>
      <AppCommandProvider>
        <PromptAvailable />
        <RunnerProbe
          onRunner={(next) => {
            runner.current = next;
          }}
        />
        <Composer
          composerKey="main"
          role="primary"
          onFocusCommand={() => focused.push("main")}
        />
        <Composer
          composerKey="side"
          role="secondary"
          onFocusCommand={() => focused.push("side")}
        />
        <button type="button">Elsewhere</button>
        <div data-app-terminal="" tabIndex={-1}>
          Terminal
        </div>
      </AppCommandProvider>
    </MemoryRouter>,
  );
  const editorIn = (composerKey: string) => {
    const editor = view
      .getByTestId(composerKey)
      .querySelector<HTMLElement>("[contenteditable]");
    if (editor === null) throw new Error(`${composerKey} editor is missing`);
    return editor;
  };
  return { view, runner, focused, editorIn };
}

function press(target: HTMLElement, key: string): KeyboardEvent {
  target.focus();
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
    ctrlKey: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

describe("composer commands", () => {
  it("runs core and plugin commands in the composer holding the caret", () => {
    const runs: string[] = [];
    registerPluginCommand(runs);
    const { focused, editorIn } = renderComposers();

    press(editorIn("main"), "r");
    press(editorIn("main"), "c");

    expect(runs).toEqual(["main"]);
    expect(focused).toEqual(["main"]);
  });

  it("runs in a secondary composer only while it holds the caret", () => {
    const runs: string[] = [];
    registerPluginCommand(runs);
    const { view, focused, editorIn } = renderComposers();

    press(editorIn("side"), "r");
    press(editorIn("side"), "c");
    const elsewhere = view.getByRole("button", { name: "Elsewhere" });
    const event = press(elsewhere, "r");
    press(elsewhere, "c");

    expect(runs).toEqual(["side", "main"]);
    expect(focused).toEqual(["side", "main"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the terminal's shortcut alone", () => {
    const runs: string[] = [];
    registerPluginCommand(runs);
    const { view } = renderComposers();

    const event = press(view.getByText("Terminal"), "r");

    expect(runs).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("dispatches a palette invocation to the composer focused when it opened", () => {
    const runs: string[] = [];
    registerPluginCommand(runs);
    const { view, runner, editorIn } = renderComposers();
    view.getByRole("button", { name: "Elsewhere" }).focus();
    const main = editorIn("main");

    expect(runner.current?.isCommandAvailable(PLUGIN_COMMAND, main)).toBe(true);
    act(() => {
      runner.current?.dispatch(PLUGIN_COMMAND, main);
    });

    expect(runs).toEqual(["main"]);
  });
});
