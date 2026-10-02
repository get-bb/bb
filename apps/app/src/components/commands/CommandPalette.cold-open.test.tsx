// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppCommandId,
  type AppKeybinding,
} from "@bb/domain";
import { AppCommandProvider, useAppCommandHandler } from "./AppCommandProvider";
import { CommandPalette } from "./CommandPalette";

const body = vi.hoisted(() => ({
  imports: 0,
  release: () => {},
}));
const calls = vi.hoisted(() => [] as AppCommandId[]);

vi.mock("./CommandPaletteBody", async (importOriginal) => {
  body.imports += 1;
  await new Promise<void>((resolve) => {
    body.release = resolve;
  });
  return importOriginal();
});

function binding(
  command: AppCommandId,
  key: string,
  shift: boolean,
): AppKeybinding {
  return {
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  };
}

const KEYBINDINGS = [
  binding("palette.open", "p", true),
  binding("thread.new", "o", true),
];

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: defaultAppSettings,
      keybindingOverrides: [],
      keybindings: KEYBINDINGS,
      defaultKeybindings: KEYBINDINGS,
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/lib/app-query-client", () => ({
  appQueryClient: { fetchQuery: () => Promise.resolve([]) },
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function NewThreadHandler() {
  useAppCommandHandler("thread.new", () => {
    calls.push("thread.new");
    return true;
  });
  return null;
}

function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? window, {
    key,
    ctrlKey: true,
    shiftKey: true,
  });
}

const loadingInput = () =>
  screen.findByRole("textbox", { name: "Search commands" });

it("stays usable before its body downloads on first open and keeps typed text", async () => {
  render(
    <MemoryRouter>
      <AppCommandProvider>
        <button type="button">origin</button>
        <NewThreadHandler />
        <CommandPalette threadId={null} projectId={null} />
      </AppCommandProvider>
    </MemoryRouter>,
  );
  const origin = screen.getByRole("button", { name: "origin" });
  origin.focus();
  await act(async () => {});
  expect(body.imports).toBe(0);

  press("p");
  fireEvent.keyDown(await loadingInput(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(origin);

  press("p");
  await loadingInput();
  press("o");
  await waitFor(() => expect(calls).toEqual(["thread.new"]));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(origin);

  press("p");
  const input = await loadingInput();
  expect(screen.getByRole("status", { name: "Loading commands" })).toBeTruthy();
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "new thr" } });
  expect(body.imports).toBe(1);

  await act(async () => body.release());
  const combobox = await screen.findByRole("combobox", {
    name: "Search commands",
  });
  expect(combobox).toHaveProperty("value", "new thr");
  expect(document.activeElement).toBe(combobox);
  const selected = screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true");
  expect(selected?.textContent).toContain("New thread");

  fireEvent.keyDown(combobox, { key: "Enter" });
  await waitFor(() => expect(calls).toEqual(["thread.new", "thread.new"]));
  expect(document.activeElement).toBe(origin);
});
