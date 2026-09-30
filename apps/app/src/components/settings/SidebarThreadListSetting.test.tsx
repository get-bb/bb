// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { SidebarThreadListSetting } from "./SidebarThreadListSetting";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("SidebarThreadListSetting", () => {
  it("defaults to Automatic, which prefers an installed plugin over the bundled Thread list", async () => {
    setPluginSlotRegistrations(
      "thread-list",
      makePluginRegistrationSet({
        threadLists: [
          {
            id: "thread-list",
            title: "Thread list",
            component: () => null,
          },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "zen",
      makePluginRegistrationSet({
        threadLists: [
          {
            id: "inbox",
            title: "Inbox",
            component: () => null,
          },
        ],
      }),
    );
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <SidebarThreadListSetting />
      </JotaiProvider>,
    );

    expect(store.get(threadListProviderAtom)).toBe("__automatic__");
    const trigger = screen.getByRole("button", {
      name: "Sidebar thread list",
    });
    expect(trigger.textContent).toContain("Automatic");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(
      (await screen.findByRole("menuitem", { name: /Automatic/u }))
        .textContent,
    ).toContain("Chooses Inbox (zen).");
    const options = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    expect(options[1]).toContain("InboxFrom the zen plugin.");
    expect(options[2]).toContain("Thread list (built-in)BB default.");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Thread list \(built-in\)/u }));

    expect(store.get(threadListProviderAtom)).toBe("thread-list/thread-list");
  });
});
