// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PluginThreadActionRegistrationInfo } from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { threadRowActionsAtom } from "../preferences/atoms.js";

installTestPluginRuntime();
const {
  assignRowActionSlot,
  ThreadRowActionsEditor,
  useFinishRowActionsOnOutsideClick,
} = await import("./ThreadRowActionsCustomize.js");

const REGISTRATIONS: readonly PluginThreadActionRegistrationInfo[] = [
  {
    key: "core/split",
    pluginId: "core",
    title: "Open in split",
    icon: "Columns2",
  },
  {
    key: "core/copyLink",
    pluginId: "core",
    title: "Copy thread link",
    icon: "Copy",
  },
  {
    key: "core/read",
    pluginId: "core",
    title: "Mark read / unread",
    icon: "MailOpen",
  },
  { key: "core/pin", pluginId: "core", title: "Pin", icon: "Pin" },
  { key: "core/rename", pluginId: "core", title: "Rename", icon: "Edit" },
  { key: "core/archive", pluginId: "core", title: "Archive", icon: "Archive" },
  {
    key: "thread-list/move",
    pluginId: "thread-list",
    title: "Move to section",
    icon: "SectionMove",
  },
];

function StoreHarness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return <Provider store={store}>{children}</Provider>;
}

function renderWithRegistrations(children: ReactNode, store = createStore()) {
  return renderSlot(
    { component: StoreHarness },
    { children, store },
    { threadActionRegistrations: REGISTRATIONS },
  );
}

function OutsideClickHarness({
  onDone,
  showEditor,
}: {
  onDone: (restoreFocus: boolean) => void;
  showEditor: boolean;
}) {
  useFinishRowActionsOnOutsideClick(onDone);
  return showEditor ? <ThreadRowActionsEditor onDone={onDone} /> : null;
}

afterEach(() => {
  cleanup();
});

it("previews empty slots before shown actions, next to the menu", () => {
  const store = createStore();
  store.set(threadRowActionsAtom, ["core/pin", "core/archive"]);
  renderWithRegistrations(<ThreadRowActionsEditor onDone={() => {}} />, store);
  expect(
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-row-action-slot]"),
    ).map((slot) => slot.dataset.rowActionSlot),
  ).toEqual(["none", "core/pin", "core/archive"]);
});

it("fills, replaces, swaps, and clears slots", () => {
  expect(assignRowActionSlot(["archive"], 0, "pin")).toEqual([
    "pin",
    "archive",
  ]);
  expect(assignRowActionSlot(["pin", "archive"], 2, "rename")).toEqual([
    "pin",
    "rename",
  ]);
  expect(
    assignRowActionSlot(["pin", "archive", "rename"], 0, "rename"),
  ).toEqual(["rename", "archive", "pin"]);
  expect(assignRowActionSlot(["pin", "archive"], 0, "archive")).toEqual([
    "archive",
    "pin",
  ]);
  expect(assignRowActionSlot(["pin", "archive"], 1, null)).toEqual(["archive"]);
  expect(assignRowActionSlot(["archive"], 0, null)).toEqual(["archive"]);
});

it.each([
  {
    initial: ["core/archive"],
    slot: 0,
    pick: "Pin",
    focusedSlot: 1,
    focused: "core/pin",
  },
  {
    initial: ["core/pin", "core/archive", "core/rename"],
    slot: 0,
    pick: "Rename",
    focusedSlot: 0,
    focused: "core/rename",
  },
  {
    initial: ["core/pin", "core/archive", "core/rename"],
    slot: 1,
    pick: "Hide",
    focusedSlot: 1,
    focused: "core/pin",
  },
] as const)(
  "moves focus to slot $focusedSlot after picking $pick in slot $slot",
  async ({ initial, slot, pick, focusedSlot, focused }) => {
    const store = createStore();
    store.set(threadRowActionsAtom, [...initial]);
    renderWithRegistrations(
      <ThreadRowActionsEditor onDone={() => {}} />,
      store,
    );
    const slotButton = (index: number) =>
      document.querySelector<HTMLElement>(
        `[data-sidebar-customize-launch="${index}"]`,
      );
    fireEvent.click(slotButton(slot)!);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: pick }));
    await waitFor(() => {
      expect(document.activeElement).toBe(slotButton(focusedSlot));
      expect(slotButton(focusedSlot)?.dataset.rowActionSlot).toBe(focused);
    });
  },
);

it("offers Hide only for a filled slot and finishes on Escape", async () => {
  const store = createStore();
  store.set(threadRowActionsAtom, ["core/archive"]);
  const finish = vi.fn();
  renderWithRegistrations(<ThreadRowActionsEditor onDone={finish} />, store);
  fireEvent.click(screen.getByRole("button", { name: "Row action 1: Empty" }));
  await screen.findByRole("menuitemradio", { name: "Pin" });
  expect(screen.queryByRole("menuitemradio", { name: "Hide" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(finish).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  fireEvent.click(
    screen.getByRole("button", { name: "Row action 3: Archive" }),
  );
  expect(
    await screen.findByRole("menuitemradio", { name: "Hide" }),
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  fireEvent.keyDown(
    screen.getByRole("button", { name: "Row action 3: Archive" }),
    { key: "Escape" },
  );
  expect(finish).toHaveBeenCalledWith(true);
});

it("keeps customizing through picker choices and dismissals, then finishes on a click elsewhere", async () => {
  const store = createStore();
  store.set(threadRowActionsAtom, ["core/archive"]);
  const finish = vi.fn();
  renderWithRegistrations(
    <OutsideClickHarness onDone={finish} showEditor />,
    store,
  );
  fireEvent.click(screen.getByRole("button", { name: "Row action 1: Empty" }));
  fireEvent.keyDown(await screen.findByRole("menuitemradio", { name: "Pin" }), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(store.get(threadRowActionsAtom)).toEqual([
      "core/pin",
      "core/archive",
    ]),
  );
  expect(finish).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Row action 1: Empty" }));
  await screen.findByRole("menu");
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(finish).not.toHaveBeenCalled();

  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
  expect(finish).toHaveBeenCalledWith(false);
});

it("finishes on a click elsewhere after the edited row unmounts", () => {
  const finish = vi.fn();
  renderWithRegistrations(
    <OutsideClickHarness onDone={finish} showEditor={false} />,
  );
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
  expect(finish).toHaveBeenCalledWith(false);
});

it("offers every registered action by its static title and labels unknown keys", async () => {
  const store = createStore();
  store.set(threadRowActionsAtom, ["plugin-gone/action"]);
  renderWithRegistrations(<ThreadRowActionsEditor onDone={() => {}} />, store);
  fireEvent.click(
    screen.getByRole("button", { name: "Row action 3: plugin-gone/action" }),
  );
  await screen.findByRole("menu");
  expect(
    screen.getAllByRole("menuitemradio").map((item) => item.textContent),
  ).toEqual([
    ...REGISTRATIONS.map((registration) => registration.title),
    "Hide",
  ]);
});
