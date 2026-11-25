// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  pluginCommandId,
  type AppKeybindingOverrides,
} from "@bb/domain";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  AppCommandProvider,
  useAppCommandFocusedPluginPage,
  useAppCommandHandler,
  useAppCommandShortcut,
} from "./AppCommandProvider";

const testState = vi.hoisted(() => ({
  overrides: [] as AppKeybindingOverrides,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings, showKeyboardHints: false },
      keybindings: [],
      defaultKeybindings: [],
      keybindingOverrides: testState.overrides,
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

const NEW_TASK = pluginCommandId("tasks", "new-task");
const SYNC = pluginCommandId("tasks", "sync");

function registerTasksCommands() {
  setPluginSlotRegistrations(
    "tasks",
    makePluginRegistrationSet({
      commandPaletteActions: [
        {
          target: "app",
          id: "new-task",
          title: "New task",
          defaultShortcut: {
            key: "c",
            mod: false,
            meta: false,
            control: false,
            alt: false,
            shift: false,
          },
          experimental_keyScope: "pluginPage",
          run: () => {},
        },
        {
          target: "app",
          id: "sync",
          title: "Sync",
          defaultShortcut: {
            key: "y",
            mod: false,
            meta: false,
            control: false,
            alt: true,
            shift: false,
          },
          run: () => {},
        },
      ],
    }),
  );
}

function Harness({
  calls,
  focusedPage,
}: {
  calls: string[];
  focusedPage: string | null;
}) {
  useAppCommandHandler(NEW_TASK, () => {
    calls.push("new-task");
    return true;
  });
  useAppCommandHandler(SYNC, () => {
    calls.push("sync");
    return true;
  });
  return (
    <>
      <Page pluginId="tasks" focused={focusedPage === "tasks"} />
      <Page pluginId="docs" focused={focusedPage === "docs"} />
      <Label />
      <input aria-label="search" />
      <div role="menu" tabIndex={-1} aria-label="status menu">
        <div role="menuitem" tabIndex={-1}>
          Backlog
        </div>
      </div>
    </>
  );
}

function Page({ pluginId, focused }: { pluginId: string; focused: boolean }) {
  useAppCommandFocusedPluginPage(pluginId, focused);
  return null;
}

function Label() {
  const shortcut = useAppCommandShortcut(NEW_TASK);
  return (
    <output aria-label="new task shortcut">{shortcut?.label ?? ""}</output>
  );
}

function renderHarness(focusedPage: string | null) {
  const calls: string[] = [];
  const view = render(
    <AppCommandProvider>
      <Harness calls={calls} focusedPage={focusedPage} />
    </AppCommandProvider>,
  );
  return { calls, view };
}

beforeEach(() => {
  testState.overrides = [];
  registerTasksCommands();
});

afterEach(() => {
  cleanup();
  act(() => resetPluginSlotStoreForTest());
});

describe("plugin page key scope", () => {
  it("fires a bare key only on the command's own focused plugin page", () => {
    const outside = renderHarness(null);
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" });
    expect(outside.calls).toEqual([]);
    fireEvent.keyDown(document.body, { key: "y", code: "KeyY", altKey: true });
    expect(outside.calls).toEqual(["sync"]);
    cleanup();

    const otherPage = renderHarness("docs");
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" });
    expect(otherPage.calls).toEqual([]);
    cleanup();

    const ownPage = renderHarness("tasks");
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" });
    expect(ownPage.calls).toEqual(["new-task"]);
    expect(ownPage.view.getByLabelText("new task shortcut").textContent).toBe(
      "C",
    );
  });

  it("never fires while typing, in a menu, or with a modal open", () => {
    const { calls, view } = renderHarness("tasks");
    fireEvent.keyDown(view.getByLabelText("search"), {
      key: "c",
      code: "KeyC",
    });
    fireEvent.keyDown(view.getByRole("menuitem"), { key: "c", code: "KeyC" });
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("data-state", "open");
    document.body.append(modal);
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" });
    modal.remove();
    expect(calls).toEqual([]);
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" });
    expect(calls).toEqual(["new-task"]);
  });

  it("keeps the page scope when the user rebinds the command", () => {
    testState.overrides = [
      {
        command: NEW_TASK,
        shortcut: {
          key: "n",
          mod: false,
          meta: false,
          control: false,
          alt: false,
          shift: false,
        },
      },
    ];
    const outside = renderHarness(null);
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    expect(outside.calls).toEqual([]);
    cleanup();

    const { calls, view } = renderHarness("tasks");
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" });
    fireEvent.keyDown(document.body, { key: "n", code: "KeyN" });
    expect(calls).toEqual(["new-task"]);
    expect(view.getByLabelText("new task shortcut").textContent).toBe("N");
  });
});
