// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { threadRowActionsAtom } from "../preferences/atoms.js";

installTestPluginRuntime();
const {
  assignRowActionSlot,
  ThreadRowActionsEditor,
  useFinishRowActionsOnOutsideClick,
} = await import("./ThreadRowActionsCustomize.js");

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
  store.set(threadRowActionsAtom, ["pin", "archive"]);
  render(
    <Provider store={store}>
      <ThreadRowActionsEditor onDone={() => {}} />
    </Provider>,
  );
  expect(
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-row-action-slot]"),
    ).map((slot) => slot.dataset.rowActionSlot),
  ).toEqual(["none", "pin", "archive"]);
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
  expect(assignRowActionSlot(["pin", "archive", "rename"], 0, "rename")).toEqual(
    ["rename", "archive", "pin"],
  );
  expect(assignRowActionSlot(["pin", "archive"], 0, "archive")).toEqual([
    "archive",
    "pin",
  ]);
  expect(assignRowActionSlot(["pin", "archive"], 1, null)).toEqual(["archive"]);
  expect(assignRowActionSlot(["archive"], 0, null)).toEqual(["archive"]);
});

it.each([
  { initial: ["archive"], slot: 0, pick: "Pin", focusedSlot: 1, focused: "pin" },
  { initial: ["pin", "archive", "rename"], slot: 0, pick: "Rename", focusedSlot: 0, focused: "rename" },
  { initial: ["pin", "archive", "rename"], slot: 1, pick: "Hide", focusedSlot: 1, focused: "pin" },
] as const)(
  "moves focus to slot $focusedSlot after picking $pick in slot $slot",
  async ({ initial, slot, pick, focusedSlot, focused }) => {
    const store = createStore();
    store.set(threadRowActionsAtom, [...initial]);
    render(
      <Provider store={store}>
        <ThreadRowActionsEditor onDone={() => {}} />
      </Provider>,
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
  store.set(threadRowActionsAtom, ["archive"]);
  const finish = vi.fn();
  render(
    <Provider store={store}>
      <ThreadRowActionsEditor onDone={finish} />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Row action 1: Empty" }));
  await screen.findByRole("menuitemradio", { name: "Pin" });
  expect(screen.queryByRole("menuitemradio", { name: "Hide" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(finish).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  fireEvent.click(screen.getByRole("button", { name: "Row action 3: Archive" }));
  expect(await screen.findByRole("menuitemradio", { name: "Hide" })).toBeTruthy();
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
  store.set(threadRowActionsAtom, ["archive"]);
  const finish = vi.fn();
  render(
    <Provider store={store}>
      <OutsideClickHarness onDone={finish} showEditor />
    </Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Row action 1: Empty" }));
  fireEvent.keyDown(await screen.findByRole("menuitemradio", { name: "Pin" }), {
    key: "Enter",
  });
  await waitFor(() =>
    expect(store.get(threadRowActionsAtom)).toEqual(["pin", "archive"]),
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
  render(<OutsideClickHarness onDone={finish} showEditor={false} />);
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
  expect(finish).toHaveBeenCalledWith(false);
});
