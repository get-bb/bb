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
  it("defaults to Thread list and offers only explicit plugin choices", async () => {
    setPluginSlotRegistrations(
      "inbox",
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
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <SidebarThreadListSetting />
      </JotaiProvider>,
    );

    expect(store.get(threadListProviderAtom)).toBe(
      "thread-list/thread-list",
    );
    const trigger = screen.getByRole("button", {
      name: "Sidebar thread list",
    });
    expect(trigger.textContent).toContain("Thread list");

    fireEvent.pointerDown(trigger, { button: 0 });
    expect(screen.queryByRole("menuitem", { name: /built-in/u })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Automatic/u })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Inbox/u }));

    expect(store.get(threadListProviderAtom)).toBe("inbox/inbox");
  });
});
