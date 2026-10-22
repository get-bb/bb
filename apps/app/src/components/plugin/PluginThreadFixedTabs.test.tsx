// @vitest-environment jsdom

import { useReconciledFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import {
  createEmptyFixedPanelTabsState,
  createPluginFixedPanelTab,
  createThreadInfoFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  definePluginApp,
  collectPluginAppRegistrations,
} from "@/lib/plugin-app-definition";
import {
  setPluginSlotRegistrations,
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
} from "@/lib/plugin-slots";
import { usePluginId } from "./plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import {
  createThreadFixedTabDescriptor,
  useThreadFixedTabs,
} from "./PluginThreadFixedTabs";

function install(title = "Status") {
  setPluginSlotRegistrations(
    "example",
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_tab({
          context: { kind: "thread" },
          availability: "fixed",
          id: "status",
          title,
          icon: "Info",
          useVisible: ({ threadId }) =>
            usePluginId() === "example" && threadId !== "hidden",
          component: ({ threadId }) => (
            <div>
              {threadId}:{title}
            </div>
          ),
        });
      }),
    ),
  );
}

function Host({ threadId }: { threadId: string | null }) {
  const { entries, observers } = useThreadFixedTabs({ threadId });
  const [activeId, setActiveId] = useState<string | null>(null);
  const descriptors = entries.map((entry) =>
    createThreadFixedTabDescriptor(entry, threadId ?? "", () =>
      setActiveId(entry.tab.id),
    ),
  );
  return (
    <>
      {observers}
      {descriptors.map((descriptor) => (
        <button key={descriptor.tab.id} onClick={descriptor.onSelect}>
          {descriptor.label}
        </button>
      ))}
      {descriptors
        .find((descriptor) => descriptor.tab.id === activeId)
        ?.renderContent?.()}
    </>
  );
}

function RestoringHost() {
  const { entries, observers, isReady } = useThreadFixedTabs({
    threadId: "thr_restore",
  });
  const state = useReconciledFixedPanelTabsState({
    fixedTabs: entries.map((entry) => entry.tab),
    isAuthoritative: isReady,
    panelStateId: "thr_restore",
    syncThreadId: null,
  });
  return (
    <>
      {observers}
      <output>{state.secondary.activeTabId}</output>
    </>
  );
}

function mount(threadId: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(<Host threadId={threadId} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
  return {
    changeThread: (id: string | null) =>
      result.rerender(<Host threadId={id} />),
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
});

describe("thread fixed-tab contract", () => {
  it("does not expose or mount thread tabs without a thread", () => {
    install();
    const view = mount(null);
    expect(screen.queryByRole("button", { name: "Info" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    view.changeThread("");
    expect(screen.queryByRole("button", { name: "Info" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    view.changeThread("thr_one");
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    expect(screen.getByText("thr_one:Status")).toBeTruthy();
  });

  it("keeps a restored selection while registrations and initial visibility are loading", () => {
    const plugin = createPluginFixedPanelTab({
      pluginId: "example",
      tabId: "status",
    });
    const state = createEmptyFixedPanelTabsState({
      lastUsedAt: Date.now(),
      secondary: {
        tabs: [createThreadInfoFixedPanelTab(), plugin],
        activeTabId: plugin.id,
        isOpen: true,
      },
    });
    const key = getFixedPanelTabsStateStorageKey({ threadId: "thr_restore" });
    window.localStorage.setItem(key, serializeFixedPanelTabsState({ state }));
    markPluginFrontendBootStarted();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RestoringHost />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe(plugin.id);
    act(() => {
      install();
      markPluginFrontendsSettled();
    });
    expect(screen.getByRole("status").textContent).toBe(plugin.id);
  });

  it("updates visibility per thread and replaces reloaded components without duplicating tabs", () => {
    install();
    const view = mount("thr_one");
    fireEvent.click(screen.getByRole("button", { name: "Status" }));
    view.changeThread("hidden");
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    view.changeThread("thr_two");
    expect(screen.getByText("thr_two:Status")).toBeTruthy();
    act(() => install("Reloaded"));
    expect(screen.getAllByRole("button", { name: "Reloaded" })).toHaveLength(1);
    expect(screen.getByText("thr_two:Reloaded")).toBeTruthy();
    act(() => removePluginSlotRegistrations("example"));
    expect(screen.queryByRole("button", { name: "Reloaded" })).toBeNull();
    expect(screen.getByRole("button", { name: "Info" })).toBeTruthy();
  });
});
