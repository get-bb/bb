// @vitest-environment jsdom

import { StrictMode, useMemo } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ExperimentalPageTitle,
  PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { PluginPanelHeaderCenter } from "@/components/plugin/PluginPanelHeader";
import { PluginPageTitleHost } from "@/components/plugin/PluginPageTitleHost";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { focusedPageTitleAtom, PageTitleHookHost } from "./page-title";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

const chrome = { pluginId: "demo", title: "Demo", icon: "Clock" } as const;
const body = (
  <>
    <PluginPanelHeaderCenter chrome={chrome} />
    <p>Page body survives</p>
  </>
);
function useTitle({
  subPath,
}: PluginNavPanelProps): ExperimentalPageTitle | null {
  return useMemo(
    () =>
      subPath === "clear"
        ? null
        : {
            breadcrumbs: [
              { label: "Installed", to: "/plugins/demo/main" },
              { label: subPath },
            ],
            windowTitle: subPath,
          },
    [subPath],
  );
}

for (const surface of ["core", "plugin"] as const) {
  describe(`${surface} registered page title`, () => {
    it("isolates pane hooks and updates only the focused window title through route changes and unmount", () => {
      const store = createStore();
      setPluginSlotRegistrations(
        "demo",
        makePluginRegistrationSet({
          navPanels: [
            {
              id: "main",
              path: "main",
              title: "Demo",
              icon: "Clock",
              component: () => null,
              experimental_usePageTitle: useTitle,
            },
          ],
        }),
      );
      function TitleHost({
        subPath,
        focused,
        paneId,
      }: {
        subPath: string;
        focused: boolean;
        paneId: string;
      }) {
        const pane: PaneContextValue = {
          paneId,
          isFocused: focused,
          isSplitPane: true,
          secondaryPanelHost: null,
          reservesWindowPanelToggle: false,
          onRequestClose: null,
          isMaximized: false,
          onToggleMaximize: null,
          isBoundedPane: true,
          isTopRow: true,
          ownsWindowTopLeft: false,
          navigateInPane: () => {},
        };
        return (
          <PaneContext.Provider value={pane}>
            {surface === "plugin" ? (
              <PluginPageTitleHost
                pluginId="demo"
                panelPath="main"
                subPath={subPath}
                focused={focused}
              >
                {body}
              </PluginPageTitleHost>
            ) : (
              <PageTitleHookHost
                usePageTitle={useTitle}
                subPath={subPath}
                focused={focused}
              >
                {body}
              </PageTitleHookHost>
            )}
          </PaneContext.Provider>
        );
      }
      function Layout({
        focus = "left",
        leftPath = "Weekly review",
        show = true,
      }: {
        focus?: string;
        leftPath?: string;
        show?: boolean;
      }) {
        return (
          <StrictMode>
            <Provider store={store}>
              <MemoryRouter>
                {show ? (
                  <section aria-label="left">
                    <TitleHost
                      subPath={leftPath}
                      focused={focus === "left"}
                      paneId="left"
                    />
                  </section>
                ) : null}
                <section aria-label="right">
                  <TitleHost
                    subPath="Monthly report"
                    focused={focus === "right"}
                    paneId="right"
                  />
                </section>
              </MemoryRouter>
            </Provider>
          </StrictMode>
        );
      }
      const view = render(<Layout />);
      const left = within(screen.getByRole("region", { name: "left" }));
      const right = within(screen.getByRole("region", { name: "right" }));
      expect(
        left.getByRole("link", { name: "Installed" }).getAttribute("href"),
      ).toBe("/plugins/demo/main");
      expect(left.getByText("Weekly review")).toBeTruthy();
      expect(left.queryByText("Monthly report")).toBeNull();
      expect(right.getByText("Monthly report")).toBeTruthy();
      expect(store.get(focusedPageTitleAtom)?.windowTitle).toBe(
        "Weekly review",
      );
      view.rerender(<Layout focus="right" />);
      expect(store.get(focusedPageTitleAtom)?.windowTitle).toBe(
        "Monthly report",
      );
      view.rerender(
        <Layout focus="right" leftPath="Updated background page" />,
      );
      expect(left.getByText("Updated background page")).toBeTruthy();
      expect(store.get(focusedPageTitleAtom)?.windowTitle).toBe(
        "Monthly report",
      );
      view.rerender(<Layout leftPath="clear" />);
      expect(left.queryByRole("navigation")).toBeNull();
      expect(store.get(focusedPageTitleAtom)).toBeNull();
      view.rerender(<Layout focus="right" show={false} />);
      expect(store.get(focusedPageTitleAtom)?.windowTitle).toBe(
        "Monthly report",
      );
      view.unmount();
      expect(store.get(focusedPageTitleAtom)).toBeNull();
    });
  });
}

describe("plugin title failure isolation", () => {
  it.each(["throw", "invalid label", "invalid link"])(
    "keeps the page alive after %s and retries on navigation or reload",
    (failure) => {
      const store = createStore();
      function useBrokenTitle({
        subPath,
      }: PluginNavPanelProps): ExperimentalPageTitle {
        if (subPath !== "broken") return { title: subPath };
        if (failure === "throw") throw new Error("Title failed");
        return failure === "invalid label"
          ? JSON.parse('{"title":{"invalid":"node"}}')
          : { breadcrumbs: [{ label: "Unsafe", to: "//example.com" }] };
      }
      function register(usePageTitle: typeof useBrokenTitle) {
        setPluginSlotRegistrations(
          "demo",
          makePluginRegistrationSet({
            navPanels: [
              {
                id: "main",
                path: "main",
                title: "Demo",
                icon: "Clock",
                component: () => null,
                experimental_usePageTitle: usePageTitle,
              },
            ],
          }),
        );
      }
      register(useBrokenTitle);
      function Layout({ subPath }: { subPath: string }) {
        return (
          <Provider store={store}>
            <MemoryRouter>
              <PluginPageTitleHost
                pluginId="demo"
                panelPath="main"
                subPath={subPath}
              >
                {body}
              </PluginPageTitleHost>
            </MemoryRouter>
          </Provider>
        );
      }
      const view = render(<Layout subPath="broken" />);
      expect(screen.getByText("Page body survives")).toBeTruthy();
      expect(store.get(focusedPageTitleAtom)).toBeNull();
      view.rerender(<Layout subPath="Recovered" />);
      expect(screen.getByText("Recovered")).toBeTruthy();
      view.rerender(<Layout subPath="broken" />);
      expect(store.get(focusedPageTitleAtom)).toBeNull();
      register(() => ({ title: "Reloaded" }));
      view.rerender(<Layout subPath="broken" />);
      expect(screen.getByText("Reloaded")).toBeTruthy();
    },
  );
});
