// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  AUTOMATIC_THREAD_LIST_PROVIDER,
  BUILT_IN_THREAD_LIST_PROVIDER,
  threadListProviderAtom,
} from "@/components/sidebar/threadListProvider";
import { SidebarThreadListSetting } from "./SidebarThreadListSetting";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
});

describe("SidebarThreadListSetting", () => {
  it("defaults to automatic and lets the user pin BB's list", async () => {
    setPluginSlotRegistrations("inbox", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      threadLists: [
        {
          id: "inbox",
          title: "Inbox",
          component: () => null,
        },
      ],
      fileOpeners: [],
      messageDirectives: [],
    });
    const store = createStore();
    render(
      <JotaiProvider store={store}>
        <SidebarThreadListSetting />
      </JotaiProvider>,
    );

    expect(store.get(threadListProviderAtom)).toBe(
      AUTOMATIC_THREAD_LIST_PROVIDER,
    );
    const trigger = screen.getByRole("button", {
      name: "Sidebar thread list",
    });
    expect(trigger.textContent).toContain("Automatic");

    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(await screen.findByRole("menuitem", { name: /built-in/u }));

    expect(store.get(threadListProviderAtom)).toBe(
      BUILT_IN_THREAD_LIST_PROVIDER,
    );
  });
});
