// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, expect, it } from "vitest";
import type { PluginThreadActionItem } from "@get-bb/plugin-sdk/app";
import {
  installTestPluginRuntime,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import { makeSidebarThread, sdkResult } from "../model/fixtures.js";
import { threadRowActionsAtom } from "../preferences/atoms.js";

installTestPluginRuntime();
const { assignRowActionSlot, ThreadRowActionsCustomize } = await import(
  "./ThreadRowActionsCustomize.js"
);

function action(
  key: string,
  label: string,
  pluginId: string | null = null,
): PluginThreadActionItem {
  return {
    key,
    pluginId,
    action: { label, icon: "Pin", group: "organize", run() {} },
  };
}

const catalog: PluginThreadActionItem[] = [
  action("core:pin", "Pin"),
  action("core:rename", "Rename"),
  action("core:archive", "Archive"),
];

function renderCustomize(
  enabled: string[],
  options: Partial<RenderSlotOptions> = {},
) {
  getDefaultStore().set(threadRowActionsAtom, enabled);
  return renderSlot(
    { component: ThreadRowActionsCustomize },
    { onDone: () => {}, originThreadId: "thr_test", variant: "card" as const },
    {
      sidebarThreads: { threads: [makeSidebarThread()], projects: [] },
      threadActions: () => catalog,
      ...options,
    },
  );
}

afterEach(() => {
  cleanup();
});

it("previews empty slots before shown actions, next to the menu", () => {
  renderCustomize(["core:pin", "core:archive"]);
  expect(
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-row-action-slot]"),
    ).map((slot) => slot.dataset.rowActionSlot),
  ).toEqual(["none", "core:pin", "core:archive"]);
});

it("lists every registered action, naming the plugin that owns it", async () => {
  renderCustomize(["core:archive"], {
    threadActions: () => [
      ...catalog,
      action(
        "push-notifications/notifications",
        "Notifications",
        "push-notifications",
      ),
    ],
    sdk: {
      plugins: {
        list: sdkResult({
          plugins: [{ id: "push-notifications", name: "Push notifications" }],
        }),
      },
    },
  });
  fireEvent.click(
    document.querySelector<HTMLElement>('[data-sidebar-customize-launch="0"]')!,
  );
  expect(
    await screen.findByRole("menuitemradio", {
      name: "Notifications · Push notifications",
    }),
  ).toBeTruthy();
  expect(
    screen
      .getAllByRole("menuitemradio")
      .map((option) => option.textContent?.trim()),
  ).toEqual([
    "Pin",
    "Rename",
    "Archive",
    "Notifications · Push notifications",
    "Hide",
  ]);
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
  {
    initial: ["core:archive"],
    slot: 0,
    pick: "Pin",
    focusedSlot: 1,
    focused: "core:pin",
  },
  {
    initial: ["core:pin", "core:archive", "core:rename"],
    slot: 0,
    pick: "Rename",
    focusedSlot: 0,
    focused: "core:rename",
  },
  {
    initial: ["core:pin", "core:archive", "core:rename"],
    slot: 1,
    pick: "Hide",
    focusedSlot: 1,
    focused: "core:pin",
  },
] as const)(
  "moves focus to slot $focusedSlot after picking $pick in slot $slot",
  async ({ initial, slot, pick, focusedSlot, focused }) => {
    renderCustomize([...initial]);
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
