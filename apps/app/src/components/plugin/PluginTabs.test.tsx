import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
// @vitest-environment jsdom

import { useMemo } from "react";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activateSecondaryPanelTabInState } from "@bb/client-core";
import type {
  ExperimentalTabRegistration,
  JsonValue,
} from "@get-bb/plugin-sdk";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  isNavTab,
  isThreadTab,
} from "@/lib/plugin-slots";
import {
  createPluginFixedPanelTab,
  createPluginPageFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
} from "@/lib/fixed-panel-tabs-state";
import {
  resetFixedPanelTabsStateForTest,
  useReconciledFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  getPluginFixedTabOwnerId,
  getThreadFixedTabOwnerId,
  createAppPanelController,
  type AppFixedTabDestination,
} from "@/lib/app-fixed-tab-navigation";
import { useThreadFileTabs } from "../secondary-panel/useThreadFileTabs";
import {
  createPanelActionDestination,
  PluginPanelTabContent,
} from "./PluginPanelActions";
import {
  PluginTabScope,
  usePluginTabs,
  type PluginTabContext,
} from "./PluginTabs";

function Host({ context }: { context: PluginTabContext }) {
  const { slots: available, observers, isReady } = usePluginTabs(context);
  const slots = useMemo(
    () => available.filter((slot) => slot.pluginId === "example"),
    [available],
  );
  const fixed = useMemo(
    () =>
      slots
        .filter((slot) => slot.availability === "fixed")
        .map((slot) => ({
          slot,
          tab:
            slot.context.kind === "thread"
              ? createPluginFixedPanelTab({
                  pluginId: slot.pluginId,
                  tabId: slot.id,
                })
              : createPluginPageFixedPanelTab({
                  pluginId: slot.pluginId,
                  pageId: slot.context.panelId,
                  fixedTabId: slot.id,
                }),
        })),
    [slots],
  );
  const state = useReconciledFixedPanelTabsState({
    fixedTabs: fixed.map((entry) => entry.tab),
    isAuthoritative: isReady,
    panelStateId: "tab-contract",
    syncThreadId: null,
  });
  const update = useUpdateFixedPanelTabsState("tab-contract", null);
  const files = useThreadFileTabs({
    panelStateId: "tab-contract",
    syncThreadId: null,
    environmentId: null,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  const ownerId =
    context.kind === "thread"
      ? getThreadFixedTabOwnerId("example")
      : getPluginFixedTabOwnerId("example", context.panelId);
  const destinations: AppFixedTabDestination[] = slots.map((slot) =>
    slot.availability === "action"
      ? {
          ...createPanelActionDestination({
            action: slot,
            openPluginPanel: files.openPluginPanel,
          }),
          tab: { ownerId, tabId: slot.id },
        }
      : {
          tab: { ownerId, tabId: slot.id },
          panelTabId: () => null,
          open: () => {
            const tab = fixed.find((entry) => entry.slot === slot)?.tab;
            if (!tab) return false;
            update((current) =>
              activateSecondaryPanelTabInState(current, tab.id),
            );
            return true;
          },
        },
  );
  const active = state.secondary.tabs.find(
    (tab) => tab.id === state.secondary.activeTabId,
  );
  const entry = fixed.find((entry) => entry.tab.id === active?.id);
  return (
    <>
      {observers}
      {slots.map((slot) => (
        <button
          key={slot.id}
          onClick={() =>
            createAppPanelController(() => ({
              activeTabId: null,
              close: () => undefined,
              destinations,
            })).openTab({
              tab: { ownerId, tabId: slot.id },
              availability: slot.availability,
              ...(slot.availability === "action"
                ? { params: { item: "one" } }
                : {}),
            })
          }
        >
          Open {slot.title}
        </button>
      ))}
      {active?.kind === "plugin-panel" ? (
        <>
          <button onClick={() => files.closeTab(active.id)}>Close</button>
          <PluginPanelTabContent tab={active} context={context} />
        </>
      ) : entry ? (
        <PluginTabScope slot={entry.slot} instanceId="contract">
          {isThreadTab(entry.slot) ? (
            <entry.slot.component
              threadId={context.kind === "thread" ? context.threadId : ""}
              environment={context.kind === "thread" ? context.environment : null}
            />
          ) : isNavTab(entry.slot) ? (
            <entry.slot.component
              subPath={context.kind === "nav-panel" ? context.subPath : ""}
            />
          ) : null}
        </PluginTabScope>
      ) : null}
      <output data-testid="tabs">{JSON.stringify(state.secondary.tabs)}</output>
    </>
  );
}

const cases = [
  ["thread", "fixed", "new"],
  ["thread", "action", "new"],
  ["thread", "action", "legacy"],
  ["nav-panel", "fixed", "new"],
  ["nav-panel", "fixed", "legacy"],
  ["nav-panel", "action", "new"],
] as const;

beforeEach(() => markPluginFrontendsSettled());
afterEach(() => {
  vi.restoreAllMocks();
  resetPluginFrontendBootStateForTest();
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  resetFixedPanelTabsStateForTest();
  window.localStorage.clear();
});

it.each(cases)(
  "keeps %s %s lifecycle and saved identity through %s registration",
  (kind, availability, api) => {
    let visible = true;
    function register(title: string) {
      const component = (props: {
        threadId?: string;
        subPath?: string;
        params?: JsonValue | null;
      }) => {
        if (title === "Broken") throw new Error("broken tab");
        return (
          <div>
            Content {title}:{props.threadId ?? props.subPath}:
            {JSON.stringify(props.params ?? null)}
          </div>
        );
      };
      setPluginSlotRegistrations(
        "example",
        collectPluginAppRegistrations(
          definePluginApp((app) => {
            const registration = {
              id: "details",
              title,
              icon: "Info",
              component,
            };
            if (api === "legacy" && kind === "thread") {
              Reflect.get(app.slots, "threadPanelAction")(registration);
            } else if (api === "legacy") {
              (Reflect.get(app.slots, "navPanel") as (value: unknown) => void)({
                id: "board",
                title: "Board",
                icon: "Info",
                path: "board",
                component: () => null,
                fixedTabs: [{ ...registration, panelId: "board" }],
              });
            } else {
              const useVisible = () => visible;
              app.slots.experimental_tab({
                ...registration,
                context:
                  kind === "thread" ? { kind } : { kind, panelId: "board" },
                availability,
                useVisible,
              } as ExperimentalTabRegistration);
            }
          }),
        ),
      );
    }
    register("Details");
    const context: PluginTabContext =
      kind === "thread"
        ? { kind, threadId: "thr_one", environment: null }
        : { kind, pluginId: "example", panelId: "board", subPath: "item/one" };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(<Host context={context} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Details" }));
    expect(
      screen.getByText(
        new RegExp(
          `Content Details:${kind === "thread" ? "thr_one" : "item/one"}`,
        ),
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Details" }));
    const saved = JSON.parse(screen.getByTestId("tabs").textContent ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(
      availability === "action"
        ? "plugin-panel:example%3Adetails%3A%7B%22item%22%3A%22one%22%7D:none"
        : kind === "thread"
          ? "plugin-fixed:example:details"
          : "plugin-page-fixed:example%3Aboard%3Adetails:none",
    );
    if (availability === "action")
      expect(saved[0].paramsJson).toBe('{"item":"one"}');
    const stored = window.localStorage.getItem(
      getFixedPanelTabsStateStorageKey({ threadId: "tab-contract" }),
    );
    expect(stored).not.toBeNull();
    view.unmount();
    resetFixedPanelTabsStateForTest();
    const restored = render(<Host context={context} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      ),
    });
    expect(screen.getByText(/Content Details:/)).toBeTruthy();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    act(() => register("Broken"));
    expect(screen.getByText("plugin example crashed")).toBeTruthy();
    act(() => register("Reloaded"));
    expect(
      screen.getAllByRole("button", { name: "Open Reloaded" }),
    ).toHaveLength(1);
    expect(screen.getByText(/Content Reloaded:/)).toBeTruthy();
    if (api === "new") {
      visible = false;
      restored.rerender(<Host context={context} />);
      expect(
        screen.queryByRole("button", { name: "Open Reloaded" }),
      ).toBeNull();
      expect(screen.queryByText(/Content Reloaded:/) !== null).toBe(
        availability === "action",
      );
      expect(
        JSON.parse(screen.getByTestId("tabs").textContent ?? "[]"),
      ).toHaveLength(1);
    }
    if (availability === "action") {
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(
        JSON.parse(screen.getByTestId("tabs").textContent ?? "[]"),
      ).toEqual([]);
    } else expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  },
);
