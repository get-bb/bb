// @vitest-environment jsdom

import { ThreadInfoContentContext } from "@/components/secondary-panel/thread-info-registration";

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
import { useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
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
import { openAppFixedTabFromDestinations } from "@/lib/app-fixed-tab-navigation";
import { usePluginId } from "./plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import {
  createThreadFixedTabDestination,
  createThreadFixedTabDescriptor,
  buildThreadFixedPanelViewTabs,
  ThreadFixedTabContent,
  useThreadFixedTabs,
} from "./PluginThreadFixedTabs";

function install(title = "Status", tooltip?: string) {
  setPluginSlotRegistrations(
    "example",
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_threadFixedTab({
          id: "status",
          title,
          ...(tooltip === undefined ? {} : { tooltip }),
          icon: "Info",
          useVisible: ({ threadId }) =>
            usePluginId() === "example" && threadId !== "hidden",
          component: function Status({ threadId }) {
            return (
              <div>
                {usePluginId()}:{threadId}:{title}
              </div>
            );
          },
        });
      }),
    ),
  );
}

function Host({ threadId }: { threadId: string | null }) {
  const { entries, observers } = useThreadFixedTabs({ threadId });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const destinations = entries.map((entry) =>
    createThreadFixedTabDestination(entry, (selected) =>
      setActiveId(selected.tab.id),
    ),
  );
  const entry = entries.find((candidate) => candidate.tab.id === activeId);
  return (
    <>
      {observers}
      {threadId === null
        ? null
        : entries.map((entry) => {
            const descriptor = createThreadFixedTabDescriptor(
              entry,
              threadId,
              (reference) =>
                setAccepted(
                  openAppFixedTabFromDestinations(destinations, {
                    surface: { kind: "current" },
                    tab: reference,
                  }),
                ),
            );
            return (
              <button
                key={entry.tab.id}
                aria-label={descriptor.ariaLabel}
                title={descriptor.title}
                onClick={descriptor.onSelect}
              >
                {descriptor.leadingVisual}
                {descriptor.label}
              </button>
            );
          })}
      <button
        onClick={() =>
          setAccepted(
            openAppFixedTabFromDestinations(destinations, {
              surface: { kind: "current" },
              tab: entries[0]?.reference ?? {
                ownerId: "missing",
                tabId: "missing",
              },
              target: { invalid: true },
            }),
          )
        }
      >
        Invalid target
      </button>
      <output>{String(accepted)}</output>
      <ThreadInfoContentContext.Provider
        value={<div>Core info:{threadId}</div>}
      >
        {entry === undefined || threadId === null ? null : (
          <ThreadFixedTabContent entry={entry} threadId={threadId} />
        )}
      </ThreadInfoContentContext.Provider>
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
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Host threadId={threadId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    ...result,
    changeThread: (id: string | null) =>
      result.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Host threadId={id} />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
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
  it.each([
    [
      "Info",
      "Thread info",
      "Show thread info panel",
      "Core info:thr_one",
      undefined,
    ],
    [
      "Status",
      "Status",
      "Show status panel",
      "example:thr_one:Status",
      undefined,
    ],
    [
      "Status",
      "Workspace status",
      "Show workspace status panel",
      "example:thr_one:Status",
      "Workspace status",
    ],
  ])(
    "selects and renders %s with tooltip %s through registered destinations",
    (label, tooltip, ariaLabel, content, registrationTooltip) => {
      install("Status", registrationTooltip);
      mount("thr_one");
      const button = screen.getByRole("button", { name: ariaLabel });
      expect(button.textContent).toBe(label);
      expect(button.getAttribute("title")).toBe(tooltip);
      fireEvent.click(button);
      expect(screen.getByText(content)).toBeTruthy();
      expect(screen.getByRole("status").textContent).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Invalid target" }));
      expect(screen.getByRole("status").textContent).toBe("false");
      expect(screen.getByText(content)).toBeTruthy();
    },
  );

  it("renders the same Info glyph through the core registration as the original Icon", () => {
    const original = render(<Icon name="Info" />);
    mount("thr_one");
    const registered = screen
      .getByRole("button", { name: "Show thread info panel" })
      .querySelector('svg[data-icon="Info"]');
    const direct = original.container.querySelector('svg[data-icon="Info"]');
    expect(registered).not.toBeNull();
    expect(direct).not.toBeNull();
    expect(registered?.innerHTML).toBe(direct?.innerHTML);
    expect(registered?.hasAttribute("data-icon-root")).toBe(true);
  });

  it("keeps default Info before pinned Diff to match the Plugin Guide and Theme Preview fixtures", () => {
    setPluginSlotRegistrations(
      "bb--git",
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.slots.experimental_threadFixedTab({
            id: "diff",
            title: "Diff",
            icon: "FileDiff",
            component: () => null,
          });
        }),
      ),
    );
    const { result } = renderHook(() => {
      const { entries } = useThreadFixedTabs({ threadId: "thr_fixture" });
      return buildThreadFixedPanelViewTabs({ entries });
    });
    expect(result.current.map((tab) => tab.kind)).toEqual([
      "thread-info",
      "plugin-fixed",
    ]);
  });

  it("does not expose or mount thread tabs without a thread", () => {
    install();
    const view = mount(null);
    expect(
      screen.queryByRole("button", { name: "Show thread info panel" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show status panel" }),
    ).toBeNull();
    view.changeThread("");
    expect(
      screen.queryByRole("button", { name: "Show thread info panel" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show status panel" }),
    ).toBeNull();
    view.changeThread("thr_one");
    fireEvent.click(screen.getByRole("button", { name: "Show status panel" }));
    expect(screen.getByText("example:thr_one:Status")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Show status panel" }));
    view.changeThread("hidden");
    expect(
      screen.queryByRole("button", { name: "Show status panel" }),
    ).toBeNull();
    view.changeThread("thr_two");
    expect(screen.getByText("example:thr_two:Status")).toBeTruthy();
    act(() => install("Reloaded"));
    expect(
      screen.getAllByRole("button", { name: "Show reloaded panel" }),
    ).toHaveLength(1);
    expect(screen.getByText("example:thr_two:Reloaded")).toBeTruthy();
    act(() => removePluginSlotRegistrations("example"));
    expect(
      screen.queryByRole("button", { name: "Show reloaded panel" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show thread info panel" }),
    ).toBeTruthy();
  });
});
