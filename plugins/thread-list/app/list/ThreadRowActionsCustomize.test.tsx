// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { threadRowActionsAtom } from "../preferences/atoms.js";

installTestPluginRuntime();
const { assignRowActionSlot, ThreadRowActionsCustomize } = await import(
  "./ThreadRowActionsCustomize.js"
);

afterEach(() => {
  cleanup();
});

it("previews empty slots before shown actions, next to the menu", () => {
  const store = createStore();
  store.set(threadRowActionsAtom, ["pin", "archive"]);
  render(
    <Provider store={store}>
      <ThreadRowActionsCustomize onDone={() => {}} variant="card" />
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
  { initial: ["pin", "archive", "rename"], slot: 1, pick: "None", focusedSlot: 1, focused: "pin" },
] as const)(
  "moves focus to slot $focusedSlot after picking $pick in slot $slot",
  async ({ initial, slot, pick, focusedSlot, focused }) => {
    const store = createStore();
    store.set(threadRowActionsAtom, [...initial]);
    render(
      <Provider store={store}>
        <ThreadRowActionsCustomize onDone={() => {}} variant="card" />
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
